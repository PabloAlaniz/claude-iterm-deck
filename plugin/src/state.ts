import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import streamDeck from "@elgato/streamdeck";

import { listSessions } from "./iterm";
import {
  deriveSlots,
  orphanHookFiles,
  pickSelected,
  MAX_SLOTS_DEFAULT,
  type CcSessionFile,
  type ClaudeProcess,
  type HookFile,
  type Override,
  type Slot,
  type Status,
} from "./logic";

export type { Slot, Status, Kind } from "./logic";

const execFileAsync = promisify(execFile);
const log = streamDeck.logger.createScope("state");

const HOME = process.env.HOME ?? "";
const STATE_DIR = process.env.CLAUDE_DECK_STATE_DIR ?? join(HOME, ".local/state/claude-deck/sessions");
const CC_SESSIONS_DIR = process.env.CLAUDE_CONFIG_DIR
  ? join(process.env.CLAUDE_CONFIG_DIR, "sessions")
  : join(HOME, ".claude/sessions");
const POLL_MS = 2000;
const TICK_MS = 30_000;
const STALE_CACHE_MS = 10_000;

/**
 * Store de estado: combina las fuentes (ver logic.ts) cada 2 s y al instante cuando cambia
 * un archivo del hook. Emite "change" (lista de slots cambió) y "tick" (cada 30 s, para
 * refrescar "hace Xm"). Mantiene overrides optimistas y la selección manual (vistas densas).
 */
class StateStore extends EventEmitter {
  slots: Slot[] = [];
  maxSlots = MAX_SLOTS_DEFAULT;
  /** Total de sesiones con Claude antes de recortar a maxSlots (para "+N" y elección de vista). */
  total = 0;
  selectedId: string | undefined;

  private lastJson = "";
  private timer?: NodeJS.Timeout;
  private tick?: NodeJS.Timeout;
  private watcher?: FSWatcher;
  private refreshing = false;
  private pendingRefresh = false;
  private overrides = new Map<string, Override>();
  private lastGood?: { at: number; sessions: Awaited<ReturnType<typeof listSessions>>; processes: ClaudeProcess[] };

  start(): void {
    mkdirSync(STATE_DIR, { recursive: true });
    try {
      this.watcher = watch(STATE_DIR, () => void this.refresh());
    } catch (err) {
      log.warn(`No se pudo observar ${STATE_DIR}: ${err}`);
    }
    this.timer = setInterval(() => void this.refresh(), POLL_MS);
    this.tick = setInterval(() => this.emit("tick"), TICK_MS);
    void this.refresh();
  }

  stop(): void {
    clearInterval(this.timer);
    clearInterval(this.tick);
    this.watcher?.close();
  }

  slot(index: number | undefined): Slot | undefined {
    return index === undefined ? undefined : this.slots[index];
  }

  /** Slot seleccionado (vistas densas): manual → waiting más antigua → primero. */
  selected(): Slot | undefined {
    return pickSelected(this.slots, this.selectedId);
  }

  select(sessionId: string | undefined): void {
    if (this.selectedId === sessionId) return;
    this.selectedId = sessionId;
    this.emit("change", this.slots);
  }

  /** Marca un slot con un estado optimista durante `ttlMs` (p. ej. working tras responder). */
  override(sessionId: string, status: Status, ttlMs = 15_000): void {
    const now = Date.now() / 1000;
    this.overrides.set(sessionId, { status, since: now, until: now + ttlMs / 1000 });
    void this.refresh();
  }

  /** Borra el archivo del hook de una sesión (des-atascar un estado). */
  clearHookFile(sessionId: string): void {
    try {
      unlinkSync(join(STATE_DIR, `${sessionId.toUpperCase()}.json`));
    } catch {
      /* no existía */
    }
    this.overrides.delete(sessionId);
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.refreshing) {
      this.pendingRefresh = true;
      return;
    }
    this.refreshing = true;
    try {
      const slots = await this.compute();
      const json = JSON.stringify([slots, this.selectedId, this.total]);
      if (json !== this.lastJson) {
        this.lastJson = json;
        this.slots = slots;
        this.emit("change", slots);
      }
    } catch (err) {
      log.error(`Error actualizando estado: ${err}`);
    } finally {
      this.refreshing = false;
      if (this.pendingRefresh) {
        this.pendingRefresh = false;
        void this.refresh();
      }
    }
  }

  private async compute(): Promise<Slot[]> {
    const now = Date.now();
    let sessions: Awaited<ReturnType<typeof listSessions>>;
    let processes: ClaudeProcess[];
    try {
      [sessions, processes] = await Promise.all([listSessions(), claudeProcesses()]);
      this.lastGood = { at: now, sessions, processes };
    } catch (err) {
      // it2/ps fallaron (cookie vencida, timeout): usar el último resultado bueno unos segundos.
      if (this.lastGood && now - this.lastGood.at < STALE_CACHE_MS) {
        ({ sessions, processes } = this.lastGood);
        log.warn(`Usando caché tras error: ${err}`);
      } else throw err;
    }
    const hookFiles = readJsonDir<HookFile>(STATE_DIR, (f) => !!f.iterm_session_id && !!f.status);
    const ccFiles = readJsonDir<CcSessionFile>(CC_SESSIONS_DIR, (f) => typeof f.pid === "number");

    for (const [id, ov] of this.overrides) if (ov.until < now / 1000) this.overrides.delete(id);

    const base = { sessions, processes, ccFiles, hookFiles, overrides: this.overrides, now };
    this.total = deriveSlots({ ...base, maxSlots: Number.MAX_SAFE_INTEGER }).length;
    const slots = deriveSlots({ ...base, maxSlots: this.maxSlots });

    for (const f of orphanHookFiles({ sessions, processes, hookFiles, now })) {
      try {
        unlinkSync(join(STATE_DIR, `${f.iterm_session_id}.json`));
      } catch {
        /* ignorar */
      }
    }
    return slots;
  }
}

function readJsonDir<T>(dir: string, valid: (f: T) => boolean): T[] {
  if (!existsSync(dir)) return [];
  const out: T[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const data = JSON.parse(readFileSync(join(dir, name), "utf8")) as T;
      if (valid(data)) out.push(data);
    } catch {
      // archivo a medio escribir o corrupto: se ignora hasta el próximo ciclo
    }
  }
  return out;
}

/** Procesos de Claude Code interactivos: pid + tty. */
async function claudeProcesses(): Promise<ClaudeProcess[]> {
  const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,tty=,comm="], { timeout: 3000 });
  const out: ClaudeProcess[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(ttys\d+)\s+(.+?)\s*$/);
    if (!m) continue;
    const comm = m[3];
    if (comm.split("/").pop() === "claude" || /\/claude\/versions\//.test(comm)) out.push({ pid: Number(m[1]), tty: m[2] });
  }
  return out;
}

export const store = new StateStore();
