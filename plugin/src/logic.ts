/**
 * Lógica pura (sin I/O) para derivar los slots del deck a partir de las fuentes:
 *  - sesiones de iTerm2 (`it2 session list`), en orden ventana → tab → pane
 *  - procesos `claude` por tty (`ps`)
 *  - `~/.claude/sessions/<pid>.json` que escribe Claude Code (status busy/idle, name)
 *  - archivos del hook claude-deck-status (waiting, kind, detail, modo, agentes…)
 */

export type Status = "working" | "waiting" | "idle" | "error";
export type Kind = "permission" | "plan" | "question" | "tool" | "";

export type Slot = {
  sessionId: string;
  pid: number;
  project: string;
  status: Status;
  kind: Kind;
  detail: string;
  cwd: string;
  tabId: string;
  windowId: string;
  tabIndex: number;
  permissionMode: string;
  model: string;
  agents: number;
  suggestion: string;
  error: string;
  lastEvent: string;
  ts: number;
  transcriptPath: string;
  claudeSessionId: string;
};

export type ItermSession = {
  id: string;
  name: string;
  title: string;
  tab_id: string;
  window_id: string;
  tty: string;
};

export type ClaudeProcess = { pid: number; tty: string };

export type CcSessionFile = {
  pid: number;
  sessionId?: string;
  cwd?: string;
  status?: string;
  name?: string;
  kind?: string;
  updatedAt?: number;
  statusUpdatedAt?: number;
};

export type HookFile = {
  iterm_session_id: string;
  status: Status;
  kind?: Kind;
  detail?: string;
  event?: string;
  cwd?: string;
  project?: string;
  claude_session_id?: string;
  transcript_path?: string;
  permission_mode?: string;
  model?: string;
  suggestion?: string;
  error?: string;
  agents?: number;
  ts: number;
};

export type Override = { status: Status; until: number; since: number };

export type DeriveInput = {
  sessions: ItermSession[];
  processes: ClaudeProcess[];
  ccFiles: CcSessionFile[];
  hookFiles: HookFile[];
  overrides: Map<string, Override>;
  now: number;
  maxSlots: number;
  tabIndex?: Map<string, number>;
};

export const MAX_SLOTS_DEFAULT = 7;

/** basename de un tty: "/dev/ttys004" → "ttys004" */
export function ttyName(tty: string): string {
  return tty.replace(/\\\//g, "/").split("/").pop() ?? tty;
}

/** "◐ mi-proyecto (claude)" → "mi-proyecto"; "✳ Plan (2.1.272)" → "Plan" */
export function cleanTitle(name: string): string {
  return name
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s*\(claude\)\s*$/i, "")
    .replace(/\s*\(\d+\.\d+\.\d+\)\s*$/, "")
    .trim();
}

function ccStatus(s: string | undefined): Status {
  return s === "idle" ? "idle" : "working";
}

/**
 * Deriva los slots. Un slot por tab de iTerm (primer pane con Claude); orden de iTerm.
 * Estado: hook si existe y no está contradicho por un `idle` más reciente de Claude Code;
 * si no, el status de Claude Code; override optimista (tras responder desde el deck) encima.
 */
