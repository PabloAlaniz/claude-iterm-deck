import { action, type KeyDownEvent, type KeyUpEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import { activateIterm, focusSession, sendText } from "../iterm";
import { renderTab } from "../render";
import { store } from "../state";
import { SlotAction, slotIndex } from "./slot-action";

type TabSettings = { slot?: number | string };

const HOLD_CLEAR_MS = 500;
const HOLD_ESC_MS = 3000;
const HOLD_TICK_MS = 100;
const ESC = "\u001b";

/**
 * Tecla de sesión. Tap = enfocar ese pane en iTerm (y seleccionarlo para las vistas densas).
 * Mantener 0.5 s = limpiar el estado del hook (des-atascar). Mantener 3 s = Esc a esa sesión.
 */
@action({ UUID: "com.pabloalaniz.claude-iterm-deck.tab" })
export class TabAction extends SlotAction<TabSettings> {
  private holds = new Map<string, { since: number; timer: NodeJS.Timeout }>();

  protected image(settings: TabSettings, flash = false): string {
    const index = slotIndex(settings.slot) ?? 0;
    const slot = store.slot(index);
    const selected = !!slot && store.selectedId !== undefined && store.selected()?.sessionId === slot.sessionId;
    return renderTab(slot, index, { flash, selected });
  }

  protected slotOf(settings: TabSettings): number | undefined {
    return slotIndex(settings.slot);
  }

  override async onKeyDown(ev: KeyDownEvent<TabSettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    const index = slotIndex(ev.payload.settings.slot) ?? 0;
    if (!store.slot(index)) {
      await ev.action.showAlert();
      return;
    }
    const since = Date.now();
    const key = ev.action;
    const timer = setInterval(() => {
      const held = Date.now() - since;
      if (held < HOLD_CLEAR_MS) return;
      const p = Math.min(1, (held - HOLD_CLEAR_MS) / (HOLD_ESC_MS - HOLD_CLEAR_MS));
      void key.setImage(renderTab(store.slot(index), index, { hold: p }));
    }, HOLD_TICK_MS);
    this.holds.set(ev.action.id, { since, timer });
  }

  override async onKeyUp(ev: KeyUpEvent<TabSettings>): Promise<void> {
    const hold = this.holds.get(ev.action.id);
    if (!hold) return;
    clearInterval(hold.timer);
    this.holds.delete(ev.action.id);
    const held = Date.now() - hold.since;
    const index = slotIndex(ev.payload.settings.slot) ?? 0;
    const slot = store.slot(index);
    if (!slot) return;
    try {
      if (held >= HOLD_ESC_MS) {
        await sendText(ESC, slot.sessionId);
        store.override(slot.sessionId, "idle", 5000);
      } else if (held >= HOLD_CLEAR_MS) {
        store.clearHookFile(slot.sessionId);
      } else {
        store.select(slot.sessionId);
        await focusSession(slot.sessionId);
        await activateIterm();
      }
    } catch (err) {
      streamDeck.logger.error(`tab ${slot.sessionId}: ${err}`);
      await ev.action.showAlert();
    }
    this.forgetImage(ev.action.id);
    await this.repaintAll();
  }

  override onWillDisappear(ev: WillDisappearEvent<TabSettings>): void {
    const hold = this.holds.get(ev.action.id);
    if (hold) clearInterval(hold.timer);
    this.holds.delete(ev.action.id);
    super.onWillDisappear(ev);
  }
}
