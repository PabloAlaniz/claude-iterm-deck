import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import streamDeck from "@elgato/streamdeck";

const execFileAsync = promisify(execFile);
const log = streamDeck.logger.createScope("usage");

/**
 * Límites de uso de la suscripción (ventana de 5 h y semanal), del mismo endpoint que usa
 * `/usage` en Claude Code. Endpoint y cabecera beta no están documentados: si cambian, la
 * tecla muestra "--" y nada más se rompe.
 *
 * Token: se lee el OAuth token que guarda Claude Code (keychain en macOS, o
 * ~/.claude/.credentials.json). Sólo lectura: nunca se refresca ni se escribe; la CLI lo rota.
 */
const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const UA = "claude-code/2.1.273";
const POLL_MS = 60_000;
const STALE_MS = 3 * 60_000;
const TOKEN_TTL_MS = 30 * 60_000;
const KEYCHAIN_SERVICE = "Claude Code-credentials";

export type Window = { percent: number; resetsAt: number | undefined };
export type Usage = {
  fiveHour?: Window;
  sevenDay?: Window;
  fetchedAt: number;
  error?: "no-token" | "auth" | "rate-limited" | "offline" | "shape";
};

let cache: Usage | undefined;
let token: { value: string; at: number } | undefined;
let inflight: Promise<Usage> | undefined;

function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(process.env.HOME ?? "", ".claude");
}

async function readToken(): Promise<string | undefined> {
  if (token && Date.now() - token.at < TOKEN_TTL_MS) return token.value;
  let raw: string | undefined;
  const file = join(configDir(), ".credentials.json");
  if (existsSync(file)) {
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      /* seguir con keychain */
    }
  }
  if (!raw && process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync(
        "/usr/bin/security",
        ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", userInfo().username, "-w"],
        { timeout: 8000 },
      );
      raw = stdout.trim();
    } catch (err) {
      log.warn(`keychain: ${String(err).slice(0, 120)}`);
    }
  }
  if (!raw) return undefined;
  try {
    const j = JSON.parse(raw);
    const t = j?.claudeAiOauth?.accessToken as string | undefined;
    if (t) token = { value: t, at: Date.now() };
    return t;
  } catch {
    return undefined;
  }
}

function window(x: { utilization?: number; percent?: number; resets_at?: string } | undefined): Window | undefined {
  if (!x) return undefined;
  const p = x.utilization ?? x.percent;
  if (typeof p !== "number") return undefined;
  const percent = p <= 1 && (x.utilization !== undefined) ? p * 100 : p;
  const resetsAt = x.resets_at ? Date.parse(x.resets_at) : undefined;
  return { percent: Math.max(0, Math.min(100, percent)), resetsAt: Number.isFinite(resetsAt) ? resetsAt : undefined };
}

function parse(j: Record<string, unknown>): Pick<Usage, "fiveHour" | "sevenDay"> {
  const limits = (j.limits as { kind?: string; percent?: number; resets_at?: string }[] | undefined) ?? [];
  const byKind = (k: string) => limits.find((l) => l.kind === k);
  return {
    fiveHour: window(byKind("session")) ?? window(j.five_hour as never),
    sevenDay: window(byKind("weekly_all")) ?? window(j.seven_day as never),
  };
}

async function fetchUsage(): Promise<Usage> {
  const t = await readToken();
  if (!t) return { fetchedAt: Date.now(), error: "no-token" };
  try {
    const res = await fetch(ENDPOINT, {
      headers: { Authorization: `Bearer ${t}`, "anthropic-beta": "oauth-2025-04-20", "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) {
      token = undefined;
      return { ...cache, fetchedAt: Date.now(), error: "auth" };
    }
    if (res.status === 429) return { ...cache, fetchedAt: Date.now(), error: "rate-limited" };
    if (!res.ok) return { ...cache, fetchedAt: Date.now(), error: "shape" };
    const j = (await res.json()) as Record<string, unknown>;
    const parsed = parse(j);
    if (!parsed.fiveHour && !parsed.sevenDay) return { ...cache, fetchedAt: Date.now(), error: "shape" };
    return { ...parsed, fetchedAt: Date.now() };
  } catch (err) {
    log.warn(`fetch: ${String(err).slice(0, 120)}`);
    return { ...cache, fetchedAt: Date.now(), error: "offline" };
  }
}

/** Devuelve el uso (con caché de 60 s); `force` ignora la caché. */
export async function getUsage(force = false): Promise<Usage> {
  if (!force && cache && Date.now() - cache.fetchedAt < POLL_MS) return cache;
  inflight ??= fetchUsage().then((u) => {
    cache = u;
    inflight = undefined;
    return u;
  });
  return inflight;
}

export function isStale(u: Usage): boolean {
  return !!u.error || Date.now() - u.fetchedAt > STALE_MS;
}

export function countdown(resetsAt: number | undefined): string {
  if (!resetsAt) return "";
  const s = Math.max(0, Math.floor((resetsAt - Date.now()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
}
