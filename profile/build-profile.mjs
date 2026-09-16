// Genera los perfiles (.streamDeckProfile) de Claude iTerm Deck para cada vista y dispositivo.
//
// Vistas para Stream Deck XL (8x4):
//   standard (4–7 sesiones): col 0 = vista | Esc | Enter | modo ; cols 1-7 = sesión N / 1 / 2 / 3
//   focus    (1–3 sesiones): col 0 = vista | setup | uso | iTerm ; por sesión 2 columnas:
//                            [sesión] [info] / [1] [Esc] / [2] [Enter] / [3] [modo] ; col 7 = Esc | Enter | ⇧⇥ | ◀
//   dense    (8+ sesiones):  filas 0-1 = 14 sesiones (col 0: vista, iTerm); fila 2 = info + 1 2 3 + Esc/Enter
//                            sobre la seleccionada + modo + uso; fila 3 = setup | Esc | Enter | ◀ | ▶
//   (tocar una sesión ya trae iTerm al frente; por eso "iTerm" no está en standard)
// Otros dispositivos (sin probar en hardware): Mini (3x2), MK.2 (5x3), Neo (4x2), + (4x2).
//
// Uso: node build-profile.mjs [--out <dir>] [--uuid-seed <texto>]
//   Los archivos se escriben en dist/ y, con --out, también en la carpeta del plugin
//   (para que el plugin pueda cambiar de vista con switchToProfile).
//   Formato: zip con <UUID>.sdProfile/manifest.json + Profiles/<PAGE>/manifest.json
//   (mismo esquema que ~/Library/Application Support/com.elgato.StreamDeck/ProfilesV3).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = "com.pabloalaniz.claude-iterm-deck";
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? true) : undefined;
};
const OUT_PLUGIN = flag("--out");
const SEED = String(flag("--uuid-seed") ?? "claude-iterm-deck-v1");

