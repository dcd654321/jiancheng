const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { HABIT_TEMPLATES } = require('../miniprogram/config/habit-templates');
const { OVERVIEW_ROUTE, OVERVIEW_PATH, TEMPLATE_ROUTE, STATIC_SHARE_IMAGE,
  PUBLIC_TEMPLATE_KEYS, SEARCH_TEMPLATES, INTRODUCTION, getSearchTemplate, templatePath } = require('../miniprogram/config/search-pages');

const mini = path.resolve(__dirname, '../miniprogram');
function harness(t, app = {}) {
  const pages = [], titles = [], menus = [], navigations = [];
  global.getApp = () => app;
  global.wx = { setNavigationBarTitle: options => titles.push(options.title),
    showShareMenu: options => menus.push(options.menus), navigateTo: options => navigations.push(options) };
  t.after(() => pages.forEach(page => page.onUnload && page.onUnload()));
  function page(name, options = {}, show = true) {
    let definition;
    global.Page = value => { definition = value; };
    const file = path.join(mini, 'pages', name, 'index.js');
    delete require.cache[file]; require(file);
    const result = { ...definition, data: structuredClone(definition.data),
      setData(value, callback) { Object.assign(this.data, value); if (callback) callback(); } };
    pages.push(result);
    if (result.onLoad) result.onLoad(options);
    if (show && result.onShow) result.onShow();
    return result;
  }
  return { page, titles, menus, navigations };
}

test('public overview and all templates are readable without an account, pending bootstrap or network', t => {
  const forbidden = () => { throw Error('Public pages must not access account bootstrap or data'); };
  const app = {};
  for (const field of ['store', 'cloudSession', 'dataReady', 'ensureAccountReady']) Object.defineProperty(app, field, { get: forbidden });
  const h = harness(t, app), overview = h.page('discover', { id: 'private-do-not-display' });
  assert.equal(overview.data.intro.title, INTRODUCTION.title);
  assert.equal(overview.data.templates.length, 4);
  for (const plan of HABIT_TEMPLATES) {
    const page = h.page('template', { key: plan.key });
    assert.equal(page.data.template.habitTitle, plan.title);
    assert.equal(page.data.template.target, plan.target);
    assert.equal(page.data.template.minimum, plan.minimum);
    assert.equal(page.data.template.unit, plan.unit);
    assert.equal(page.data.template.steps.length, 3);
    assert.equal(page.data.related.length, 3);
    assert.equal(page._dayTimer, undefined);
  }
  assert.deepEqual(h.navigations, [], 'merely opening public content never enters account actions');
  assert.ok(h.menus.every(menu => menu.length === 1 && menu[0] === 'shareAppMessage'), 'public pages do not enable timeline');

  global.getApp = () => { throw Error('no application context'); };
  assert.doesNotThrow(() => h.page('discover'));
  assert.doesNotThrow(() => h.page('template', { key: 'read' }));
});

test('template choice sends only a safe key and enters the existing confirmation flow without saving', t => {
  const views = [], choices = [], h = harness(t, { searchAttribution: {
    viewPage: value => views.push(value), chooseTemplate: key => choices.push(key) } });
  h.page('discover');
  assert.deepEqual(views[0], { route: OVERVIEW_ROUTE });
  for (const key of PUBLIC_TEMPLATE_KEYS) {
    const page = h.page('template', { key, id: 'private-id', source: 'untrusted-source' });
    assert.deepEqual(views.at(-1), { route: TEMPLATE_ROUTE, templateKey: key });
    page.onUseTemplate();
    assert.equal(choices.at(-1), key);
    assert.equal(h.navigations.at(-1).url, '/pages/edit/index?template=' + key);
    assert.equal(page.data.template.key, key, 'public content stays available until confirmation');
  }
  const page = h.page('template', { key: 'read' });
  page.onUseTemplate(); h.navigations.at(-1).fail();
  assert.match(page.data.error, /习惯尚未创建/);
  page.onHide(); h.navigations.at(-1).fail();
  assert.equal(page.data.template.key, 'read');
});

