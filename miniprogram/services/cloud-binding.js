'use strict';

const CONSENT_SUFFIX = 'yidian.cloud.consent.v1';
const BINDING_SUFFIX = 'yidian.cloud.binding.v1';
const ACCOUNT = /^[a-f0-9]{64}$/;

function cloudStorageScope(envId, namespace = '') {
  if (typeof envId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(envId)) {
    throw Error('云环境标识无效');
  }
  if (typeof namespace !== 'string' || (namespace && !/^[a-z][a-z0-9_]{0,39}$/.test(namespace))) {
    throw Error('云数据命名空间无效');
  }
  // No namespace keeps the old test binding byte-for-byte; new data never imports it.
  return `yidian.cloud.env:${envId}:` + (namespace ? `app:${namespace}:` : '');
}

function createCloudBinding(wxApi, envId, namespace = '') {
  const scope = cloudStorageScope(envId, namespace);
  const keys = { consent: scope + CONSENT_SUFFIX, binding: scope + BINDING_SUFFIX };

  function write(key, value) {
    try {
      wxApi.setStorageSync(key, value);
    } catch (_) {
      throw Error('云账户设置保存失败，请检查本机空间');
    }
  }

  return {
    keys,
    consented: () => wxApi.getStorageSync(keys.consent) === true,
    accept() {
      write(keys.consent, true);
    },
    accountId() {
      const value = wxApi.getStorageSync(keys.binding);
      if (value == null || value === '') return '';
      if (!ACCOUNT.test(value)) throw Error('云账户绑定损坏，已停止读取');
      return value;
    },
    bind(accountId) {
      if (!ACCOUNT.test(accountId || '')) throw Error('云账户标识无效');
      write(keys.binding, accountId);
    }
  };
}

module.exports = { createCloudBinding, cloudStorageScope, CONSENT_SUFFIX, BINDING_SUFFIX };
