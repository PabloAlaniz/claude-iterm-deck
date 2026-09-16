// Genera los PNG de icono de cada acción (lista de acciones y tecla por defecto)
// sin dependencias: PNG RGBA + zlib. Formas simples: fondo redondeado + glifo.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const inRounded = (u, v, r = 0.18) => {
  const cx = Math.max(r, Math.min(1 - r, u)), cy = Math.max(r, Math.min(1 - r, v));
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
};
const circle = (u, v, cx, cy, r) => (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
const tri = (u, v, dir) => {
  const x = dir === "right" ? 1 - u : u;
  return x >= 0.3 && x <= 0.72 && Math.abs(v - 0.5) <= (x - 0.3) / 0.42 * 0.3;
};
const rect = (u, v, x0, y0, x1, y1) => u >= x0 && u <= x1 && v >= y0 && v <= y1;

const ICONS = {
  tab: (u, v) => circle(u, v, 0.5, 0.36, 0.13) ? hex("#4ade80") : rect(u, v, 0.25, 0.6, 0.75, 0.7) ? hex("#e8fff0") : hex("#1f6b3a"),
  answer: (u, v) => circle(u, v, 0.5, 0.5, 0.3) && !circle(u, v, 0.5, 0.5, 0.2) ? hex("#ffb347") : rect(u, v, 0.46, 0.35, 0.54, 0.65) ? hex("#ffb347") : hex("#b4530a"),
  iterm: (u, v) => rect(u, v, 0.22, 0.3, 0.78, 0.7) ? (tri(u, v, "right") && u < 0.55 && u > 0.28 ? hex("#4ade80") : hex("#0b0b0b")) : hex("#3a3a3a"),
  nav: (u, v) => tri(u, v, "left") || tri(u, v, "right") ? hex("#e5e5e5") : hex("#202020"),
  esc: (u, v) => rect(u, v, 0.2, 0.3, 0.8, 0.7) && !rect(u, v, 0.26, 0.36, 0.74, 0.64) ? hex("#f87171") : hex("#202020"),
  enter: (u, v) => rect(u, v, 0.62, 0.28, 0.7, 0.55) || rect(u, v, 0.35, 0.47, 0.7, 0.55) || tri(u, v, "left") && u < 0.45 && u > 0.2 ? hex("#4ade80") : hex("#202020"),
  info: (u, v) => rect(u, v, 0.25, 0.3, 0.55, 0.36) || rect(u, v, 0.25, 0.47, 0.75, 0.53) || rect(u, v, 0.25, 0.64, 0.65, 0.7) ? hex("#e5e5e5") : hex("#1d3f8f"),
  view: (u, v) => (rect(u, v, 0.2, 0.25, 0.46, 0.46) || rect(u, v, 0.54, 0.54, 0.8, 0.75)) ? hex("#e5e5e5") : (rect(u, v, 0.54, 0.25, 0.8, 0.46) || rect(u, v, 0.2, 0.54, 0.46, 0.75)) ? hex("#777") : hex("#202020"),
  setup: (u, v) => circle(u, v, 0.5, 0.5, 0.3) && !circle(u, v, 0.5, 0.5, 0.18) ? hex("#4ade80") : hex("#202020"),
  usage: (u, v) => circle(u, v, 0.5, 0.5, 0.36) && !circle(u, v, 0.5, 0.5, 0.24) ? (v < 0.5 || u > 0.5 ? hex("#22c55e") : hex("#333")) : hex("#202020"),
  mode: (u, v) => rect(u, v, 0.25, 0.3, 0.75, 0.42) || rect(u, v, 0.25, 0.58, 0.75, 0.7) ? hex("#e5e5e5") : hex("#202020"),
};

const out = process.argv[2] ?? "com.pabloalaniz.claude-iterm-deck.sdPlugin/imgs/actions";
mkdirSync(out, { recursive: true });

// Ícono del plugin (marketplace / categoría): terminal con prompt verde y punto naranja de "waiting".
const PLUGIN_ICON = (u, v) =>
  rect(u, v, 0.16, 0.22, 0.84, 0.78)
    ? (rect(u, v, 0.26, 0.44, 0.36, 0.5) || rect(u, v, 0.36, 0.38, 0.42, 0.56) && u - 0.36 < (v < 0.47 ? v - 0.38 : 0.56 - v) + 0.01 ? hex("#4ade80")
      : rect(u, v, 0.48, 0.55, 0.7, 0.6) ? hex("#4ade80")
      : circle(u, v, 0.74, 0.32, 0.06) ? hex("#ffb347")
      : hex("#0b0b0b"))
    : hex("#2a2a2a");
const pluginDir = out.replace(/\/actions$/, "/plugin");
mkdirSync(pluginDir, { recursive: true });
for (const [name, size] of [["marketplace", 288], ["marketplace@2x", 512], ["category-icon", 28], ["category-icon@2x", 56]]) {
  const iconFn = name.startsWith("category")
    ? (u, v) => (rect(u, v, 0.1, 0.2, 0.9, 0.8) ? (rect(u, v, 0.25, 0.45, 0.6, 0.55) ? hex("#e5e5e5") : hex("#202020")) : hex("#e5e5e5"))
    : PLUGIN_ICON;
  writeFileSync(`${pluginDir}/${name}.png`, png(size, (u, v) => (inRounded(u, v, name.startsWith("category") ? 0.3 : 0.18) ? [...iconFn(u, v), 255] : [0, 0, 0, 0])));
}
for (const [name, fn] of Object.entries(ICONS)) {
  for (const [suffix, size] of [["", 72], ["@2x", 144]]) {
    writeFileSync(`${out}/${name}${suffix}.png`, png(size, (u, v) => (inRounded(u, v) ? [...fn(u, v), 255] : [0, 0, 0, 0])));
  }
}
console.log(`Iconos generados en ${out}`);