test('unknown or non-string keys are never reflected, tracked or used to create habits', t => {
  const views = [], choices = [], h = harness(t, { searchAttribution: {
    viewPage: value => views.push(value), chooseTemplate: key => choices.push(key) } });
  const invalid = [undefined, null, '', 'unknown-private-input', '__proto__', 'constructor', 'read&accountId=private',
    'read%26id%3Dprivate', ['read'], { toString: () => 'read' }, 1];
  for (const key of invalid) {
    assert.equal(getSearchTemplate(key), null);
    assert.equal(templatePath(key), OVERVIEW_PATH);
    const page = h.page('template', { key });
    assert.equal(page.data.template, null);
    assert.deepEqual(page.data.related, []);
    assert.equal(page.onShareAppMessage().path, OVERVIEW_PATH);
    assert.equal(page.onShareAppMessage().title, INTRODUCTION.shareTitle);
    assert.equal(h.titles.at(-1), '查看习惯模板 · 渐成');
    page.onUseTemplate();
  }
  assert.deepEqual(views, []); assert.deepEqual(choices, []); assert.deepEqual(h.navigations, []);
});

test('public sharing contains canonical official paths and a valid local 5:4 PNG only', t => {
  const h = harness(t), overview = h.page('discover', { query: 'private' });
  const cover = fs.readFileSync(path.join(mini, STATIC_SHARE_IMAGE));
  assert.equal(cover.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = cover.readUInt32BE(16), height = cover.readUInt32BE(20);
  assert.ok(width >= 500 && height >= 400); assert.equal(width / height, 5 / 4);
  for (const page of [overview, ...PUBLIC_TEMPLATE_KEYS.map(key => h.page('template', { key, id: 'private', token: 'secret' }))]) {
    const share = page.onShareAppMessage();
    assert.deepEqual(Object.keys(share).sort(), ['imageUrl', 'path', 'title']);
    assert.equal(share.imageUrl, STATIC_SHARE_IMAGE);
    assert.ok([OVERVIEW_PATH, ...PUBLIC_TEMPLATE_KEYS.map(templatePath)].includes(share.path));
    assert.doesNotMatch(JSON.stringify(share), /private|secret|accountId|token|source=/);
  }
  assert.equal(h.page('mine', {}, false).onShareAppMessage().path, OVERVIEW_PATH, 'the ordinary app invitation opens public content');
});

test('public theme subscriptions follow cached appearance and release on hide and unload', t => {
  let theme = 'paper', reads = 0;
  const listeners = new Set(), controller = {
    view: () => ({ theme }), subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); },
    ensureRead() { reads += 1; throw Error('must not read themes on public pages'); }
  };
  const h = harness(t, { appearanceController: controller }), page = h.page('template', { key: 'read' });
  assert.equal(page.data.theme, 'paper'); assert.equal(listeners.size, 1);
  theme = 'mist'; listeners.forEach(listener => listener());
  assert.equal(page.data.theme, 'mist');
  page.onHide(); assert.equal(listeners.size, 0);
  theme = 'paper'; page.onShow(); assert.equal(page.data.theme, 'paper'); assert.equal(listeners.size, 1);
  page.onShow(); assert.equal(listeners.size, 1, 'repeated show does not leak subscriptions');
  page.onUnload(); assert.equal(listeners.size, 0); assert.equal(reads, 0);
});

test('public page analytics failures do not block content, template navigation or sharing', t => {
  const unavailable = () => { throw Error('telemetry unavailable'); };
  const h = harness(t, { onPublicContentShown: unavailable, searchAttribution: { viewPage: unavailable, chooseTemplate: unavailable } });
  assert.doesNotThrow(() => h.page('discover'));
  const page = h.page('template', { key: 'read' });
  assert.doesNotThrow(() => page.onUseTemplate());
  assert.equal(h.navigations[0].url, '/pages/edit/index?template=read');
  assert.equal(page.onShareAppMessage().path, templatePath('read'));
});