export function deriveSlots(input: DeriveInput): Slot[] {
  const { sessions, processes, ccFiles, hookFiles, overrides, now, maxSlots } = input;
  const pidByTty = new Map(processes.map((p) => [ttyName(p.tty), p.pid]));
  const ccByPid = new Map(ccFiles.map((f) => [f.pid, f]));
  const hookByUuid = new Map(hookFiles.map((f) => [f.iterm_session_id.toUpperCase(), f]));

  const slots: Slot[] = [];
  const tabsSeen = new Set<string>();
  sessions.forEach((session, i) => {
    const pid = pidByTty.get(ttyName(session.tty));
    if (pid === undefined) return;
    const tabKey = `${session.window_id}/${session.tab_id}`;
    if (tabsSeen.has(tabKey)) return;
    tabsSeen.add(tabKey);

    const cc = ccByPid.get(pid);
    const hook = hookByUuid.get(session.id.toUpperCase());

    let status: Status;
    let lastEvent = hook?.event ?? "";
    let ts = hook?.ts ?? Math.floor((cc?.statusUpdatedAt ?? cc?.updatedAt ?? now) / 1000);
    if (hook) {
      status = hook.status;
      const ccIdleAt = cc?.status === "idle" ? (cc.statusUpdatedAt ?? cc.updatedAt ?? 0) / 1000 : 0;
      // Claude Code dice idle y es más nuevo que el hook (se perdió un Stop): confiar en CC.
      if (ccIdleAt > hook.ts + 2 && (status === "working" || status === "waiting")) {
        status = "idle";
        lastEvent = "cc";
        ts = Math.floor(ccIdleAt);
      }
    } else {
      status = ccStatus(cc?.status);
    }

    const ov = overrides.get(session.id);
    if (ov && ov.until > now / 1000 && (!hook || hook.ts <= ov.since)) status = ov.status;

    slots.push({
      sessionId: session.id,
      pid,
      project: cc?.name || cleanTitle(session.name) || hook?.project || "claude",
      status,
      kind: status === "waiting" ? (hook?.kind ?? "") : status === "working" ? (hook?.kind === "tool" ? "tool" : "") : "",
      detail: status === "idle" ? "" : (hook?.detail ?? ""),
      cwd: hook?.cwd || cc?.cwd || "",
      tabId: session.tab_id,
      windowId: session.window_id,
      tabIndex: input.tabIndex?.get(tabKey) ?? i,
      permissionMode: hook?.permission_mode ?? "",
      model: hook?.model ?? "",
      agents: hook?.agents ?? 0,
      suggestion: status === "waiting" ? (hook?.suggestion ?? "") : "",
      error: hook?.error ?? "",
      lastEvent,
      ts,
      transcriptPath: hook?.transcript_path ?? "",
      claudeSessionId: hook?.claude_session_id || cc?.sessionId || "",
    });
  });

  return prioritize(slots, maxSlots, now);
}

/**
 * Si hay más slots que teclas: mantener el orden de tabs pero ocultar primero las idle más
 * viejas (nunca waiting/error/working).
 */
export function prioritize(slots: Slot[], maxSlots: number, now: number): Slot[] {
  if (slots.length <= maxSlots) return slots;
  const rank = (s: Slot) => (s.status === "waiting" ? 3 : s.status === "error" ? 2 : s.status === "working" ? 1 : 0);
  const keep = new Set(
    [...slots]
      .sort((a, b) => rank(b) - rank(a) || b.ts - a.ts)
      .slice(0, maxSlots)
      .map((s) => s.sessionId),
  );
  void now;
  return slots.filter((s) => keep.has(s.sessionId));
}

/** Archivos del hook cuya sesión de iTerm ya no existe o no tiene Claude corriendo. */
export function orphanHookFiles(input: Pick<DeriveInput, "sessions" | "processes" | "hookFiles" | "now">): HookFile[] {
  const pidByTty = new Map(input.processes.map((p) => [ttyName(p.tty), p.pid]));
  const alive = new Set(
    input.sessions.filter((s) => pidByTty.has(ttyName(s.tty))).map((s) => s.id.toUpperCase()),
  );
  return input.hookFiles.filter(
    (f) => !alive.has(f.iterm_session_id.toUpperCase()) && input.now / 1000 - f.ts > 30,
  );
}

/** Slot "seleccionado" para las vistas densas: el elegido a mano, si no la waiting más antigua, si no el primero. */
export function pickSelected(slots: Slot[], manual: string | undefined): Slot | undefined {
  if (manual) {
    const s = slots.find((x) => x.sessionId === manual);
    if (s) return s;
  }
  const waiting = slots.filter((s) => s.status === "waiting").sort((a, b) => a.ts - b.ts);
  return waiting[0] ?? slots[0];
}

/** "claude-opus-5" → "Opus 5", "claude-sonnet-4-6" → "Sonnet 4.6" */
export function shortModel(model: string): string {
  const m = model.match(/claude-([a-z]+)-(\d+)(?:-(\d+))?/i);
  if (!m) return model.slice(0, 10);
  const name = m[1][0].toUpperCase() + m[1].slice(1);
  return `${name} ${m[2]}${m[3] ? "." + m[3] : ""}`;
}

/** Letra corta para el modo de permisos. */
export function modeBadge(mode: string): string {
  switch (mode) {
    case "plan": return "P";
    case "acceptEdits": return "A";
    case "auto": return "⚡";
    case "bypassPermissions": return "B";
    case "dontAsk": return "D";
    default: return "";
  }
}

/** "hace 12m" / "hace 2h" para idle viejos. */
export function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.floor(now / 1000 - ts));
  if (s < 60) return "";
  if (s < 3600) return `hace ${Math.floor(s / 60)}m`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)}h`;
  return `hace ${Math.floor(s / 86400)}d`;
}
