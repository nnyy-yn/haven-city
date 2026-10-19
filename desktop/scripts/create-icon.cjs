'use strict';

// Dependency-free PNG/ICO source for the desktop brand mark.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const output = path.join(__dirname, '..', 'assets');
fs.mkdirSync(output, { recursive: true });
const table = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(data.length);
  let check = 0xffffffff; for (const byte of Buffer.concat([name, data])) check = table[(check ^ byte) & 255] ^ (check >>> 8);
  crc.writeUInt32BE((check ^ 0xffffffff) >>> 0); return Buffer.concat([length, name, data, crc]);
}
function pixel(x, y) {
  const circle = (cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2;
  const rect = (left, top, right, bottom) => x >= left && x <= right && y >= top && y <= bottom;
  const radius = 44, cx = Math.max(radius, Math.min(256 - radius, x)), cy = Math.max(radius, Math.min(256 - radius, y));
  if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) return [0, 0, 0, 0];
  const background = [33 + y * .025, 74 + y * .035, 67 + y * .025, 255];
  const cream = [238, 236, 216, 255], gold = [209, 180, 117, 255], dark = [40, 81, 73, 255];
  if (circle(184, 63, 15)) return gold;
  if (rect(57, 92, 95, 174) || rect(103, 58, 144, 174) || rect(152, 109, 198, 174)) {
    if ((x > 66 && x < 86 && ((y > 104 && y < 113) || (y > 126 && y < 135))) || (x > 114 && x < 132 && ((y > 71 && y < 81) || (y > 94 && y < 104) || (y > 117 && y < 127))) || (x > 163 && x < 185 && y > 123 && y < 134)) return dark;
    if (x > 114 && x < 133 && y > 147) return dark;
    return cream;
  }
  if (rect(46, 175, 210, 181)) return cream;
  if (x > 48 && x < 208 && Math.abs(y - (197 + Math.sin((x - 50) / 27) * 5)) < 3) return gold;
  if (x > 70 && x < 190 && Math.abs(y - (214 + Math.sin((x - 45) / 27) * 4)) < 2) return [141, 176, 153, 255];
  return background;
}
function png(size) {
  const bytes = Buffer.alloc((size * 4 + 1) * size), sample = 3;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const rgba = [0, 0, 0, 0];
    for (let dy = 0; dy < sample; dy++) for (let dx = 0; dx < sample; dx++) {
      const color = pixel((px + (dx + .5) / sample) * 256 / size, (py + (dy + .5) / sample) * 256 / size);
      color.forEach((value, channel) => { rgba[channel] += value / (sample * sample); });
    }
    rgba.forEach((value, channel) => { bytes[py * (size * 4 + 1) + 1 + px * 4 + channel] = Math.round(value); });
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(bytes)), chunk('IEND', Buffer.alloc(0))]);
}
const sizes = [16, 24, 32, 48, 64, 128, 256], images = sizes.map(png), header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4); let offset = header.length;
sizes.forEach((size, index) => {
  const entry = 6 + index * 16; header[entry] = size === 256 ? 0 : size; header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6); header.writeUInt32LE(images[index].length, entry + 8); header.writeUInt32LE(offset, entry + 12); offset += images[index].length;
});
fs.writeFileSync(path.join(output, 'icon.ico'), Buffer.concat([header, ...images]));
fs.writeFileSync(path.join(output, 'icon.png'), images.at(-1));
