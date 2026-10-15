const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { supervisionFixture, image } = require('./helpers/supervision-fixture.cjs');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { createFeaturesClient } = require('../miniprogram/services/features-client');
const { createSupervisionClient } = require('../miniprogram/services/supervision-client');
const { createMediaClient } = require('../miniprogram/services/media-client');
const dates = require('../miniprogram/core/date');
const resources = require('../miniprogram/config/cloud-resources');
const settle = () => new Promise(setImmediate);

async function harness(t, identityKey = 'a', f) {
  f = f || await supervisionFixture(); const identity = f[identityKey], navigation = [], modals = [], toasts = [], choices = [];
  const originalToday = dates.today; dates.today = () => originalToday(f.now.getTime()); t.after(() => { dates.today = originalToday; });
  let serial = 0, lost = false;
  const config = { enabled: true, envId: 'local-fixture', functionName: resources.apiFunction };
  const session = createCloudSession({}, config, () => async event => { const result = await f.api(event, identity); if (event.command && event.command.mediaIds && lost) { lost = false; throw Error('lost'); } return result; }, { now: () => f.now.getTime(), newId: () => identityKey + '-page-' + (++serial) });
  await session.start();
  const wx = { navigateTo: input => navigation.push(input.url), redirectTo: input => navigation.push(input.url), switchTab() {}, showModal: input => modals.push(input), showToast: input => toasts.push(input),
    setNavigationBarTitle() {}, getSystemInfoSync: () => ({ fontSizeSetting: 18 }), chooseMedia: input => choices.push(input),
    compressImage: input => input.success({ tempFilePath: 'compressed.png' }), getFileInfo: input => input.success({ size: image.length }), getImageInfo: input => input.success({ type: 'png' }), previewImage() {} };
  const app = { cloudSession: session, dataReady: Promise.resolve(), store: { read: session.read, stale: session.staleRead, dispatch: session.dispatch,
    info: () => ({ ...session.status(), source: 'cloud' }), contextKey: () => session.status().accountId + ':' + session.status().epoch } };
  app.featuresClient = createFeaturesClient(wx, config, { enabled: false }, session);
  app.supervisionClient = createSupervisionClient(wx, config, { enabled: true }, session, { transportFactory: () => event => { const { action, ...fields } = event; return f.request(action, fields, identity); } });
  app.mediaClient = createMediaClient(wx, config, { enabled: true }, session, { transportFactory: () => event => { const { action, ...fields } = event; return f.mediaRequest(action, fields, identity); },
    storageFactory: () => ({ upload: async ({ cloudPath }) => { const fileID = f.provider.fileIdFor(cloudPath); f.files.set(fileID, Buffer.from(image)); return { fileID }; } }) });
  const pages = [];
  function activate() { global.wx = wx; global.getApp = () => app; }
  async function page(name, options = {}) {
    activate(); let definition; global.Page = value => { definition = value; };
    const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js'); delete require.cache[file]; require(file);
    const p = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
    pages.push(p); if (p.onLoad) p.onLoad(options); await p.onShow(); await settle(); await settle(); return p;
  }
  t.after(() => { activate(); pages.forEach(p => p.onUnload && p.onUnload()); });
  return { f, identity, session, app, wx, navigation, modals, toasts, choices, activate, page, loseReceipt: () => { lost = true; } };
}

test('invitation page creates a bounded agreement, applicant cannot view content before the owner confirms', async t => {
  const h = await harness(t), owner = await h.page('supervision-invite', { habitId: 'read' });
  assert.equal(owner.data.durationDays, 7); assert.equal(owner.data.deadline, '21:00'); assert.equal(owner.data.displayName, '');
  await owner.onCreate(); const inviteId = owner.data.invite.inviteId; assert.match(owner.onShareAppMessage().path, new RegExp(inviteId)); owner.onHide();
  const other = await harness(t, 'b', h.f), applicant = await other.page('supervision-invite', { inviteId });
  assert.equal(applicant.data.canApply, true); await applicant.onApply(); assert.equal(applicant.data.applied, true);
  assert.equal(h.f.tables.relations.size, 0); applicant.onHide();
  h.activate(); await owner.onShow(); await settle(); await settle(); assert.equal(owner.data.canConfirm, true, owner.data.error); await owner.onConfirm(); assert.equal(h.f.tables.relations.size, 1);
  assert.match(h.navigation.at(-1), /supervision-detail/);
});

