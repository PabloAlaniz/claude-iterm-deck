import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { IT2_PATH, listSessions, osascript } from "./iterm";

const execFileAsync = promisify(execFile);

/** Eventos que el hook debe tener registrados (mismo listado que hooks/install.sh). */
export const HOOK_EVENTS = [
  "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolBatch", "PostToolUseFailure",
  "PermissionRequest", "PermissionDenied", "Elicitation", "ElicitationResult", "Notification",
  "SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted", "Stop", "StopFailure", "SessionEnd",
];
const HOOK_NAME = "claude-deck-status";

export type Check = { name: string; ok: boolean; hint: string };

function settingsPath(): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(process.env.HOME ?? "", ".claude"), "settings.json");
}

/** Eventos a los que les falta nuestro hook. */
export function missingHookEvents(): string[] {
  const p = settingsPath();
  if (!existsSync(p)) return HOOK_EVENTS;
  let hooks: Record<string, { hooks?: { command?: string }[] }[]>;
  try {
    hooks = JSON.parse(readFileSync(p, "utf8")).hooks ?? {};
  } catch {
    return HOOK_EVENTS;
  }
  return HOOK_EVENTS.filter(
    (ev) => !(hooks[ev] ?? []).some((m) => (m.hooks ?? []).some((h) => (h.command ?? "").endsWith(HOOK_NAME))),
  );
}

export async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  const missing = missingHookEvents();
  checks.push({ name: "hooks", ok: missing.length === 0, hint: missing.length ? `faltan ${missing.length} eventos: hooks/install.sh` : "" });

  checks.push({ name: "jq", ok: existsSync("/opt/homebrew/bin/jq") || existsSync("/usr/local/bin/jq") || existsSync("/usr/bin/jq"), hint: "brew install jq" });

  checks.push({ name: "it2", ok: existsSync(IT2_PATH), hint: "iTerm2 ≥ 3.7 en /Applications" });

  try {
    await osascript('tell application "iTerm2" to get name of current window');
    checks.push({ name: "automation", ok: true, hint: "" });
  } catch (err) {
    const denied = /-1743|not allowed|no autorizado|permitid/i.test(String(err));
    checks.push({ name: "automation", ok: false, hint: denied ? "permitir Stream Deck → iTerm2 en Privacidad › Automatización" : String(err).slice(0, 60) });
  }

  try {
    await listSessions();
    checks.push({ name: "api", ok: true, hint: "" });
  } catch (err) {
    checks.push({ name: "api", ok: false, hint: /auth/i.test(String(err)) ? "habilitar Python API en iTerm2 (Magic)" : String(err).slice(0, 60) });
  }

  try {
    const { stdout } = await execFileAsync("/bin/ps", ["-axo", "comm="], { timeout: 3000 });
    checks.push({ name: "claude", ok: /(^|\/)claude$|\/claude\/versions\//m.test(stdout), hint: "no hay sesiones de Claude Code abiertas" });
  } catch {
    checks.push({ name: "claude", ok: false, hint: "ps falló" });
  }

  return checks;
}

/** Carpeta del plugin (bin/plugin.js → ..). */
export function pluginDir(): string {
  return resolve(dirname(process.argv[1] ?? "."), "..");
}

/** Registra el hook empaquetado con el plugin en ~/.claude/settings.json (idempotente). */
export async function installHooks(): Promise<string> {
  const script = join(pluginDir(), "hooks", "install.sh");
  if (!existsSync(script)) throw new Error(`no existe ${script}`);
  const { stdout } = await execFileAsync("/bin/bash", [script], { timeout: 10_000 });
  return stdout.trim();
}
