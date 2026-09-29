'use strict';
const crypto = require('node:crypto');
const { fail } = require('./protocol');
// Shared-environment calls are cross-account: the caller's identity arrives in
// FROM_APPID/FROM_OPENID while APPID/OPENID stay scoped to the resource environment.
// Non-shared calls keep using APPID/OPENID unchanged.
function callerIdentity(identity) {
  if (!identity || typeof identity !== 'object') return identity;
  const shared = (identity.FROM_APPID !== undefined && identity.FROM_APPID !== '') ||
    (identity.FROM_OPENID !== undefined && identity.FROM_OPENID !== '');
  if (!shared) return identity;
  return { APPID: identity.FROM_APPID, OPENID: identity.FROM_OPENID, SOURCE: identity.SOURCE };
}
function authenticate(identity, allowedAppId, allowedSources) {
  const caller = callerIdentity(identity);
  if (!allowedAppId || !Array.isArray(allowedSources) || !caller || caller.APPID !== allowedAppId ||
    !allowedSources.includes(caller.SOURCE) || typeof caller.OPENID !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(caller.OPENID)) fail('UNAUTHORIZED', '未取得有效的小程序身份');
  return crypto.createHash('sha256').update(caller.APPID + ':' + caller.OPENID).digest('hex');
}
function businessEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(event))) return event;
  const { userInfo, tcbContext, ...request } = event;
  return request;
}
module.exports = { authenticate, businessEvent };
