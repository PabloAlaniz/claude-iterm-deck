import streamDeck from "@elgato/streamdeck";

import { store } from "./state";

/**
 * Vistas: perfiles empaquetados con el plugin, elegidos según cuántas sesiones hay.
 *  - focus:    1–3 sesiones, 2 columnas por sesión (info + Esc/Enter propios)
 *  - standard: 4–7 sesiones, 1 columna por sesión
 *  - dense:    8+ sesiones, 2 filas de sesiones + respuestas sobre la seleccionada
 * Los nombres deben coincidir con `Profiles[].Name` del manifest y con profile/build-profile.mjs.
 */
export type View = "focus" | "standard" | "dense";
export const VIEWS: View[] = ["focus", "standard", "dense"];
export const PROFILE_NAMES: Record<View, string> = {
  focus: "Claude iTerm Deck Focus",
  standard: "Claude iTerm Deck",
  dense: "Claude iTerm Deck Dense",
};
/** Cuántos slots muestra cada vista (XL). */
export const VIEW_SLOTS: Record<View, number> = { focus: 3, standard: 7, dense: 14 };

const MANUAL_MS = 10 * 60 * 1000;
const MIN_SWITCH_GAP_MS = 8000;
/** La recomendación tiene que mantenerse este tiempo antes de cambiar (evita oscilar en 3↔4 o 7↔8). */
const STABLE_MS = 15_000;

const log = streamDeck.logger.createScope("views");

let manualUntil = 0;
let lastSwitch = 0;
let pending: { view: View; since: number } | undefined;
/** Vista visible por dispositivo (la reportan las teclas "vista" al aparecer). */
const current = new Map<string, View>();

export function recommend(total: number): View {
  if (total <= 3) return "focus";
  if (total <= 7) return "standard";
  return "dense";
}

export function isAuto(): boolean {
  return Date.now() > manualUntil;
}

export function setCurrent(deviceId: string, view: View | undefined): void {
  if (view) current.set(deviceId, view);
  else current.delete(deviceId);
  // maxSlots del store = el máximo entre las vistas visibles (normalmente una sola)
  const max = Math.max(7, ...[...current.values()].map((v) => VIEW_SLOTS[v]));
  if (store.maxSlots !== max) {
    store.maxSlots = max;
    void store.refresh();
  }
}

export function currentView(deviceId: string): View | undefined {
  return current.get(deviceId);
}

export async function switchTo(deviceId: string, view: View, manual = false): Promise<void> {
  if (manual) manualUntil = Date.now() + MANUAL_MS;
  if (current.get(deviceId) === view) return;
  lastSwitch = Date.now();
  log.info(`switch ${deviceId} → ${view}${manual ? " (manual)" : ""}`);
  await streamDeck.profiles.switchToProfile(deviceId, PROFILE_NAMES[view]);
}

/** Cambia de vista automáticamente si la cantidad de sesiones lo pide y estamos en una vista nuestra. */
export async function autoSwitch(): Promise<void> {
  if (!isAuto() || Date.now() - lastSwitch < MIN_SWITCH_GAP_MS) return;
  const want = recommend(store.total);
  if (pending?.view !== want) pending = { view: want, since: Date.now() };
  if (Date.now() - pending.since < STABLE_MS) return;
  for (const [deviceId, view] of current) {
    if (view !== want) await switchTo(deviceId, want).catch((err) => log.warn(`switch falló: ${err}`));
  }
}

export function nextView(view: View | undefined): View {
  const i = view ? VIEWS.indexOf(view) : -1;
  return VIEWS[(i + 1) % VIEWS.length];
}
