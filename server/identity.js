'use strict';
const crypto = require('node:crypto');
const { fail } = require('./protocol');
function authenticate(identity, allowedAppId, allowedSources) {
  // Shared FROM_* mapping is deliberately NOT guessed here. Production remains gated.
  if (!allowedAppId || !Array.isArray(allowedSources) || !identity || identity.APPID !== allowedAppId ||
    !allowedSources.includes(identity.SOURCE) || typeof identity.OPENID !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(identity.OPENID)) fail('UNAUTHORIZED', '未取得有效的小程序身份');
  return crypto.createHash('sha256').update(identity.APPID + ':' + identity.OPENID).digest('hex');
}
function businessEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(event))) return event;
  const { userInfo, tcbContext, ...request } = event;
  return request;
}
module.exports = { authenticate, businessEvent };
