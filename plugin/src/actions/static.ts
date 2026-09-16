import {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import { activateIterm, cycleTab, sendShiftTab, sendText } from "../iterm";
import { renderSetup, renderStatic } from "../render";
import { installHooks, missingHookEvents, runChecks } from "../setup";
import { store } from "../state";
import { currentView, isAuto, nextView, setCurrent, switchTo, type View } from "../views";
import { resolveSlot } from "./answer";

const ESC = "\u001b";
const CR = "\r";

type NavSettings = { direction?: "prev" | "next" };
type SlotSettings = { slot?: number | string };
type ViewSettings = { view?: View };

async function run(ev: KeyDownEvent, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    streamDeck.logger.error(`${ev.action.manifestId}: ${err}`);
    await ev.action.showAlert();
  }
}

/** Envía texto a la sesión del slot indicado, o a la sesión activa de iTerm si no hay slot. */
async function sendToSlotOrActive(settings: SlotSettings, text: string): Promise<void> {
  if (settings.slot === undefined || settings.slot === "") return sendText(text);
  const slot = resolveSlot(settings.slot);
  if (!slot) throw new Error("slot vacío");
  await sendText(text, slot.sessionId);
}

/** Trae iTerm2 al frente. */
@action({ UUID: "com.pabloalaniz.claude-iterm-deck.iterm" })
export class ItermAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (ev.action.isKey()) await ev.action.setImage(renderStatic("iterm"));
  }
  override onKeyDown(ev: KeyDownEvent): Promise<void> {
    return run(ev, activateIterm);
  }
}

/** Tab anterior / siguiente en la ventana actual de iTerm2. */
@action({ UUID: "com.pabloalaniz.claude-iterm-deck.nav" })
export class NavAction extends SingletonAction<NavSettings> {
  override async onWillAppear(ev: WillAppearEvent<NavSettings>): Promise<void> {
    await this.paint(ev);
  }
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<NavSettings>): Promise<void> {
    await this.paint(ev);
  }
  private async paint(ev: WillAppearEvent<NavSettings> | DidReceiveSettingsEvent<NavSettings>): Promise<void> {
    if (ev.action.isKey()) await ev.action.setImage(renderStatic(ev.payload.settings.direction === "next" ? "next" : "prev"));
  }
  override onKeyDown(ev: KeyDownEvent<NavSettings>): Promise<void> {
    return run(ev, () => cycleTab(ev.payload.settings.direction === "next" ? "next" : "prev"));
  }
}

/** Shift+Tab en la sesión activa: cicla el modo de permisos de Claude Code. */
@action({ UUID: "com.pabloalaniz.claude-iterm-deck.mode" })
export class ModeAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (ev.action.isKey()) await ev.action.setImage(renderStatic("mode"));
  }
  override onKeyDown(ev: KeyDownEvent): Promise<void> {
    return run(ev, sendShiftTab);
  }
}

/** Escape: interrumpe a Claude (sesión del slot, o la activa). */
@action({ UUID: "com.pabloalaniz.claude-iterm-deck.esc" })
export class EscAction extends SingletonAction<SlotSettings> {
  override async onWillAppear(ev: WillAppearEvent<SlotSettings>): Promise<void> {
    if (ev.action.isKey()) await ev.action.setImage(renderStatic("esc", ev.payload.settings.slot !== undefined && ev.payload.settings.slot !== "" ? "esc" : undefined));
  }
  override onKeyDown(ev: KeyDownEvent<SlotSettings>): Promise<void> {
    return run(ev, () => sendToSlotOrActive(ev.payload.settings, ESC));
  }
}

/** Enter: confirma (sesión del slot, o la activa). */
@action({ UUID: "com.pabloalaniz.claude-iterm-deck.enter" })
export class EnterAction extends SingletonAction<SlotSettings> {
  override async onWillAppear(ev: WillAppearEvent<SlotSettings>): Promise<void> {
    if (ev.action.isKey()) await ev.action.setImage(renderStatic("enter"));
  }
  override onKeyDown(ev: KeyDownEvent<SlotSettings>): Promise<void> {
    return run(ev, () => sendToSlotOrActive(ev.payload.settings, CR));
  }
}

/**
 * Tecla "vista": identifica la vista actual (setting `view`) y al pulsarla cicla
 * focus → standard → dense (y desactiva el cambio automático 10 min).
 */
@action({ UUID: "com.pabloalaniz.claude-iterm-deck.view" })
export class ViewAction extends SingletonAction<ViewSettings> {
  override async onWillAppear(ev: WillAppearEvent<ViewSettings>): Promise<void> {
    setCurrent(ev.action.device.id, ev.payload.settings.view);
    await this.paint(ev);
  }
  override onWillDisappear(ev: WillDisappearEvent<ViewSettings>): void {
    setCurrent(ev.action.device.id, undefined);
  }
  async paint(ev: { action: WillAppearEvent<ViewSettings>["action"]; payload: { settings: ViewSettings } }): Promise<void> {
    if (!ev.action.isKey()) return;
    const v = ev.payload.settings.view ?? "standard";
    const extra = store.total > store.maxSlots ? ` +${store.total - store.maxSlots}` : "";
    await ev.action.setImage(renderStatic("view", `${v}${extra} ${isAuto() ? "·auto" : ""}`));
  }
  async repaintAll(): Promise<void> {
    for (const a of this.actions) {
      if (!a.isKey()) continue;
      const settings = await a.getSettings();
      await this.paint({ action: a, payload: { settings } });
    }
  }
  override onKeyDown(ev: KeyDownEvent<ViewSettings>): Promise<void> {
    return run(ev, () => switchTo(ev.action.device.id, nextView(currentView(ev.action.device.id) ?? ev.payload.settings.view), true));
  }
}

/** Tecla de diagnóstico: hooks, jq, it2, Automatización, API de iTerm, procesos claude. */
@action({ UUID: "com.pabloalaniz.claude-iterm-deck.setup" })
export class SetupAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    await this.check(ev);
  }
  /** Tap: si faltan hooks los instala (hook empaquetado con el plugin) y vuelve a comprobar. */
  override onKeyDown(ev: KeyDownEvent): Promise<void> {
    return run(ev, async () => {
      if (missingHookEvents().length) streamDeck.logger.info(`setup: ${await installHooks()}`);
      await this.check(ev);
    });
  }
  private async check(ev: WillAppearEvent | KeyDownEvent): Promise<void> {
    if (!ev.action.isKey()) return;
    const checks = await runChecks();
    const bad = checks.filter((c) => !c.ok);
    for (const c of bad) streamDeck.logger.warn(`setup: ${c.name} — ${c.hint}`);
    await ev.action.setImage(renderSetup(bad.length === 0, bad.map((c) => c.name)));
  }
}
