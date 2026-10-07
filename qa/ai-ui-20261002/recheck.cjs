// AI 助手复核：只运行受控基础方案与页面导航，不调用模型或保存习惯。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require(path.join(process.env.TEMP, 'mp-automator/node_modules/miniprogram-automator'));
const { inject, restore } = require('./capture.cjs');
const domain = require('../../miniprogram/core/habits');
const { THEMES } = require('../../miniprogram/config/theme-tokens');
const out = path.resolve(__dirname, '../../docs/audits/2026-10-03-ai-recheck');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + (process.env.MP_AUTO_PORT || 9433) });
  let scrollOriginal;
  try {
    await mp.evaluate(restore);
    await mp.evaluate(inject, { theme: 'mist', tokens: THEMES.mist, state: domain.emptyState() });
    let p = await mp.reLaunch('/pages/assistant/index');
    await wait(1600);
    const observations = { level: 'F', cases: [] };
    for (const direction of ['read', 'study', 'tidy', 'walk']) {
      for (const minutes of ['1', '2', '5', '60']) {
        await p.callMethod('change', { direction, minutes });
        await p.callMethod('onRules');
        const d = await p.data();
        assert.equal(d.preview.source, 'rule');
        assert.ok(d.preview.draft.target <= Number(minutes));
        assert.ok(d.preview.draft.minimum == null || d.preview.draft.minimum < d.preview.draft.target);
        observations.cases.push({ direction, minutes, target: d.preview.draft.target, minimum: d.preview.draft.minimum });
      }
    }
    await p.callMethod('change', { minutes: '5', weekdays: [] });
    await p.setData({ moreOpen: false });
    await wait(300);
    await mp.evaluate(() => {
      globalThis.__aiReviewScrollOriginal = wx.pageScrollTo;
      globalThis.__aiReviewScroll = [];
      wx.pageScrollTo = options => {
        const entry = { selector: options.selector };
        globalThis.__aiReviewScroll.push(entry);
        globalThis.__aiReviewScrollOriginal({ ...options,
          success: result => { entry.ok = true; if (options.success) options.success(result); },
          fail: result => { entry.ok = false; entry.message = result.errMsg; if (options.fail) options.fail(result); }
        });
      };
    });
    scrollOriginal = true;
    await p.callMethod('onRules');
    await wait(600);
    observations.invalidWeekdaysScroll = await mp.evaluate(() => globalThis.__aiReviewScroll);
    console.log(JSON.stringify({ invalidWeekdaysScroll: observations.invalidWeekdaysScroll }));
    assert.ok((await p.data()).fieldErrors.weekdays);
    await mp.screenshot({ path: path.join(out, 'empty-weekdays-F.png') });
    await p.callMethod('change', { minutes: '5', weekdays: [1, 3, 5], time: '20:30' });
    await p.callMethod('onRules');
    await wait(800);
    console.log(JSON.stringify({ beforeAdopt: (({canAdopt, busy, adopting, requestError}) => ({canAdopt, busy, adopting, requestError}))(await p.data()) }));
    const next = await p.$('#plan-preview button.primary');
    await next.tap();
    let edit;
    for (let i = 0; i < 30; i++) {
      await wait(400); edit = await mp.currentPage();
      if (edit.path === 'pages/edit/index') break;
    }
    if (edit.path !== 'pages/edit/index') console.log(JSON.stringify({ afterAdopt: (({canAdopt, busy, adopting, requestError}) => ({canAdopt, busy, adopting, requestError}))(await p.data()) }));
    assert.equal(edit.path, 'pages/edit/index');
    const draft = await edit.data();
    assert.equal(draft.time, '20:30');
    assert.deepEqual(draft.weekdays, [1, 3, 5]);
    observations.confirm = { route: edit.path, target: draft.target, minimum: draft.minimum, weekdays: draft.weekdays, time: draft.time };
    await mp.screenshot({ path: path.join(out, 'basis-confirm-F.png') });
    p = await mp.reLaunch('/pages/assistant/index');
    await wait(1300);
    await mp.evaluate(() => {
      getApp().planAssistant.generate = async () => {
        const error = Error('云端账户数据已变化，请重新读取后再申请AI建议');
        error.code = 'EPOCH_CHANGED'; throw error;
      };
    });
    await p.callMethod('onConsent', { detail: { value: ['agree'] } });
    await p.callMethod('onGenerate');
    await wait(600);
    let recovery = await p.data();
    assert.equal(recovery.needsCloudRefresh, true);
    assert.equal(recovery.canGenerate, false);
    assert.equal(recovery.canAdopt, false);
    assert.equal(recovery.consent, false);
    await mp.screenshot({ path: path.join(out, 'account-recovery-F.png') });
    const recoveryButtons = await p.$$('button.text-button');
    let recoveryButton;
    for (const button of recoveryButtons) if ((await button.text()).includes('重新读取云端账户')) recoveryButton = button;
    assert.ok(recoveryButton);
    await recoveryButton.tap();
    await wait(1000);
    recovery = await p.data();
    assert.equal(recovery.needsCloudRefresh, false); assert.equal(recovery.consent, false);
    assert.equal(recovery.canGenerate, true);
    observations.accountRecovery = { blockedBeforeReread: true, actualRecoveryTap: true, requiresNewConsent: true };
    fs.writeFileSync(path.join(out, 'observations.json'), JSON.stringify(observations, null, 2));
    console.log(JSON.stringify(observations));
  } finally {
    if (scrollOriginal) await mp.evaluate(() => {
      wx.pageScrollTo = globalThis.__aiReviewScrollOriginal;
      delete globalThis.__aiReviewScrollOriginal; delete globalThis.__aiReviewScroll;
    });
    await mp.evaluate(restore);
    await mp.reLaunch('/pages/today/index');
    await wait(800);
    console.log(JSON.stringify(await mp.evaluate(() => ({ fixturePresent: !!globalThis.__aiAuditOriginal }))));
    await mp.disconnect();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
