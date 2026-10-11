'use strict';
// 本次运行会话内存：退出丢失；不写本机存储、不排队上传。
function createFormDrafts() {
  let scope = '', serial = 0;
  const items = new Map(), clone = value => JSON.parse(JSON.stringify(value));
  function bind(key) { if (scope !== key) { scope = key; items.clear(); } }
  return {
    read(key, id) { bind(key); const item = items.get(id); return item ? clone(item) : null; },
    set(key, id, value, expectedVersion) {
      bind(key);
      const previous = items.get(id);
      // 页面只更新自己读取的版本；删除/淘汰后，旧实例不能重新写回旧输入。
      if (expectedVersion != null && expectedVersion !== (previous ? previous.version : 0)) return null;
      if (previous && JSON.stringify(previous.value) === JSON.stringify(value)) return previous.version;
      if (!previous && items.size >= 8) items.delete(items.keys().next().value);
      const version = ++serial; items.set(id, { version, value: clone(value) }); return version;
    },
    remove(key, id, version) {
      if (scope !== key) return;
      const item = items.get(id);
      if (item && (version == null || item.version === version)) items.delete(id);
    },
    clear() { items.clear(); scope = ''; }
  };
}
module.exports = { createFormDrafts };
