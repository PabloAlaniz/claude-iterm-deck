import {
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

/**
 * Base para acciones cuyo dibujo depende del estado global (slots). Cachea los
 * settings de cada instancia visible para poder repintar sin round-trips.
 */
export abstract class SlotAction<T extends JsonObject> extends SingletonAction<T> {
  protected readonly settingsById = new Map<string, T>();

  /** Devuelve la imagen (data URI) para una instancia dada sus settings. */
  protected abstract image(settings: T, flash?: boolean): string;

  /** Índice de slot que muestra una instancia (para saber qué teclas parpadear). */
  protected abstract slotOf(settings: T): number | undefined;

  override async onWillAppear(ev: WillAppearEvent<T>): Promise<void> {
    if (!ev.action.isKey()) return;
    this.settingsById.set(ev.action.id, ev.payload.settings);
    await this.paint(ev.action, ev.payload.settings);
  }

  override onWillDisappear(ev: WillDisappearEvent<T>): void {
    this.settingsById.delete(ev.action.id);
    this.lastImage.delete(ev.action.id);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<T>): Promise<void> {
    if (!ev.action.isKey()) return;
    this.settingsById.set(ev.action.id, ev.payload.settings);
    await this.paint(ev.action, ev.payload.settings);
  }

  /** Repinta todas las instancias visibles (llamado cuando cambian los slots). */
  async repaintAll(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const action of this.actions) {
      if (!action.isKey()) continue;
      const settings = this.settingsById.get(action.id);
      if (settings) jobs.push(this.paint(action, settings));
    }
    await Promise.allSettled(jobs);
  }

  /** Pinta las instancias de un slot en modo "flash" (true) o normal (false). */
  async flashSlot(index: number, on: boolean): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const action of this.actions) {
      if (!action.isKey()) continue;
      const settings = this.settingsById.get(action.id);
      if (settings && this.slotOf(settings) === index) jobs.push(this.paint(action, settings, on));
    }
    await Promise.allSettled(jobs);
  }

  private lastImage = new Map<string, string>();

  /** Olvida la última imagen enviada (p. ej. tras pintar un anillo de long-press por fuera del dedup). */
  protected forgetImage(actionId: string): void {
    this.lastImage.delete(actionId);
  }

  protected async paint(action: KeyAction<T>, settings: T, flash = false): Promise<void> {
    try {
      const img = this.image(settings, flash);
      if (this.lastImage.get(action.id) === img) return;
      this.lastImage.set(action.id, img);
      await action.setImage(img);
      await action.setTitle("");
    } catch (err) {
      streamDeck.logger.warn(`No se pudo pintar ${action.id}: ${err}`);
    }
  }
}

/** Convierte un setting (string o número) en índice de slot 0..n; undefined si no hay o es "sel". */
export function slotIndex(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "" || value === "sel") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** true si el setting apunta al slot "seleccionado" (vistas densas). */
export function isSelectedSlot(value: unknown): boolean {
  return value === "sel";
}
