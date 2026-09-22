'use strict';

// Unsaved text lives only in this app session, never in local storage or the cloud.
function createNoteDrafts() {
  let context = '', drafts = new Map();
  function scope(key) {
    if (key !== context) { context = key; drafts.clear(); }
  }
  return {
    read(key, id) { scope(key); return drafts.get(id) || null; },
    set(key, id, date, text) { scope(key); drafts.set(id, { date, text }); },
    remove(key, id, expected) {
      if (key !== context) return;
      const draft = drafts.get(id);
      if (!expected || (draft && draft.date === expected.date && draft.text === expected.text)) drafts.delete(id);
    },
    clear() { drafts.clear(); context = ''; }
  };
}

module.exports = { createNoteDrafts };
