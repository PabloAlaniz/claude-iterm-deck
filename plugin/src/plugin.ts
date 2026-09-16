import streamDeck from "@elgato/streamdeck";

import { AnswerAction } from "./actions/answer";
import { InfoAction } from "./actions/info";
import { EnterAction, EscAction, ItermAction, ModeAction, NavAction, SetupAction, ViewAction } from "./actions/static";
import { TabAction } from "./actions/tab";
import { UsageAction } from "./actions/usage";
import { requestReusableAuth } from "./iterm";
import { store, type Slot } from "./state";
import { autoSwitch, switchTo, VIEWS, type View } from "./views";

streamDeck.logger.setLevel("info");

const tab = new TabAction();
const answer = new AnswerAction();
const info = new InfoAction();
const view = new ViewAction();

for (const a of [tab, answer, info, view, new ItermAction(), new NavAction(), new ModeAction(), new EscAction(), new EnterAction(), new SetupAction(), new UsageAction()]) {
  streamDeck.actions.registerAction(a);
}

const BLINKS = 3;
const BLINK_MS = 220;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Parpadea la columna de un slot (tecla de sesión + 1/2/3 + info) para llamar la atención. */
async function blink(index: number): Promise<void> {
  for (let i = 0; i < BLINKS; i++) {
    await Promise.all([tab.flashSlot(index, true), answer.flashSlot(index, true), info.flashSlot(index, true)]);
    await sleep(BLINK_MS);
    await Promise.all([tab.flashSlot(index, false), answer.flashSlot(index, false), info.flashSlot(index, false)]);
    await sleep(BLINK_MS);
  }
}

function repaint(): void {
  void tab.repaintAll();
  void answer.repaintAll();
  void info.repaintAll();
  void view.repaintAll();
}

let previous = new Map<string, Slot>();
let firstLoad = true;

store.on("change", (slots: Slot[]) => {
  streamDeck.logger.info(
    `slots(${store.total}): ${slots.map((s) => `${s.project}=${s.status}${s.kind ? `/${s.kind}` : ""}${s.agents ? `×${s.agents}` : ""}`).join(", ") || "(ninguno)"}`,
  );
  repaint();
  void autoSwitch();

  // Parpadeo sólo en transiciones a waiting (no al arrancar el plugin).
  if (!firstLoad) {
    slots.forEach((slot, index) => {
      if (slot.status === "waiting" && previous.get(slot.sessionId)?.status !== "waiting") void blink(index);
    });
  }
  firstLoad = false;
  previous = new Map(slots.map((s) => [s.sessionId, s]));
});

// Cada 30 s: "hace Xm", "listo" que vence, costo.
store.on("tick", repaint);
// El cambio de vista automático necesita que la recomendación sea estable: se reevalúa cada 5 s.
setInterval(() => void autoSwitch(), 5000);

// Deep links para scripts/tests: streamdeck://plugins/message/com.pabloalaniz.claude-iterm-deck/<cmd>
//   switch/<focus|standard|dense>  select/<n>  refresh
streamDeck.system.onDidReceiveDeepLink(async (ev) => {
  const [cmd, arg] = ev.url.path.replace(/^\//, "").split("/");
  streamDeck.logger.info(`deep link: ${cmd} ${arg ?? ""}`);
  try {
    if (cmd === "switch" && VIEWS.includes(arg as View)) {
      const device = [...streamDeck.devices][0];
      if (device) await switchTo(device.id, arg as View, true);
    } else if (cmd === "select") {
      store.select(store.slot(Number(arg))?.sessionId);
    } else if (cmd === "refresh") {
      await store.refresh();
      repaint();
    }
  } catch (err) {
    streamDeck.logger.error(`deep link ${cmd}: ${err}`);
  }
});

streamDeck.connect().then(() => {
  void requestReusableAuth();
  store.start();
});
