// 纯 Node PNG 工具：解码（支持 filter 0-4）→ 裁剪 → 最近邻放大 → 重编码；
// 另可采样指定坐标的像素值，用于在开发者工具截图中核对真实渲染色。
const fs = require('node:fs');
const zlib = require('node:zlib');

function decode(file) {
  const buffer = fs.readFileSync(file);
  let offset = 8, width = 0, height = 0, colorType = 0, bitDepth = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType)) throw Error('只支持 8bit RGB/RGBA');
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels, pixels = Buffer.alloc(height * stride);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor]; cursor += 1;
    const line = raw.subarray(cursor, cursor + stride); cursor += stride;
    const prior = y === 0 ? Buffer.alloc(stride) : pixels.subarray((y - 1) * stride, y * stride);
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? out[x - channels] : 0;
      const up = prior[x], upLeft = x >= channels ? prior[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        value += (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft);
      }
      out[x] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function encode(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const crcTable = [];
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc = buffer => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'ascii');
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function toRgba(image) {
  if (image.channels === 4) return image.pixels;
  const rgba = Buffer.alloc(image.width * image.height * 4);
  for (let i = 0, j = 0; i < image.pixels.length; i += 3, j += 4) {
    rgba[j] = image.pixels[i]; rgba[j + 1] = image.pixels[i + 1]; rgba[j + 2] = image.pixels[i + 2]; rgba[j + 3] = 255;
  }
  return rgba;
}

function cropZoom(file, out, x, y, w, h, zoom = 4) {
  const image = decode(file), rgba = toRgba(image);
  const width = w * zoom, height = h * zoom, target = Buffer.alloc(width * height * 4);
  for (let ty = 0; ty < height; ty += 1) for (let tx = 0; tx < width; tx += 1) {
    const sx = Math.min(image.width - 1, x + Math.floor(tx / zoom)), sy = Math.min(image.height - 1, y + Math.floor(ty / zoom));
    const source = (sy * image.width + sx) * 4, dest = (ty * width + tx) * 4;
    rgba.copy(target, dest, source, source + 4);
  }
  fs.writeFileSync(out, encode(width, height, target));
  return { width, height };
}

function sample(file, points) {
  const image = decode(file), rgba = toRgba(image);
  return points.map(([x, y]) => {
    const at = (y * image.width + x) * 4;
    const hex = '#' + [rgba[at], rgba[at + 1], rgba[at + 2]].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    return { x, y, hex };
  });
}

module.exports = { decode, encode, cropZoom, sample, toRgba };

if (require.main === module) {
  const [command, file, out, ...rest] = process.argv.slice(2);
  if (command === 'crop') console.log(JSON.stringify(cropZoom(file, out, ...rest.map(Number))));
  else if (command === 'sample') {
    const points = []; for (let i = 0; i < rest.length; i += 2) points.push([Number(rest[i]), Number(rest[i + 1])]);
    console.log(JSON.stringify(sample(file, points)));
  }
}
