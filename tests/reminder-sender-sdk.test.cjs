const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSender } = require('../server/reminder-worker');
const sdkPath = path.resolve(__dirname, '../cloudfunctions/jiancheng_daka_api/node_modules/wx-server-sdk');

// Decode only protobuf wire kinds used in the locked SDK's CommApiData and pairs.
function fields(bytes) {
  let offset = 0;
  const varint = () => { let value = 0, shift = 0, byte; do { byte = bytes[offset++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128); return value; };
  const result = [];
  while (offset < bytes.length) {
    const tag = varint(), wire = tag & 7, id = tag >> 3;
    if (wire === 0) result.push({ id, value: varint() });
    else { assert.equal(wire, 2); const length = varint(); result.push({ id, value: bytes.subarray(offset, offset + length) }); offset += length; }
  }
  return result;
}

test('locked SDK encodes consumer AppID for subscription sending in shared environments and keeps kind-specific templates',
  { skip: !fs.existsSync(sdkPath) && '请安装锁定业务云SDK' }, async t => {
    const http = require('node:http'), https = require('node:https');
    const original = { http: http.request, https: https.request, fetch: global.fetch };
    http.request = https.request = global.fetch = () => { throw Error('REMINDER_OPENAPI_NETWORK_FORBIDDEN'); };
    t.after(() => { http.request = original.http; https.request = original.https; global.fetch = original.fetch; });
    const cloud = require(sdkPath); cloud.init({ env: 'reminder-sender-local-contract' });
    let internal;
    cloud.registerService({ createService: context => { internal = context; return { name: 'reminder-sender-sdk-contract', getAPIs: () => ({}) }; } });
    const originalOpenApi = internal.provider.api.callWXOpenAPI, calls = [];
    internal.provider.api.callWXOpenAPI = async input => {
      const encoded = fields(input.data), apiData = encoded.find(field => field.id === 2).value;
      const pairs = Object.fromEntries(fields(apiData).map(field => {
        const pair = fields(field.value);
        return [pair.find(entry => entry.id === 1).value.toString(), JSON.parse(pair.find(entry => entry.id === 2).value.toString())];
      }));
      calls.push({ api: input.api, appId: encoded.find(field => field.id === 6).value.toString(), pairs });
      return { contentType: 'application/json', respData: Buffer.from('{"errcode":0}') };
    };
    t.after(() => { internal.provider.api.callWXOpenAPI = originalOpenApi; });
    const consumer = 'wx58e61dffcbfa4249', mapping = { text: 'thing1', count: 'number2', time: 'time3' };
    const send = createSender(cloud, { appId: consumer, templateIds: { self: 'self-sdk-template', supervisor: 'supervisor-sdk-template' },
      fieldsByType: { self: mapping, supervisor: mapping }, state: 'trial' });
    for (const type of ['self', 'supervisor']) {
      assert.equal((await send({ type, recipient: 'consumer-recipient', count: 2, businessDate: '2026-10-13', slot: '20:00' })).errCode, 0);
    }
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.api, 'subscribeMessage.send'); assert.equal(call.appId, consumer);
      assert.equal(call.pairs.touser, 'consumer-recipient'); assert.equal(call.pairs.miniprogram_state, 'trial');
      assert.deepEqual(call.pairs.data.number2, { value: '2' });
    }
    assert.equal(calls[0].pairs.template_id, 'self-sdk-template'); assert.equal(calls[1].pairs.template_id, 'supervisor-sdk-template');
    assert.equal(calls[1].pairs.page, 'pages/supervision/index?tab=supervisor');
    assert.throws(() => createSender(cloud, { appId: 'client-injected', templateId: 'self-sdk-template', fields: mapping, state: 'trial' }));
  });