test('supervision detail projects minimum/rest states, fixed encouragement and next-day rule updates through the real APIs', async t => {
  const h = await harness(t); const agreement = await h.f.agreement();
  await h.f.mutate({ type: 'completeMinimum', id: 'read', date: dates.today() });
  const owner = await h.page('supervision-detail', { id: agreement.supervision.supervisionId });
  assert.equal(owner.data.dayLabel, '忙时已完成'); assert.equal(owner.data.days[0].canEncourage, false);
  owner.onTime({ detail: { value: '22:00' } }); owner.onPhoto({ detail: { value: true } }); await owner.onSaveRules();
  assert.equal(owner.data.item.rules.photoRequired, false); assert.equal(owner.data.item.pendingRules.photoRequired, true); owner.onHide();
  const other = await harness(t, 'b', h.f), supervisor = await other.page('supervision-detail', { id: agreement.supervision.supervisionId });
  assert.equal(supervisor.data.days[0].canEncourage, true); await supervisor.onEncourage({ currentTarget: { dataset: { date: dates.today() } } });
  assert.equal(supervisor.data.days[0].encouraged, true); await supervisor.onRefresh(); assert.equal(supervisor.data.days[0].encouraged, true, 'encouragement survives a server read');
  supervisor.onHide(); h.activate(); await owner.onShow(); await settle(); await settle(); await owner.onRefresh(); assert.equal(owner.data.days[0].encouraged, true, 'subject can see the fixed feedback'); owner.onHide(); other.activate(); await supervisor.onShow(); await settle(); await settle();
  supervisor.onEnd(); await other.modals.at(-1).success({ confirm: false });
  assert.equal(supervisor.data.item.status, 'active'); await other.modals.at(-1).success({ confirm: true }); await settle();
  assert.equal(supervisor.data.item.status, 'ended');
  assert.equal(supervisor.data.days.length, 0, 'ending clears the displayed record projection');supervisor.onHide();h.activate();await owner.onShow();await settle();await settle();
  assert.equal(owner.data.item, null, 'a fresh read after the other member ends cannot retain old shared content');assert.equal(owner.data.days.length, 0);
});

test('today opens the required photo sheet and keeps an uncertain write until the original cloud receipt confirms', async t => {
  const h = await harness(t); await h.f.agreement({ required: true }); const p = await h.page('today'); await p.loadSupervisions();
  const task = p.data.pending[0]; assert.equal(task.photoRequired, true); assert.equal(p.data.largeFont, true);
  p.recordCompletion(task.id, task.date, 'completeMinimum'); assert.equal(p.data.photoOpen, true); assert.equal(h.session.read().records['read@' + task.date], undefined);
  p.onPhotoChoose(); h.choices.at(-1).success({ tempFiles: [{ tempFilePath: 'photo.png' }] }); await settle(); await settle(); await settle();
  assert.equal(p.data.photoCanSubmit, true); h.loseReceipt(); assert.equal(await p.onPhotoSubmit(), false);
  assert.equal(p.data.photoPending, true); assert.equal(p.data.photoItems.length, 1); assert.equal(h.session.status().phase, 'uncertain');
  assert.equal(await p.onPhotoSubmit(), true); assert.equal(h.session.read().records['read@' + task.date].status, 'minimum'); assert.equal(p.data.photoOpen, false);
  assert.equal(h.f.tables.bindings.size, 1); assert.equal(h.toasts.filter(item => item.title === '打卡成功').length, 0, 'unknown receipt does not show an early success');
  await settle(); await settle(); await p.loadMediaStatuses(true); assert.equal(p.data.completed[0].photosPending, true); assert.equal(p.data.completed[0].photoCount, 1);
});

test('ordinary check-in remains one tap and PHOTO_REQUIRED from the core opens a sheet even without a cached relationship', async t => {
  const h = await harness(t), p = await h.page('today'); const task = p.data.pending[0];
  assert.equal(await p.recordCompletion(task.id, task.date, 'complete'), true); assert.equal(p.data.photoOpen, false);
  await p.recordCompletion(task.id, task.date, 'undo'); await h.f.agreement({ required: true }); p._photoRequirements = {}; p.refresh();
  assert.equal(await p.recordCompletion(task.id, task.date, 'complete'), false); assert.equal(p.data.photoOpen, true);
  assert.equal(h.session.read().records['read@' + task.date].status, 'pending');
});

