'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'miniprogram', 'assets', 'tabbar');
const colors = { normal: '#65756c', selected: '#245c44' };

const drawings = {
  today: `
    <circle cx="40.5" cy="40.5" r="23" />
    <path d="M28 40.5 L36.5 49 L54 31" />`,
  progress: `
    <path d="M21 55 V46 M38 55 V36 M55 55 V25" />
    <path d="M20 36 L34 29 L45 32 L59 20 M52 20 H59 V27" />`,
  mine: `
    <circle cx="40.5" cy="29.5" r="10" />
    <path d="M21 58 C23.5 47.5 30.5 42 40.5 42 C50.5 42 57.5 47.5 60 58" />`
};

function svg(body, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="81" height="81" viewBox="0 0 81 81">
    <g fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
      ${body}
    </g>
  </svg>`;
}

async function generate() {
  fs.mkdirSync(output, { recursive: true });
  for (const [name, drawing] of Object.entries(drawings)) {
    for (const [state, color] of Object.entries(colors)) {
      const suffix = state === 'selected' ? '-selected' : '';
      await sharp(Buffer.from(svg(drawing, color)))
        .png({ compressionLevel: 9, palette: false })
        .toFile(path.join(output, `${name}${suffix}.png`));
    }
  }
}

generate().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
