const test = require('node:test');
const assert = require('node:assert/strict');
const { createMediaClient } = require('../miniprogram/services/media-client');
const { createPhotoCheckin } = require('../miniprogram/services/photo-checkin');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { createApi } = require('../server/handler');
const { domain, dates, plan, copy } = require('./helpers/cloud-fixture.cjs');
const names = require('../miniprogram/config/cloud-resources');
const tick = () => new Promise(setImmediate);

function uploadFixture() {
  const status = { ready: true, accountId: 'a'.repeat(64), epoch: 'photo-epoch', pending: 0 };
  const events = [], uploads = [], compressions = [];
  const h = { status, events, uploads, compressions, loseConfirm: true };
  const wx = {
    compressImage(options) { compressions.push(options.quality); options.success({ tempFilePath: 'compressed.jpg' }); },
    getFileInfo(options) { options.success({ size: compressions.length === 1 ? 3000000 : 1000 }); }
  };
  const client = createMediaClient(wx, { enabled: true, functionName: names.apiFunction, envId: 'fixture' }, { enabled: true }, { status: () => ({ ...status }), refresh: async () => {} }, {
    storageFactory: () => ({ upload: async input => { uploads.push(input); return { fileID: 'cloud://fixture/file.jpg' }; } }),
    transportFactory: () => async event => {
      events.push(copy(event));
      if (event.action === 'prepareMedia') return { ok: true, media: { mediaId: 'b'.repeat(64), cloudPath: 'jiancheng_daka_media/uploads/test.jpg' } };
      if (event.action === 'confirmMedia') { if (h.loseConfirm) { h.loseConfirm = false; throw Error('lost receipt'); } return { ok: true, media: { mediaId: event.mediaId, status: 'pending', uploaded: true } }; }
      throw Error('Unexpected media action');
    }
  });
  return { ...h, h, client, wx };
}

test('photo compression meets the byte limit and confirmation loss reuses the same file and operation', async () => {
  const h = uploadFixture(), photo = { localId: 'selected-once', tempFilePath: 'camera.jpg' };
  await assert.rejects(h.client.upload(photo, 'read', '2026-10-13'), /lost/);
  const firstConfirm = h.events.find(event => event.action === 'confirmMedia');
  const result = await h.client.upload(photo, 'read', '2026-10-13');
  assert.equal(result.status, 'pending'); assert.deepEqual(h.compressions, [70, 50]); assert.equal(h.uploads.length, 1);
  assert.equal(h.events.filter(event => event.action === 'prepareMedia').length, 1);
  assert.equal(h.events.at(-1).operationId, firstConfirm.operationId);
  assert.equal(h.events.at(-1).fileId, firstConfirm.fileId);
  assert.equal('openid' in h.events.at(-1), false);
});

test('disabled media and a late upload result after account change never produce a confirmed attachment', async () => {
  let resolve, calls = 0;
  const status = { ready: true, accountId: 'a'.repeat(64), epoch: 'one' };
  const config = { enabled: true, functionName: names.apiFunction };
  const disabled = createMediaClient({}, config, { enabled: false }, { status: () => status }, { transportFactory: () => { calls++; } });
  await assert.rejects(disabled.record({ habitId: 'read', date: '2026-10-13' }), /尚未开放/); assert.equal(calls, 0);
  const client = createMediaClient({}, config, { enabled: true }, { status: () => status }, { transportFactory: () => () => new Promise(r => { resolve = r; }) });
  const work = client.record({ habitId: 'read', date: '2026-10-13' }); status.epoch = 'two';
  resolve({ ok: true, recordMedia: { date: '2026-10-13', items: [] } });
  await assert.rejects(work, /账户已变化/);
});

test('an account change during native image inspection cannot prepare or upload the old photo into the next account',async()=>{
  const h=uploadFixture();let inspection;h.wx.getImageInfo=input=>{inspection=input;};
  const work=h.client.upload({localId:'one',tempFilePath:'camera.jpg'},'read','2026-10-13');await tick();
  h.status.epoch='another-account';inspection.success({type:'jpeg'});
  await assert.rejects(work,/账户已变化/);assert.equal(h.events.length,0);assert.equal(h.uploads.length,0);
});

function controllerFixture() {
  let context = 'a'.repeat(64) + ':epoch', day = '2026-10-13', visible = true, selected, failUpload = false, pending = false, writes = [], retries = 0;
  const updates = [];
  const controller = createPhotoCheckin({ wx: { chooseMedia: o => { selected = o; } },
    media: { upload: async () => { if (failUpload) throw Error('offline'); return { mediaId: 'b'.repeat(64), status: 'pending' }; } },
    context: () => context, today: () => day, visible: () => visible, change: data => updates.push(copy(data)), pending: () => pending,
    dispatch: async command => { writes.push(copy(command)); pending = true; return false; },
    retry: async () => { retries++; pending = false; return true; }
  });
  return { controller, updates, writes, choose: () => selected, day: value => { day = value; }, context: value => { context = value; }, visible: value => { visible = value; }, failUpload: value => { failUpload = value; }, retries: () => retries };
}

