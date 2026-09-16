import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const IT2_CANDIDATES = [
  process.env.IT2_PATH ?? "",
  "/Applications/iTerm.app/Contents/Resources/utilities/it2",
  `${process.env.HOME}/Applications/iTerm.app/Contents/Resources/utilities/it2`,
].filter(Boolean);

export const IT2_PATH = IT2_CANDIDATES.find((p) => existsSync(p)) ?? "it2";

const EXEC_OPTS = { timeout: 3000, maxBuffer: 4 * 1024 * 1024 } as const;

export type ItermSession = {
  id: string;
  name: string;
  title: string;
  tab_id: string;
  window_id: string;
  tty: string;
};

export type ItermTab = {
  id: string;
  index: number;
  window_id: string;
  is_active: boolean;
};

type Auth = { ITERM2_COOKIE: string; ITERM2_KEY: string };
const COOKIE_SCRIPT = 'tell application "iTerm2" to request cookie and key for app named "Claude iTerm Deck"';

let reusable: Auth | undefined;
let reusableAttempt: Promise<void> | undefined;

function parseAuth(out: string): Auth {
  const [cookie, key] = out.split(/\s+/);
  if (!cookie || !key) throw new Error(`Respuesta inesperada al pedir cookie: "${out}"`);
  return { ITERM2_COOKIE: cookie, ITERM2_KEY: key };
}

/**
 * Intenta obtener una cookie reutilizable: iTerm muestra un banner pidiendo
 * aprobación (elegí "always" o una duración larga). Mientras tanto, o si no se
 * aprueba, cada llamada usa una cookie de un solo uso (osascript ~0.3 s).
 */
export function requestReusableAuth(): Promise<void> {
  reusableAttempt ??= (async () => {
    try {
      const { stdout } = await execFileAsync(
        "/usr/bin/osascript",
        ["-e", `with timeout of 300 seconds\n${COOKIE_SCRIPT} reusable true\nend timeout`],
        { timeout: 310_000, maxBuffer: 1024 },
      );
      reusable = parseAuth(stdout.trim());
    } catch {
      reusable = undefined;
    } finally {
      reusableAttempt = undefined;
    }
  })();
  return reusableAttempt;
}

async function singleUseAuth(): Promise<Auth> {
  return parseAuth(await osascript(COOKIE_SCRIPT));
}

/**
 * it2 necesita autenticarse contra el API server de iTerm2 cuando no corre dentro
 * de una shell de iTerm (acá es hijo del Stream Deck). macOS pedirá permiso de
 * Automatización a "Elgato Stream Deck" la primera vez.
 */
async function it2(...args: string[]): Promise<string> {
  const auth = reusable ?? (await singleUseAuth());
  try {
    const { stdout } = await execFileAsync(IT2_PATH, args, { ...EXEC_OPTS, env: { ...process.env, ...auth } });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const msg = (e.stderr || e.message || "").trim();
    if (auth === reusable && /authentication/i.test(msg)) reusable = undefined; // vencida: volver a single-use
    throw new Error(`it2 ${args.slice(0, 2).join(" ")}: ${msg}`);
  }
}

export async function listSessions(): Promise<ItermSession[]> {
  return JSON.parse(await it2("session", "list", "--json"));
}

export async function listTabs(): Promise<ItermTab[]> {
  return JSON.parse(await it2("tab", "list", "--json"));
}

export async function focusSession(id: string): Promise<void> {
  await it2("session", "focus", id);
}

/** Envía texto crudo (sin Enter) a una sesión concreta, o a la activa si no se indica. */
export async function sendText(text: string, sessionId?: string): Promise<void> {
  const args = ["session", "send", text];
  if (sessionId) args.push("--session", sessionId);
  await it2(...args);
}

export async function osascript(script: string): Promise<string> {
  const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", script], EXEC_OPTS);
  return stdout.trim();
}

export async function activateIterm(): Promise<void> {
  await osascript('tell application "iTerm2" to activate');
}

/** Selecciona la tab anterior/siguiente de la ventana actual, con wrap. No requiere Accesibilidad. */
export async function cycleTab(direction: "prev" | "next"): Promise<void> {
  const delta = direction === "next" ? 1 : -1;
  await osascript(`
    tell application "iTerm2"
      tell current window
        set n to count of tabs
        if n < 2 then return
        set cur to 0
        repeat with i from 1 to n
          if tab i is current tab then set cur to i
        end repeat
        set target to ((cur - 1 + ${delta} + n) mod n) + 1
        select tab target
      end tell
    end tell`);
}

/** Shift+Tab (CSI Z) en la sesión activa: cicla el modo de permisos de Claude Code. */
export async function sendShiftTab(): Promise<void> {
  try {
    await sendText("\u001b[Z");
  } catch {
    await osascript(
      'tell application "iTerm2" to tell current session of current window to write text ((character id 27) & "[Z") newline NO',
    );
  }
}