test('photo editor explicitly confirms deletion of the last required image and refreshes the trusted core snapshot', async t => {
  const h = await harness(t); await h.f.agreement({ required: true }); const photo = await h.f.photo();
  await h.f.mutate({ type: 'complete', id: 'read', date: dates.today(), mediaIds: [photo.media.mediaId] }); await h.session.refresh();
  const p = await h.page('photo-record', { habitId: 'read', date: dates.today() }); assert.equal(p.data.images.length, 1);
  p.onTogglePhoto({ currentTarget: { dataset: { id: photo.media.mediaId } } }); p.onSaveRemoval(); assert.match(h.modals.at(-1).title, /撤销打卡/);
  await h.modals.at(-1).success({ confirm: false }); assert.equal(h.session.read().records['read@' + dates.today()].status, 'standard');
  await h.modals.at(-1).success({ confirm: true }); await settle(); await settle(); assert.equal(h.session.read().records['read@' + dates.today()].status, 'pending');
  assert.equal(p.data.images.length, 0);
  assert.equal(p.data.editable, false, 'an undone record cannot accept attachment editing'); assert.equal(p.data.record.recordStatus, 'pending');
});

test('completed day becomes a scheduled agreement and today opens the overdue supervisor tab with only supervised items counted',async t=>{
  const h=await harness(t);await h.f.mutate({type:'complete',id:'read',date:dates.today()});await h.session.refresh();
  const relation=await h.f.agreement();const p=await h.page('supervision-detail',{id:relation.supervision.supervisionId});
  assert.equal(p.data.item.status,'scheduled');assert.equal(p.data.days.length,0);assert.equal(p.data.item.startDate,dates.shift(dates.today(),1));p.onHide();
  const f=await supervisionFixture(),invite=await f.request('createSupervisionInvite',{habitId:'read',deadline:'00:00'});
  await f.request('applySupervision',{inviteId:invite.invite.inviteId},f.b);await f.request('confirmSupervision',{inviteId:invite.invite.inviteId});
  const other=await harness(t,'b',f),today=await other.page('today');await today.loadSupervisions();
  assert.equal(today.data.supervisionCount,1);assert.equal(today.data.supervisionOverdue,1);today.onSupervisions();assert.match(other.navigation.at(-1),/tab=supervisor/);
});

test('reminder selection controls its default time, preserves a custom time on return, and each recipient chooses whether to subscribe',async t=>{
  const h=await harness(t);const edited=await h.f.mutate({type:'edit',id:'read',baseRevision:1,plan:{title:'阅读',target:5,minimum:2,unit:'分钟',weekdays:[1,2,3,4,5,6,7],time:'18:30'}});assert.equal(edited.ok,true);await h.session.refresh();
  const subscriptions=[],saved=[];const context=()=>h.app.store.contextKey();let previewCount=0;
  h.app.featuresClient={status:()=>({enabled:false,reminders:true}),contextKey:context,reminders:async()=>[],cachedPreferences:()=>null,
    reminderPreview:async input=>({context:context(),...input,templateId:input.type==='self'?'self-template':'supervisor-template',sourceRevision:1,generation:0,scopeFingerprint:'a'.repeat(64),operationId:'preview-'+(++previewCount),dueAt:input.businessDate+'T10:30:00.000Z',items:[{habitId:'read',title:'阅读'}]}),
    scheduleReminder:async preview=>{saved.push(preview);return {...preview,status:'pending',generation:1};}};
  h.wx.requestSubscribeMessage=input=>subscriptions.push(input);
  const p=await h.page('reminder',{habitId:'read',date:dates.shift(dates.today(),1)});
  await p.loadCandidates();assert.deepEqual(p.data.selectedIds,['read']);assert.equal(p.data.time,'18:30');
  await p.onPreview();assert.equal(p.data.preview.slot,'18:30');p.onTime({detail:{value:'19:07'}});assert.equal(p.data.preview,null);
  await p.loadCandidates();assert.equal(p.data.time,'19:07');await p.onPreview();p.onSubscribe();
  assert.deepEqual(subscriptions[0].tmplIds,['self-template']);await subscriptions[0].success({'self-template':'reject'});assert.equal(saved.length,0);
  p.onSubscribe();await subscriptions[1].success({'self-template':'accept'});assert.equal(saved.length,1);assert.equal(p.data.items[0].status,'pending');
  p.onCandidate({currentTarget:{dataset:{id:'read'}}});assert.equal(p.data.selectedIds.length,0);await p.loadCandidates();assert.equal(p.data.selectedIds.length,0,'explicit deselection survives reload');
  p.onCandidate({currentTarget:{dataset:{id:'read'}}});await p.onPreview();p.onSubscribe();p.onHide();await subscriptions[2].success({'self-template':'accept'});assert.equal(saved.length,1,'hidden callback cannot register a new appointment');
});
