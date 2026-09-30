'use strict';

// Tab 图标生成脚本（纯 Node 实现，不依赖 sharp 等第三方包）。
// 用距离场光栅化 SVG 形状：对每个像素中心计算到线段/圆弧的距离，
// alpha = clamp(strokeRadius + 0.5 - distance, 0, 1) 做抗锯齿；
// 折线按线段距离取并集，转角自然得到 round 端点/连接效果（线宽 = 2 × strokeRadius）。
// PNG 由内置 zlib 编码：RGBA8、每行 filter 0、IHDR/IDAT/IEND + CRC32。
// 输出 miniprogram/assets/tabbar/ 下 81×81 的 9 个 PNG；脚本可重复执行（字节级幂等），不访问网络。

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'miniprogram', 'assets', 'tabbar');
const SIZE = 81;
const STROKE_RADIUS = 2.5;

// 颜色：normal 两主题共用；选中态区分主题（mist 薄雾绿 / paper 暖纸白）。
const COLORS = {
  normal: '#647067',
  'selected-mist': '#486557',
  'selected-paper': '#79604F'
};

// 三次贝塞尔曲线按 t 均分为折线（约定 20 段），供 mine 图标肩膀曲线使用。
function cubicPolyline(p0, c1, c2, p3, steps = 20) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    points.push([
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]
    ]);
  }
  return points;
}

// 把折线顶点展开为相邻点对组成的线段集合。
function segmentsOf(points) {
  const segments = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    segments.push([...points[i], ...points[i + 1]]);
  }
  return segments;
}

// 形状：arcs 为 [cx, cy, r] 的整圆描边；segments 为 [ax, ay, bx, by] 的线段。
// 坐标与视图 81×81 一一对应，来源于双主题视觉稿中的 SVG 路径。
const shapes = {
  today: {
    arcs: [[40.5, 40.5, 23]],
    segments: segmentsOf([[28, 40.5], [36.5, 49], [54, 31]])
  },
  progress: {
    arcs: [],
    segments: [
      ...segmentsOf([[21, 55], [21, 46]]),
      ...segmentsOf([[38, 55], [38, 36]]),
      ...segmentsOf([[55, 55], [55, 25]]),
      ...segmentsOf([[20, 36], [34, 29], [45, 32], [59, 20]]),
      ...segmentsOf([[52, 20], [59, 20], [59, 27]])
    ]
  },
  mine: {
    arcs: [[40.5, 29.5, 10]],
    segments: [
      ...segmentsOf(cubicPolyline([21, 58], [23.5, 47.5], [30.5, 42], [40.5, 42])),
      ...segmentsOf(cubicPolyline([40.5, 42], [50.5, 42], [57.5, 47.5], [60, 58]))
    ]
  }
};

// 输出文件清单：name → 文件名 + 颜色。selected 为各主题选中态，-paper 为暖纸白主题变体。
const outputs = [];
for (const name of Object.keys(shapes)) {
  outputs.push({ file: `${name}.png`, shape: name, color: COLORS.normal });
  outputs.push({ file: `${name}-selected.png`, shape: name, color: COLORS['selected-mist'] });
  outputs.push({ file: `${name}-selected-paper.png`, shape: name, color: COLORS['selected-paper'] });
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

// 点到线段的距离（端点夹紧），转角处即 round 端点/连接语义。
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// 光栅化：逐像素取到所有线段/圆弧的最小距离；圆弧距离为 |到圆心距离 − r|。
function rasterize(shape, hex) {
  const [red, green, blue] = hexToRgb(hex);
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      let distance = Infinity;
      for (const [cx, cy, radius] of shape.arcs) {
        distance = Math.min(distance, Math.abs(Math.hypot(px - cx, py - cy) - radius));
      }
      for (const [ax, ay, bx, by] of shape.segments) {
        distance = Math.min(distance, distanceToSegment(px, py, ax, ay, bx, by));
      }
      const alpha = Math.max(0, Math.min(1, STROKE_RADIUS + 0.5 - distance));
      if (alpha > 0) {
        const index = (y * SIZE + x) * 4;
        pixels[index] = red;
        pixels[index + 1] = green;
        pixels[index + 2] = blue;
        pixels[index + 3] = Math.round(alpha * 255);
      }
    }
  }
  return pixels;
}

// PNG 编码：CRC32 表（IEEE 多项式，与 zlib 一致）。
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const payload = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload), 0);
  return Buffer.concat([head, payload, crc]);
}

// 编码 RGBA8 PNG（color type 6，每行 filter 0）。
function encodePng(pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = SIZE * 4;
  const raw = Buffer.alloc((stride + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: None
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// 写入：内容相同则跳过，保证重复执行字节级幂等。
function writeIfChanged(file, buffer) {
  if (fs.existsSync(file) && fs.readFileSync(file).equals(buffer)) return false;
  fs.writeFileSync(file, buffer);
  return true;
}

function generate() {
  fs.mkdirSync(output, { recursive: true });
  for (const { file, shape, color } of outputs) {
    const png = encodePng(rasterize(shapes[shape], color));
    const target = path.join(output, file);
    const written = writeIfChanged(target, png);
    console.log(`${written ? '写入' : '跳过（未变化）'} ${path.relative(root, target)}（${png.length} 字节）`);
  }
}

generate();