test('every public page show stops private foreground work, including invalid templates and returning from edit', t => {
  let publicShows = 0;
  const h = harness(t, { onPublicContentShown() { publicShows += 1; } });
  h.page('discover');
  const template = h.page('template', { key: 'read' });
  h.page('template', { key: 'unknown' });
  assert.equal(publicShows, 3);
  template.onHide(); template.onShow();
  assert.equal(publicShows, 4, 'returning from account confirmation resumes the public lifecycle');
});

test('sitemap permits only exact public parameters and denies every private route', () => {
  const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'));
  const sitemap = JSON.parse(fs.readFileSync(path.join(mini, app.sitemapLocation), 'utf8'));
  assert.deepEqual(sitemap.rules, [
    { action: 'allow', page: OVERVIEW_ROUTE, params: [], matching: 'exact' },
    { action: 'allow', page: TEMPLATE_ROUTE, params: ['key'], matching: 'exact' },
    { action: 'disallow', page: '*' }
  ]);
  const indexed = (route, query = {}) => {
    const keys = Object.keys(query).sort();
    const rule = sitemap.rules.find(item => (item.page === '*' || item.page === route) &&
      (!item.params || JSON.stringify(item.params.slice().sort()) === JSON.stringify(keys)));
    return rule && rule.action === 'allow';
  };
  assert.equal(indexed(OVERVIEW_ROUTE), true);
  assert.equal(indexed(OVERVIEW_ROUTE, { id: 'private' }), false);
  for (const key of PUBLIC_TEMPLATE_KEYS) {
    assert.equal(indexed(TEMPLATE_ROUTE, { key }), true);
    assert.equal(indexed(TEMPLATE_ROUTE, { key, id: 'private' }), false);
  }
  assert.equal(indexed(TEMPLATE_ROUTE), false);
  for (const route of app.pages.filter(route => ![OVERVIEW_ROUTE, TEMPLATE_ROUTE].includes(route))) {
    assert.equal(indexed(route), false, route);
    assert.equal(indexed(route, { key: 'read' }), false, route);
    assert.equal(indexed(route, { id: 'private', token: 'private' }), false, route);
  }
  assert.ok(app.pages.includes(OVERVIEW_ROUTE)); assert.ok(app.pages.includes(TEMPLATE_ROUTE));
});

test('native links expose public template routes and mine keeps its introduction reachable during cloud failure', () => {
  const overview = fs.readFileSync(path.join(mini, OVERVIEW_ROUTE + '.wxml'), 'utf8');
  const detail = fs.readFileSync(path.join(mini, TEMPLATE_ROUTE + '.wxml'), 'utf8');
  const mine = fs.readFileSync(path.join(mini, 'pages/mine/index.wxml'), 'utf8');
  assert.match(overview, /<navigator\b[^>]*url="\{\{item.path\}\}"/);
  assert.match(detail, /<navigator\b[^>]*url="\{\{item.path\}\}"/);
  assert.match(detail, /<navigator\b[^>]*url="\{\{overviewPath\}\}"/);
  for (const markup of [overview, detail]) {
    for (const match of markup.matchAll(/<navigator\b[^>]*>/g)) assert.match(match[0], /open-type="redirect"/, 'repeated public browsing must leave room to open the confirmation page');
  }
  assert.doesNotMatch(mine.match(/<navigator\b[^>]*url="\/pages\/discover\/index"[^>]*>/)[0], /open-type="redirect"/, 'mine keeps a normal back route');
  assert.ok(mine.lastIndexOf('</block>') < mine.indexOf('url="' + OVERVIEW_PATH + '"'), 'the public intro is outside account-ready blocks');
  for (const item of SEARCH_TEMPLATES) assert.equal(item.path, templatePath(item.key));
});
