import { ago, modeBadge, shortModel, type Kind, type Slot, type Status } from "./logic";

/** Paleta por estado: fondo, texto, punto. */
const COLORS: Record<Status, { bg: string; fg: string; dot: string }> = {
  working: { bg: "#1d3f8f", fg: "#e6efff", dot: "#4d8dff" },
  waiting: { bg: "#b4530a", fg: "#fff4e6", dot: "#ffb347" },
  idle: { bg: "#1f6b3a", fg: "#e8fff0", dot: "#4ade80" },
  error: { bg: "#7f1d1d", fg: "#fee2e2", dot: "#f87171" },
};
const DONE = { bg: "#15803d", fg: "#f0fff4", dot: "#86efac" };
const FLASH = { bg: "#f5f5f5", fg: "#111111", dot: "#b4530a" };
const EMPTY = { bg: "#161616", fg: "#3a3a3a", dot: "#2a2a2a" };
const PANEL = "#202020";
const TEXT = "#e5e5e5";
const FONT = "font-family='-apple-system, Helvetica Neue, Arial, sans-serif'";
/** Un Stop reciente se muestra como "listo" (verde brillante) durante este tiempo. */
const DONE_MS = 10 * 60 * 1000;
const AGO_AFTER_MS = 10 * 60 * 1000;

/** Etiquetas de las teclas 1/2/3 según lo que Claude está preguntando. */
const ANSWER_LABELS: Record<Kind, [string, string, string] | undefined> = {
  permission: ["sí", "siempre", "no"],
  plan: ["auto", "manual", "decir"],
  question: ["op. 1", "op. 2", "op. 3"],
  tool: undefined,
  "": undefined,
};

const KIND_TITLE: Record<Kind, string> = {
  permission: "permiso",
  plan: "plan",
  question: "pregunta",
  tool: "",
  "": "",
};

export type RenderOpts = { flash?: boolean; selected?: boolean; hold?: number; now?: number; cost?: string };

export function svg(body: string, bg: string): string {
  const doc = `<svg xmlns='http://www.w3.org/2000/svg' width='144' height='144' viewBox='0 0 144 144'>
<rect width='144' height='144' rx='18' fill='${bg}'/>${body}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(doc).toString("base64")}`;
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
}