// UUIDs deterministas por nombre: reimportar reemplaza en vez de duplicar (cuando la app lo permite).
const uuidFor = (name) => {
  const h = createHash("sha1").update(SEED + name).digest("hex").toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-A${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// DeviceType (Elgato): 0 = Stream Deck (5x3), 1 = Mini (3x2), 2 = XL (8x4), 7 = Plus (4x2 + diales), 9 = Neo (4x2)
const DEVICES = {
  xl: { type: 2, model: "20GAT9901", cols: 8, rows: 4 },
  mk2: { type: 0, model: "20GBA9901", cols: 5, rows: 3 },
  mini: { type: 1, model: "20GAI9901", cols: 3, rows: 2 },
  neo: { type: 9, model: "20GBJ9901", cols: 4, rows: 2 },
  plus: { type: 7, model: "20GBD9901", cols: 4, rows: 2 },
};

const action = (uuid, name, settings = {}) => ({
  ActionID: uuidFor(`${name}/${JSON.stringify(settings)}/${Math.random()}`).toLowerCase(),
  LinkedTitle: true,
  Name: name,
  Resources: null,
  Settings: settings,
  State: 0,
  States: [{ ShowTitle: false, Title: "", TitleAlignment: "middle" }],
  UUID: `${PLUGIN}.${uuid}`,
});

const A = {
  iterm: () => action("iterm", "Ir a iTerm2"),
  esc: (slot) => action("esc", slot === undefined ? "Esc" : `Esc → sesión ${slot}`, slot === undefined ? {} : { slot: String(slot) }),
  enter: (slot) => action("enter", slot === undefined ? "Enter" : `Enter → sesión ${slot}`, slot === undefined ? {} : { slot: String(slot) }),
  mode: () => action("mode", "Modo (Shift+Tab)"),
  tab: (slot) => action("tab", `Sesión ${slot + 1}`, { slot: String(slot) }),
  answer: (slot, key) => action("answer", `Sesión ${slot === "sel" ? "sel." : slot + 1} → ${key}`, { slot: String(slot), key: String(key) }),
  info: (slot) => action("info", `Info sesión ${slot === "sel" ? "sel." : slot + 1}`, { slot: String(slot) }),
  view: (view) => action("view", `Vista ${view}`, { view }),
  setup: () => action("setup", "Setup"),
  usage: () => action("usage", "Uso"),
  prev: () => action("nav", "Tab anterior", { direction: "prev" }),
  next: () => action("nav", "Tab siguiente", { direction: "next" }),
};

/** Layouts: función (cols, rows) → { "col,row": action } */
const LAYOUTS = {
  standard: () => {
    const g = { "0,0": A.view("standard"), "0,1": A.esc(), "0,2": A.enter(), "0,3": A.mode() };
    for (let s = 0; s < 7; s++) {
      g[`${s + 1},0`] = A.tab(s);
      for (let k = 1; k <= 3; k++) g[`${s + 1},${k}`] = A.answer(s, k);
    }
    return g;
  },
  focus: () => {
    const g = { "0,0": A.view("focus"), "0,1": A.setup(), "0,2": A.usage(), "0,3": A.iterm() };
    for (let s = 0; s < 3; s++) {
      const a = 1 + s * 2, b = a + 1;
      g[`${a},0`] = A.tab(s); g[`${b},0`] = A.info(s);
      g[`${a},1`] = A.answer(s, 1); g[`${b},1`] = A.esc(s);
      g[`${a},2`] = A.answer(s, 2); g[`${b},2`] = A.enter(s);
      g[`${a},3`] = A.answer(s, 3); g[`${b},3`] = A.mode();
    }
    g["7,0"] = A.esc(); g["7,1"] = A.enter(); g["7,2"] = A.mode(); g["7,3"] = A.prev();
    return g;
  },
  dense: () => {
    const g = { "0,0": A.view("dense"), "0,1": A.iterm() };
    for (let s = 0; s < 14; s++) g[`${(s % 7) + 1},${Math.floor(s / 7)}`] = A.tab(s);
    g["0,2"] = A.info("sel");
    g["1,2"] = A.answer("sel", 1); g["2,2"] = A.answer("sel", 2); g["3,2"] = A.answer("sel", 3);
    g["4,2"] = A.esc("sel"); g["5,2"] = A.enter("sel"); g["6,2"] = A.mode(); g["7,2"] = A.usage();
    g["0,3"] = A.setup(); g["1,3"] = A.esc(); g["2,3"] = A.enter(); g["3,3"] = A.prev(); g["4,3"] = A.next();
    return g;
  },
  // Dispositivos chicos: sesiones arriba, respuestas sobre la seleccionada abajo.
  mk2: () => ({
    "0,0": A.iterm(), "1,0": A.tab(0), "2,0": A.tab(1), "3,0": A.tab(2), "4,0": A.tab(3),
    "0,1": A.info("sel"), "1,1": A.tab(4), "2,1": A.tab(5), "3,1": A.tab(6), "4,1": A.tab(7),
    "0,2": A.esc("sel"), "1,2": A.answer("sel", 1), "2,2": A.answer("sel", 2), "3,2": A.answer("sel", 3), "4,2": A.enter("sel"),
  }),
  mini: () => ({
    "0,0": A.tab(0), "1,0": A.tab(1), "2,0": A.tab(2),
    "0,1": A.answer("sel", 1), "1,1": A.answer("sel", 2), "2,1": A.answer("sel", 3),
  }),
  neo: () => ({
    "0,0": A.tab(0), "1,0": A.tab(1), "2,0": A.tab(2), "3,0": A.tab(3),
    "0,1": A.answer("sel", 1), "1,1": A.answer("sel", 2), "2,1": A.answer("sel", 3), "3,1": A.esc("sel"),
  }),
  plus: () => ({
    "0,0": A.tab(0), "1,0": A.tab(1), "2,0": A.tab(2), "3,0": A.tab(3),
    "0,1": A.answer("sel", 1), "1,1": A.answer("sel", 2), "2,1": A.answer("sel", 3), "3,1": A.esc("sel"),
  }),
};

// Nombre del perfil (debe coincidir con plugin/src/views.ts y manifest.json → Profiles)
const PROFILES = [
  { key: "standard", name: "Claude iTerm Deck", device: "xl", view: "standard" },
  { key: "focus", name: "Claude iTerm Deck Focus", device: "xl", view: "focus" },
  { key: "dense", name: "Claude iTerm Deck Dense", device: "xl", view: "dense" },
  { key: "mk2", name: "Claude iTerm Deck MK2", device: "mk2" },
  { key: "mini", name: "Claude iTerm Deck Mini", device: "mini" },
  { key: "neo", name: "Claude iTerm Deck Neo", device: "neo" },
  { key: "plus", name: "Claude iTerm Deck Plus", device: "plus" },
];

const outDir = join(HERE, "dist");
mkdirSync(outDir, { recursive: true });

for (const p of PROFILES) {
  const dev = DEVICES[p.device];
  const actions = LAYOUTS[p.key]();
  for (const k of Object.keys(actions)) {
    const [c, r] = k.split(",").map(Number);
    if (c >= dev.cols || r >= dev.rows) throw new Error(`${p.key}: tecla ${k} fuera de ${dev.cols}x${dev.rows}`);
  }
  const profileId = uuidFor(p.name);
  const pageId = uuidFor(p.name + "/page").toLowerCase();
  const defaultPageId = uuidFor(p.name + "/default").toLowerCase();
  const stage = join(outDir, "stage");
  const sdProfile = join(stage, `${profileId}.sdProfile`);
  rmSync(stage, { recursive: true, force: true });
  for (const id of [pageId, defaultPageId]) mkdirSync(join(sdProfile, "Profiles", id.toUpperCase(), "Images"), { recursive: true });
  mkdirSync(join(sdProfile, "Images"), { recursive: true });
  writeFileSync(
    join(sdProfile, "manifest.json"),
    JSON.stringify({
      Device: { Model: dev.model, UUID: "" },
      InstalledByPluginUUID: PLUGIN,
      Name: p.name,
      Pages: { Current: pageId, Default: defaultPageId, Pages: [pageId] },
      PreconfiguredName: p.name,
      Version: "3.0",
    }),
  );
  writeFileSync(join(sdProfile, "Profiles", defaultPageId.toUpperCase(), "manifest.json"), JSON.stringify({ Controllers: [{ Actions: null, Type: "Keypad" }], Icon: "", Name: "" }));
  writeFileSync(join(sdProfile, "Profiles", pageId.toUpperCase(), "manifest.json"), JSON.stringify({ Controllers: [{ Actions: actions, Type: "Keypad" }], Icon: "", Name: "" }));

  const file = join(outDir, `${p.name}.streamDeckProfile`);
  rmSync(file, { force: true });
  execFileSync("zip", ["-r", "-X", "-0", "-q", file, `${profileId}.sdProfile`], { cwd: stage });
  rmSync(stage, { recursive: true, force: true });
  if (OUT_PLUGIN && p.device === "xl") copyFileSync(file, join(OUT_PLUGIN, `${p.name}.streamDeckProfile`));
  console.log(`${p.name.padEnd(20)} ${dev.cols}x${dev.rows}  ${Object.keys(actions).length} teclas`);
}
console.log(`\nPerfiles en ${outDir}${OUT_PLUGIN ? ` (vistas XL copiadas a ${OUT_PLUGIN})` : ""}`);
