'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
for (const script of ['build-themes.cjs', 'generate-tab-icons.cjs', 'generate-menu-icons.cjs']) {
  execFileSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit', windowsHide: true });
}
