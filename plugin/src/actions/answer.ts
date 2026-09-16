import { action, type KeyDownEvent } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import { sendText } from "../iterm";
import { renderAnswer } from "../render";
import { store, type Slot } from "../state";
import { isSelectedSlot, SlotAction, slotIndex } from "./slot-action";

type AnswerSettings = { slot?: number | string; key?: string };

/** Resuelve el slot de una tecla: índice fijo o el seleccionado ("sel"). */
export function resolveSlot(value: unknown): Slot | undefined {
  return isSelectedSlot(value) ? store.selected() : store.slot(slotIndex(value) ?? 0);
}

/** Índice del slot al que apunta un setting (para flash/repaint por columna). */
export function resolveSlotIndex(value: unknown): number | undefined {
  if (isSelectedSlot(value)) {
    const sel = store.selected();
    return sel ? store.slots.indexOf(sel) : undefined;
  }
  return slotIndex(value);
}

/** Envía "1", "2" o "3" a la sesión del slot, sin cambiar de tab. */
@action({ UUID: "com.pabloalaniz.claude-iterm-deck.answer" })
export class AnswerAction extends SlotAction<AnswerSettings> {
  protected image(settings: AnswerSettings, flash = false): string {
    return renderAnswer(resolveSlot(settings.slot), settings.key ?? "1", { flash });
  }

  protected slotOf(settings: AnswerSettings): number | undefined {
    return resolveSlotIndex(settings.slot);
  }

  override async onKeyDown(ev: KeyDownEvent<AnswerSettings>): Promise<void> {
    const { settings } = ev.payload;
    const slot = resolveSlot(settings.slot);
    const key = settings.key ?? "1";
    if (!slot) {
      await ev.action.showAlert();
      return;
    }
    try {
      await sendText(key, slot.sessionId);
      // Reset optimista: la columna deja de estar naranja sin esperar el próximo hook.
      if (slot.status === "waiting") store.override(slot.sessionId, "working");
      await ev.action.showOk();
    } catch (err) {
      streamDeck.logger.error(`send "${key}" a ${slot.sessionId}: ${err}`);
      await ev.action.showAlert();
    }
  }
}
