import { action, SingletonAction, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import { esc, svg } from "../render";
import { countdown, getUsage, isStale, type Usage, type Window } from "../usage";

const FONT = "font-family='-apple-system, Helvetica Neue, Arial, sans-serif'";
const REFRESH_MS = 30_000;

/** Anillo de uso: % de la ventana + cuenta regresiva al reset. Tap alterna 5 h / 7 d y fuerza refresco. */
export function renderUsage(u: Usage | undefined, which: "5h" | "7d"): string {
  const w: Window | undefined = which === "5h" ? u?.fiveHour : u?.sevenDay;
  const label = which === "5h" ? "5 h" : "7 d";
  if (!u || !w) {
    const msg = u?.error === "no-token" ? "sin token" : u?.error === "auth" ? "token vencido" : u?.error ? u.error : "…";
    return svg(
      `<text x='72' y='70' text-anchor='middle' font-size='30' fill='#555' ${FONT}>--</text>
<text x='72' y='100' text-anchor='middle' font-size='13' fill='#888' ${FONT}>${esc(msg)}</text>
<text x='72' y='132' text-anchor='middle' font-size='14' fill='#888' ${FONT}>uso ${label}</text>`,
      "#202020",
    );
  }
  const p = w.percent;
  const color = p >= 80 ? "#ef4444" : p >= 50 ? "#f59e0b" : "#22c55e";
  const r = 50;
  const c = 2 * Math.PI * r;
  const stale = isStale(u);
  return svg(
    `<circle cx='72' cy='64' r='${r}' fill='none' stroke='#333' stroke-width='10'/>
<circle cx='72' cy='64' r='${r}' fill='none' stroke='${color}' stroke-width='10' stroke-linecap='round' stroke-dasharray='${c}' stroke-dashoffset='${c * (1 - p / 100)}' transform='rotate(-90 72 64)' opacity='${stale ? 0.5 : 1}'/>
<text x='72' y='74' text-anchor='middle' font-size='30' font-weight='700' fill='${stale ? "#aaa" : "#eee"}' ${FONT}>${Math.round(p)}%</text>
<text x='72' y='134' text-anchor='middle' font-size='14' fill='#bbb' ${FONT}>${esc(label)} · ${esc(countdown(w.resetsAt) || "—")}${stale ? " ⚠" : ""}</text>`,
    "#202020",
  );
}

@action({ UUID: "com.pabloalaniz.claude-iterm-deck.usage" })
export class UsageAction extends SingletonAction {
  private which = new Map<string, "5h" | "7d">();
  private timer?: NodeJS.Timeout;
  private lastRed = new Map<string, boolean>();

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (!this.timer) this.timer = setInterval(() => void this.repaintAll(), REFRESH_MS);
    await this.paint(ev.action.id);
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    this.which.delete(ev.action.id);
    if ([...this.actions].length === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    this.which.set(ev.action.id, this.which.get(ev.action.id) === "5h" ? "7d" : "5h");
    await this.paint(ev.action.id, true);
  }

  private async paint(actionId: string, force = false): Promise<void> {
    const a = [...this.actions].find((x) => x.id === actionId);
    if (!a?.isKey()) return;
    const u = await getUsage(force).catch((err) => {
      streamDeck.logger.warn(`usage: ${err}`);
      return undefined;
    });
    const which = this.which.get(actionId) ?? "5h";
    await a.setImage(renderUsage(u, which));
    const red = (u?.fiveHour?.percent ?? 0) >= 80;
    if (red && !this.lastRed.get(actionId)) await a.showAlert();
    this.lastRed.set(actionId, red);
  }

  async repaintAll(): Promise<void> {
    for (const a of this.actions) await this.paint(a.id);
  }
}
