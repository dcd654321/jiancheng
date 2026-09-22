'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { apiFunction } = require('../miniprogram/config/cloud-resources');
const root = path.resolve(__dirname, '../cloudfunctions', apiFunction);

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((result, entry) => {
    if (entry.name === 'node_modules') return result;
    const full = path.join(directory, entry.name);
    return result.concat(entry.isDirectory() ? files(full) : full);
  }, []);
}

const targets = files(root).filter(file => /\.(?:js|cjs)$/.test(file));
targets.forEach(file => {
  new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
});

const sdk = require(path.join(root, 'node_modules/wx-server-sdk'));
const randomUUID = require('crypto').randomUUID;
if (!sdk || typeof randomUUID !== 'function') throw Error('Node 16 SDK/runtime check failed');

console.log(`PASS Node16 syntax: ${targets.length} files; wx-server-sdk loaded; crypto.randomUUID available`);
