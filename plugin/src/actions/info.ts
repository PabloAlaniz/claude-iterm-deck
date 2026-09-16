import { action } from "@elgato/streamdeck";

import { costOf } from "../cost";
import { renderInfo } from "../render";
import { isSelectedSlot, SlotAction } from "./slot-action";
import { resolveSlot, resolveSlotIndex } from "./answer";

type InfoSettings = { slot?: number | string };

/** Tecla de información de una sesión: modelo, modo, agentes, costo, carpeta. */
@action({ UUID: "com.pabloalaniz.claude-iterm-deck.info" })
export class InfoAction extends SlotAction<InfoSettings> {
  protected image(settings: InfoSettings, flash = false): string {
    const slot = resolveSlot(settings.slot);
    return renderInfo(slot, { flash, cost: slot ? costOf(slot) : undefined, selected: isSelectedSlot(settings.slot) && !!slot });
  }

  protected slotOf(settings: InfoSettings): number | undefined {
    return resolveSlotIndex(settings.slot);
  }
}
