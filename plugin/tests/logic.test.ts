import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ago,
  cleanTitle,
  deriveSlots,
  modeBadge,
  orphanHookFiles,
  pickSelected,
  prioritize,
  shortModel,
  ttyName,
  type DeriveInput,
  type HookFile,
  type Slot,
} from "../src/logic.ts";

const NOW = 1_800_000_000_000;
const sec = (msAgo: number) => Math.floor((NOW - msAgo) / 1000);

const session = (id: string, tab: string, tty: string, name = `◐ ${id} (claude)`) => ({
  id, name, title: name, tab_id: tab, window_id: "w1", tty: `\\/dev\\/${tty}`,
});
const hook = (id: string, extra: Partial<HookFile> = {}): HookFile => ({
  iterm_session_id: id, status: "working", ts: sec(1000), ...extra,
});

function input(over: Partial<DeriveInput> = {}): DeriveInput {
  return {
    sessions: [session("A", "1", "ttys001"), session("B", "2", "ttys002"), session("C", "2", "ttys003"), session("D", "3", "ttys004", "zsh")],
    processes: [{ pid: 11, tty: "ttys001" }, { pid: 12, tty: "ttys002" }, { pid: 13, tty: "ttys003" }],
    ccFiles: [{ pid: 11, status: "busy", name: "proyecto-a", cwd: "/x/a" }, { pid: 12, status: "idle", name: "proyecto-b" }],
    hookFiles: [],
    overrides: new Map(),
    now: NOW,
    maxSlots: 7,
    ...over,
  };
}

describe("deriveSlots", () => {
  it("un slot por tab, sólo tabs con proceso claude, en orden de iTerm", () => {
    const slots = deriveSlots(input());
    assert.deepEqual(slots.map((s) => s.sessionId), ["A", "B"]); // C es 2º pane de la tab 2; D no tiene claude
    assert.equal(slots[0].pid, 11);
    assert.equal(slots[0].tabIndex, 0);
  });

  it("sin hook usa el status de Claude Code y su nombre", () => {
    const [a, b] = deriveSlots(input());
    assert.equal(a.status, "working");
    assert.equal(a.project, "proyecto-a");
    assert.equal(b.status, "idle");
  });

  it("sin hook ni archivo de CC usa el título de la tab limpio", () => {
    const slots = deriveSlots(input({ ccFiles: [] }));
    assert.equal(slots[0].project, "A");
    assert.equal(slots[0].status, "working");
  });

  it("el hook manda: waiting con kind/detail/suggestion/modo/agentes", () => {
    const slots = deriveSlots(
      input({ hookFiles: [hook("A", { status: "waiting", kind: "permission", detail: "$ npm test", suggestion: "Bash(npm:*)", permission_mode: "plan", agents: 2 })] }),
    );
    const a = slots[0];
    assert.equal(a.status, "waiting");
    assert.equal(a.kind, "permission");
    assert.equal(a.detail, "$ npm test");
    assert.equal(a.suggestion, "Bash(npm:*)");
    assert.equal(a.permissionMode, "plan");
    assert.equal(a.agents, 2);
  });

  it("un idle de Claude Code más nuevo que el hook gana (Stop perdido)", () => {
    const slots = deriveSlots(
      input({
        hookFiles: [hook("A", { status: "working", ts: sec(60_000) })],
        ccFiles: [{ pid: 11, status: "idle", statusUpdatedAt: NOW - 5000 }],
      }),
    );
    assert.equal(slots[0].status, "idle");
    assert.equal(slots[0].lastEvent, "cc");
  });

  it("un hook más nuevo que el idle de CC se respeta", () => {
    const slots = deriveSlots(
      input({
        hookFiles: [hook("A", { status: "waiting", ts: sec(1000) })],
        ccFiles: [{ pid: 11, status: "idle", statusUpdatedAt: NOW - 60_000 }],
      }),
    );
    assert.equal(slots[0].status, "waiting");
  });

  it("override optimista pisa el hook hasta que llega uno más nuevo", () => {
    const overrides = new Map([["A", { status: "working" as const, since: NOW / 1000 - 5, until: NOW / 1000 + 10 }]]);
    const older = deriveSlots(input({ overrides, hookFiles: [hook("A", { status: "waiting", ts: sec(10_000) })] }));
    assert.equal(older[0].status, "working");
    const newer = deriveSlots(input({ overrides, hookFiles: [hook("A", { status: "waiting", ts: sec(1000) })] }));
    assert.equal(newer[0].status, "waiting");
  });

  it("con más sesiones que teclas oculta primero las idle más viejas", () => {
    const sessions = ["A", "B", "C"].map((id, i) => session(id, String(i), `ttys00${i}`));
    const processes = sessions.map((s, i) => ({ pid: 20 + i, tty: `ttys00${i}` }));
    const hookFiles = [
      hook("A", { status: "idle", ts: sec(600_000) }),
      hook("B", { status: "waiting", ts: sec(1000) }),
      hook("C", { status: "idle", ts: sec(1000) }),
    ];
    const slots = deriveSlots(input({ sessions, processes, ccFiles: [], hookFiles, maxSlots: 2 }));
    assert.deepEqual(slots.map((s) => s.sessionId), ["B", "C"]);
  });
});

describe("helpers", () => {
  it("ttyName", () => {
    assert.equal(ttyName("\\/dev\\/ttys004"), "ttys004");
    assert.equal(ttyName("/dev/ttys004"), "ttys004");
    assert.equal(ttyName("ttys004"), "ttys004");
  });
  it("cleanTitle", () => {
    assert.equal(cleanTitle("◐ mi-proyecto (claude)"), "mi-proyecto");
    assert.equal(cleanTitle("✳ Plan (2.1.272)"), "Plan");
  });
  it("shortModel / modeBadge / ago", () => {
    assert.equal(shortModel("claude-opus-5"), "Opus 5");
    assert.equal(shortModel("claude-sonnet-4-6"), "Sonnet 4.6");
    assert.equal(modeBadge("plan"), "P");
    assert.equal(modeBadge("default"), "");
    assert.equal(ago(sec(30_000), NOW), "");
    assert.equal(ago(sec(12 * 60_000), NOW), "hace 12m");
    assert.equal(ago(sec(3 * 3_600_000), NOW), "hace 3h");
  });
  it("orphanHookFiles: sesiones muertas con más de 30 s", () => {
    const files = [hook("A"), hook("ZZ", { ts: sec(60_000) }), hook("YY", { ts: sec(5000) })];
    const orphans = orphanHookFiles({ ...input(), hookFiles: files });
    assert.deepEqual(orphans.map((f) => f.iterm_session_id), ["ZZ"]);
  });
  it("pickSelected: manual → waiting más antigua → primero", () => {
    const mk = (id: string, status: Slot["status"], ts: number) => ({ sessionId: id, status, ts }) as Slot;
    const slots = [mk("A", "idle", 1), mk("B", "waiting", 5), mk("C", "waiting", 3)];
    assert.equal(pickSelected(slots, "A")?.sessionId, "A");
    assert.equal(pickSelected(slots, "nope")?.sessionId, "C");
    assert.equal(pickSelected([mk("A", "idle", 1)], undefined)?.sessionId, "A");
  });
  it("prioritize conserva el orden original", () => {
    const mk = (id: string, status: Slot["status"], ts: number) => ({ sessionId: id, status, ts }) as Slot;
    const out = prioritize([mk("A", "idle", 1), mk("B", "working", 2), mk("C", "waiting", 3)], 2, NOW);
    assert.deepEqual(out.map((s) => s.sessionId), ["B", "C"]);
  });
});