/** Parte un texto en hasta `maxLines` líneas de ~`max` caracteres, cortando por separadores. */
export function wrap(text: string, max: number, maxLines: number): string[] {
  const parts = text.split(/[-_\s/]+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const p of parts) {
    if (!cur) cur = p;
    else if ((cur + " " + p).length <= max) cur += " " + p;
    else {
      lines.push(cur);
      cur = p;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  return lines.slice(0, maxLines).map((l) => (l.length > max ? l.slice(0, max - 1) + "…" : l));
}

function text(x: number, y: number, size: number, fill: string, s: string, o: { weight?: number; opacity?: number; anchor?: string } = {}): string {
  return `<text x='${x}' y='${y}' text-anchor='${o.anchor ?? "middle"}' font-size='${size}' font-weight='${o.weight ?? 400}' fill='${fill}' opacity='${o.opacity ?? 1}' ${FONT}>${esc(s)}</text>`;
}

function lines(ls: string[], y0: number, step: number, size: number, fill: string, weight = 400, opacity = 1): string {
  return ls.map((l, i) => text(72, y0 + i * step, size, fill, l, { weight, opacity })).join("");
}

function palette(slot: Slot, opts: RenderOpts) {
  if (opts.flash) return FLASH;
  const now = opts.now ?? Date.now();
  if (slot.status === "idle" && slot.lastEvent === "Stop" && now - slot.ts * 1000 < DONE_MS) return DONE;
  return COLORS[slot.status];
}

function isDone(slot: Slot, now: number): boolean {
  return slot.status === "idle" && slot.lastEvent === "Stop" && now - slot.ts * 1000 < DONE_MS;
}

/** Esquinas: modo de permisos arriba a la izquierda, agentes arriba a la derecha. */
function badges(slot: Slot, fg: string): string {
  let out = "";
  const mode = modeBadge(slot.permissionMode);
  if (mode) out += text(14, 24, 15, fg, mode, { weight: 700, anchor: "start", opacity: 0.9 });
  if (slot.agents > 0) out += text(130, 24, 15, fg, `×${slot.agents}`, { weight: 700, anchor: "end", opacity: 0.9 });
  return out;
}

/** Anillo de progreso para long-press (0..1). */
function holdRing(p: number): string {
  const r = 62;
  const c = 2 * Math.PI * r;
  return `<circle cx='72' cy='72' r='${r}' fill='none' stroke='#f87171' stroke-width='8' stroke-dasharray='${c}' stroke-dashoffset='${c * (1 - p)}' transform='rotate(-90 72 72)' stroke-linecap='round'/>`;
}

function selectedFrame(on: boolean | undefined): string {
  return on ? `<rect x='4' y='4' width='136' height='136' rx='16' fill='none' stroke='#ffffff' stroke-width='5'/>` : "";
}

/** Tecla de sesión: nombre + estado + qué está pasando. */
export function renderTab(slot: Slot | undefined, index: number, opts: RenderOpts = {}): string {
  if (!slot) {
    return svg(
      `<circle cx='72' cy='72' r='10' fill='${EMPTY.dot}'/>${text(72, 126, 16, EMPTY.fg, String(index + 1))}`,
      EMPTY.bg,
    );
  }
  const now = opts.now ?? Date.now();
  const c = palette(slot, opts);
  const name = wrap(slot.project, 12, slot.status === "waiting" ? 1 : 2);
  let body = `<circle cx='72' cy='24' r='7' fill='${c.dot}'/>` + badges(slot, c.fg);

  if (slot.status === "waiting") {
    body += lines(name, 50, 0, 17, c.fg, 600);
    body += lines([KIND_TITLE[slot.kind] || "esperando"], 78, 0, 20, c.fg, 700);
    body += lines(wrap(slot.detail, 16, 2), 102, 18, 14, c.fg, 400, 0.9);
  } else if (slot.status === "error") {
    body += lines(name, 50, 0, 17, c.fg, 600);
    body += lines(["error"], 78, 0, 20, c.fg, 700);
    body += lines(wrap(slot.error || slot.detail, 16, 2), 102, 18, 14, c.fg, 400, 0.9);
  } else {
    body += lines(name, name.length === 1 ? 78 : 66, 24, 20, c.fg, 600);
    let foot: string;
    if (slot.status === "working") foot = slot.detail ? wrap(slot.detail, 18, 1)[0] : "working";
    else if (isDone(slot, now)) foot = "listo";
    else foot = (now - slot.ts * 1000 > AGO_AFTER_MS && ago(slot.ts, now)) || "idle";
    body += text(72, 128, 13, c.fg, foot, { opacity: 0.8 });
  }
  if (opts.hold) body += holdRing(opts.hold);
  return svg(body + selectedFrame(opts.selected), c.bg);
}

/** Tecla de respuesta (1/2/3); la etiqueta depende del tipo de prompt. */
export function renderAnswer(slot: Slot | undefined, key: string, opts: RenderOpts = {}): string {
  if (!slot) {
    return svg(text(72, 84, 52, EMPTY.fg, key, { weight: 700 }), EMPTY.bg);
  }
  const hot = slot.status === "waiting";
  const c = opts.flash ? FLASH : COLORS[slot.status === "error" ? "idle" : slot.status];
  let label = hot ? (ANSWER_LABELS[slot.kind]?.[Number(key) - 1] ?? "") : "";
  let sub = "";
  if (hot && key === "2" && slot.kind === "permission" && slot.suggestion) sub = wrap(slot.suggestion, 18, 1)[0];
  if (sub) label = "siempre";
  const bg = hot || opts.flash ? c.bg : PANEL;
  const fg = hot || opts.flash ? c.fg : c.dot;
  return svg(
    `<rect x='4' y='4' width='136' height='136' rx='16' fill='none' stroke='${c.dot}' stroke-width='${hot ? 6 : 3}' opacity='${hot ? 1 : 0.5}'/>
${text(72, label ? (sub ? 72 : 82) : 92, sub ? 48 : 56, fg, key, { weight: 700, opacity: hot ? 1 : 0.6 })}
${label ? text(72, sub ? 102 : 120, 18, fg, label, { opacity: 0.9 }) : ""}
${sub ? text(72, 124, 12, fg, sub, { opacity: 0.85 }) : ""}`,
    bg,
  );
}

/** Tecla de información de una sesión (vistas Focus/Dense): modelo, modo, agentes, costo, carpeta. */
export function renderInfo(slot: Slot | undefined, opts: RenderOpts = {}): string {
  if (!slot) return svg(text(72, 84, 16, EMPTY.fg, "—"), EMPTY.bg);
  const c = palette(slot, opts);
  const rows: [string, string][] = [];
  if (slot.model) rows.push(["modelo", shortModel(slot.model)]);
  rows.push(["modo", slot.permissionMode || "default"]);
  if (slot.agents) rows.push(["agentes", String(slot.agents)]);
  if (opts.cost) rows.push(["costo", opts.cost]);
  const folder = slot.cwd.split("/").pop() ?? "";
  if (folder) rows.push(["dir", folder.slice(0, 14)]);
  const body = rows
    .slice(0, 5)
    .map(([k, v], i) => text(10, 30 + i * 24, 13, c.fg, k, { anchor: "start", opacity: 0.7 }) + text(134, 30 + i * 24, 15, c.fg, v, { anchor: "end", weight: 600 }))
    .join("");
  return svg(body + selectedFrame(opts.selected), c.bg);
}

/** Teclas estáticas. */
export function renderStatic(kind: "iterm" | "prev" | "next" | "mode" | "esc" | "enter" | "view", label?: string): string {
  const caption = (t: string) => text(72, 134, 15, TEXT, t);
  switch (kind) {
    case "iterm":
      return svg(
        `<rect x='22' y='30' width='100' height='84' rx='10' fill='#0b0b0b' stroke='#7a7a7a' stroke-width='3'/>
<text x='36' y='82' font-size='34' font-weight='700' fill='#4ade80' ${FONT}>&gt;_</text>${caption("iTerm")}`,
        PANEL,
      );
    case "prev":
      return svg(`<polygon points='90,36 42,72 90,108' fill='${TEXT}'/>${caption("tab ant.")}`, PANEL);
    case "next":
      return svg(`<polygon points='54,36 102,72 54,108' fill='${TEXT}'/>${caption("tab sig.")}`, PANEL);
    case "mode":
      return svg(`${text(72, 84, 40, TEXT, "⇧⇥", { weight: 700 })}${caption("modo")}`, PANEL);
    case "esc":
      return svg(
        `<rect x='24' y='34' width='96' height='72' rx='12' fill='none' stroke='#f87171' stroke-width='4'/>
${text(72, 84, 30, "#f87171", "ESC", { weight: 700 })}${caption(label ?? "interrumpir")}`,
        PANEL,
      );
    case "enter":
      return svg(
        `<path d='M100 40 v34 H50' fill='none' stroke='#4ade80' stroke-width='8' stroke-linecap='round' stroke-linejoin='round'/>
<polygon points='56,58 34,74 56,90' fill='#4ade80'/>${caption(label ?? "enter")}`,
        PANEL,
      );
    case "view":
      return svg(
        `<rect x='26' y='34' width='40' height='30' rx='6' fill='${TEXT}' opacity='0.9'/><rect x='78' y='34' width='40' height='30' rx='6' fill='${TEXT}' opacity='0.5'/>
<rect x='26' y='74' width='40' height='30' rx='6' fill='${TEXT}' opacity='0.5'/><rect x='78' y='74' width='40' height='30' rx='6' fill='${TEXT}' opacity='0.9'/>
${caption(label ?? "vista")}`,
        PANEL,
      );
  }
}

/** Tecla de diagnóstico. */
export function renderSetup(ok: boolean, problems: string[]): string {
  if (ok) return svg(`${text(72, 84, 44, "#4ade80", "✓", { weight: 700 })}${text(72, 128, 14, TEXT, "setup ok")}`, PANEL);
  return svg(
    `${text(72, 40, 30, "#ffb347", "!", { weight: 700 })}${lines(problems.slice(0, 4), 66, 20, 13, "#ffb347")}`,
    "#3b2a0a",
  );
}
