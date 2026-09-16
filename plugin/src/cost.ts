import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

import type { Slot } from "./logic";

/**
 * Costo "equivalente API" por sesión a partir del transcript JSONL (`transcript_path` del hook).
 * Se lee sólo el delta desde el último offset; dedupe por requestId. Es cota inferior (Claude
 * Code sub-reporta input/output; los tokens de caché son exactos) y en Pro/Max no es un cargo real.
 */

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
};

type Tracker = { offset: number; partial: string; seen: Set<string>; usd: number; tokens: number; lastCheck: number; size: number };

const trackers = new Map<string, Tracker>();
const CHECK_MS = 5000;

/** USD por millón de tokens: [input, output]. */
function pricing(model: string): [number, number] {
  const m = model.toLowerCase();
  if (m.includes("haiku")) return [1, 5];
  if (m.includes("sonnet")) return [3, 15];
  if (m.includes("opus")) {
    const v = m.match(/opus-(\d+)(?:-(\d+))?/);
    const major = v ? Number(v[1]) : 5;
    const minor = v?.[2] ? Number(v[2]) : 0;
    return major < 4 || (major === 4 && minor < 5) ? [15, 75] : [5, 25];
  }
  return [5, 25];
}

export function costOfLine(model: string, u: Usage): number {
  const [inP, outP] = pricing(model);
  const write5 = u.cache_creation?.ephemeral_5m_input_tokens ?? u.cache_creation_input_tokens ?? 0;
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  return (
    ((u.input_tokens ?? 0) * inP +
      (u.output_tokens ?? 0) * outP +
      read * inP * 0.1 +
      write5 * inP * 1.25 +
      write1h * inP * 2) /
    1e6
  );
}

function ingest(t: Tracker, chunk: string): void {
  const data = t.partial + chunk;
  const lines = data.split("\n");
  t.partial = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.includes('"assistant"')) continue;
    try {
      const j = JSON.parse(line);
      if (j.type !== "assistant" || !j.message?.usage) continue;
      const id = j.requestId || j.message.id;
      if (id) {
        if (t.seen.has(id)) continue;
        t.seen.add(id);
      }
      const u = j.message.usage as Usage;
      t.tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      t.usd += typeof j.costUSD === "number" ? j.costUSD : costOfLine(j.message.model ?? "", u);
    } catch {
      /* línea corrupta */
    }
  }
}

/** Actualiza (incrementalmente) y devuelve el costo acumulado del transcript. */
export function costUsd(path: string): number | undefined {
  if (!path || !existsSync(path)) return undefined;
  let t = trackers.get(path);
  if (!t) {
    t = { offset: 0, partial: "", seen: new Set(), usd: 0, tokens: 0, lastCheck: 0, size: 0 };
    trackers.set(path, t);
  }
  const now = Date.now();
  if (now - t.lastCheck < CHECK_MS) return t.usd;
  t.lastCheck = now;
  try {
    const size = statSync(path).size;
    if (size < t.offset) {
      // archivo truncado/rotado: empezar de nuevo
      Object.assign(t, { offset: 0, partial: "", seen: new Set(), usd: 0, tokens: 0 });
    }
    if (size === t.offset) return t.usd;
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(size - t.offset);
      readSync(fd, buf, 0, buf.length, t.offset);
      ingest(t, buf.toString("utf8"));
      t.offset = size;
    } finally {
      closeSync(fd);
    }
  } catch {
    /* lectura fallida: se reintenta en el próximo check */
  }
  return t.usd;
}

export function formatUsd(usd: number | undefined): string {
  if (usd === undefined) return "";
  return usd < 10 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(0)}`;
}

export function costOf(slot: Slot): string {
  return formatUsd(costUsd(slot.transcriptPath));
}