test('required photo panel never completes on selection or upload; uncertain completion retains input and retries original intent', async () => {
  const h = controllerFixture(); h.controller.open({ id: 'read', date: '2026-10-13', title: '阅读', photoRequired: true }, 'completeMinimum');
  h.controller.choose(); h.choose().success({ tempFiles: [{ tempFilePath: 'camera.jpg' }] }); await tick();
  assert.equal(h.controller.view().photoCanSubmit, true); assert.equal(h.writes.length, 0);
  assert.equal(await h.controller.submit(), false); assert.equal(h.controller.view().photoPending, true); assert.equal(h.controller.view().photoItems.length, 1);
  h.controller.remove(h.controller.view().photoItems[0].localId); assert.equal(h.controller.view().photoItems.length, 1);
  assert.equal(await h.controller.submit(), true); assert.equal(h.writes.length, 1); assert.equal(h.retries(), 1); assert.equal(h.controller.view().photoOpen, false);
  assert.deepEqual(h.writes[0], { type: 'completeMinimum', id: 'read', date: '2026-10-13', mediaIds: ['b'.repeat(64)] });
});

test('failed photo upload preserves selected input; hidden views, account changes and midnight cannot receive old results', async () => {
  const h = controllerFixture(); h.controller.open({ id: 'read', date: '2026-10-13', title: '阅读' }, 'complete');
  h.failUpload(true); h.controller.choose(); h.choose().success({ tempFiles: [{ tempFilePath: 'a.jpg' }] }); await tick();
  assert.equal(h.controller.view().photoItems[0].status, 'failed'); assert.equal(h.controller.view().photoCanSubmit, false);
  h.failUpload(false); await h.controller.upload(); assert.equal(h.controller.view().photoItems[0].status, 'ready');
  h.controller.close(); assert.equal(h.controller.view().photoOpen, false); h.controller.open({ id: 'read', date: '2026-10-13', title: '阅读' }, 'complete'); assert.equal(h.controller.view().photoItems.length, 1);
  h.context('c'.repeat(64) + ':new'); assert.equal(h.controller.view().photoItems.length, 0); assert.equal(h.writes.length, 0);
  h.controller.open({ id: 'read', date: '2026-10-13', title: '阅读' }, 'complete'); h.controller.choose(); h.day('2026-10-14'); h.choose().success({ tempFiles: [{ tempFilePath: 'old.jpg' }] }); await tick();
  assert.equal(h.controller.view().photoItems.length, 0); assert.equal(h.writes.length, 0);
});

test('photo completion uses the existing cloud session receipt and keeps selected input until replay confirms it', async () => {
  let account = null, serial = 0, lost = true;
  const day = dates.today(), identity = { APPID: 'photo-client', OPENID: 'photo-user', SOURCE: 'wx_client' };
  const repository = { async transact(owner, work) { const result = await work(copy(account), { owner }); account = copy(result.account); return copy(result.result); } };
  const api = createApi({ repository, domain, dates, allowedAppId: identity.APPID, allowedSources: ['wx_client'], recordMutationGuard: async () => {}, newEpoch: () => 'client-epoch' });
  const session = createCloudSession({}, { enabled: true, envId: 'fixture' }, () => async event => { const result = await api(event, identity); if (event.command && event.command.mediaIds && lost) { lost = false; throw Error('lost after commit'); } return result; }, { newId: () => 'client-' + (++serial) });
  await session.start(); await session.dispatch({ type: 'create', id: 'read', startDate: day, plan: plan() });
  let choice;
  const controller = createPhotoCheckin({ wx: { chooseMedia: options => { choice = options; } }, media: { upload: async () => ({ mediaId: 'b'.repeat(64) }) },
    today: () => day, context: () => session.status().accountId + ':' + session.status().epoch, visible: () => true, change() {}, pending: () => session.status().pending,
    dispatch: async command => { try { await session.dispatch(command); return true; } catch (_) { return false; } }, retry: async () => { await session.retry(); return true; } });
  session.subscribeConfirmed(event => controller.confirmed(event));
  controller.open({ id: 'read', date: day, title: '阅读' }, 'complete'); controller.choose(); choice.success({ tempFiles: [{ tempFilePath: 'proof.jpg' }] }); await tick();
  assert.equal(await controller.submit(), false); assert.equal(session.status().phase, 'uncertain'); assert.equal(controller.view().photoItems.length, 1);
  assert.equal(await controller.submit(), true); assert.equal(session.read().records['read@' + day].status, 'standard'); assert.equal(account.receipts.length, 2); assert.equal(controller.view().photoOpen, false);
});
