/**
 * The temple HUD (spec 07 § HUD and § Screens), plain DOM: the hall chip, the action dock
 * (Namaste · Bow · Darshan; Japa arrives in M3), the context button, one notice at a time
 * (connection problem first), the settings, hall list and "Who's here" sheets, name labels,
 * the Lite suggestion and the rest overlay.
 * Every visible string comes from the locale files (spec 07 § Acceptance criteria).
 */
import "./hud.css";
import {
  GESTURE_COOLDOWN_MS,
  nameLabel,
  type HallId,
  type RoomsResponse,
  type TodayCounters,
  type Visitor,
} from "@sannidhi/protocol";
import { currentLang, onLangChange, setLang, syncLangUi } from "../i18n/lang";
import { applyStrings, t, type StringKey } from "../i18n/t";
import type { NetStatus } from "../net/connection";
import type { SettingsStore } from "../platform/settings";
import { TIERS } from "../platform/tier";

export type ContextAction = "sit" | "stand" | "bell";
export type RestKind = "other-tab" | "idle";
export type Gesture = "namaste" | "pranam";

export interface HudCallbacks {
  context(): void;
  darshan(): void;
  gesture(g: Gesture): void;
  /** A sheet opened or closed (input pauses while one is open). */
  sheet(open: boolean): void;
  /** The hall list opened: refresh the counts. */
  hallsOpened(): void;
  chooseHall(hall: HallId): void;
  resume(): void;
  liteAccept(): void;
  liteDismiss(): void;
}

/** What the "Who's here" sheet shows. */
export interface WhoView {
  me: Visitor | null;
  others: readonly Visitor[];
  today: TodayCounters | null;
}

/** Remote activity is summarised at most this often (spec 07 § Accessibility). */
export const SUMMARY_MS = 10_000;

// Original line icons (spec 11 § UI icon set). Deities are never used as icons.
const EYE =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12c2.6-4.3 5.8-6.5 9.5-6.5s6.9 2.2 9.5 6.5c-2.6 4.3-5.8 6.5-9.5 6.5S5.1 16.3 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const SLIDERS =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';
/** Two palms joined, as a simple outline. */
const PALMS =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4c-1.6 1.4-2.6 4.2-2.6 7.4V18l-2.6 2.4"/><path d="M12 4c1.6 1.4 2.6 4.2 2.6 7.4V18l2.6 2.4"/><path d="M12 4v14"/></svg>';
/** A figure bowing, with joined hands raised before the forehead. */
const BOW =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="7" r="2.1"/><path d="M7 21c0-5.5 1.8-9.4 5.2-11.4"/><path d="M12.4 10.3 15.6 9 17.4 5.6"/></svg>';
/** People, for "Who's here". */
const PEOPLE =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.8-3.4 3-5 5.5-5s4.7 1.6 5.5 5"/><circle cx="16.5" cy="9" r="2.3"/><path d="M15.5 14.2c2.4-.3 4.3 1.2 5 4.3"/></svg>';

const QUALITY_KEYS: Record<(typeof TIERS)[number] | "auto", StringKey> = {
  auto: "settings.quality_auto",
  low: "settings.quality_low",
  mid: "settings.quality_mid",
  high: "settings.quality_high",
};

/** Connection notices, in the order they matter (spec 07 § HUD: connection problems first). */
const CONN_NOTICE: Partial<Record<NetStatus, { text: StringKey; button?: StringKey }>> = {
  reconnecting: { text: "conn.reconnecting" },
  waiting: { text: "conn.waiting" },
  refresh: { text: "conn.refresh", button: "conn.refresh_now" },
  "hall-full": { text: "hall.full", button: "halls.choose" },
  error: { text: "conn.offline" },
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  html = "",
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}

function iconButton(icon: string, label: StringKey, cls = "hud-btn"): HTMLButtonElement {
  const b = el("button", { type: "button", class: cls }, icon);
  b.append(el("span", { "data-t": label }));
  return b;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly contextBtn: HTMLButtonElement;
  private readonly darshanBtn: HTMLButtonElement;
  private readonly gestureBtns: Record<Gesture, HTMLButtonElement>;
  private readonly hallChip: HTMLElement;
  private readonly hallBtn: HTMLButtonElement;
  private readonly hereBtn: HTMLButtonElement;
  private readonly notice: HTMLElement;
  private readonly live: HTMLElement;
  private readonly nameTag: HTMLElement;
  private readonly sheetEl: HTMLDialogElement;
  private readonly hallsEl: HTMLDialogElement;
  private readonly whoEl: HTMLDialogElement;
  private readonly rest: HTMLElement;
  private context: ContextAction | null = null;
  private restKind: RestKind | null = null;
  private conn: NetStatus = "connecting";
  private liteShown = false;
  private hall: { id: HallId; number: number } | null = null;
  private here = 0;
  private rooms: RoomsResponse | null = null;
  private who: WhoView = { me: null, others: [], today: null };
  /** One cooldown for every gesture, as the server has one limit for the `gesture` message. */
  private cooldownUntil = 0;
  private readonly remote = { namaste: 0, pranam: 0, bell: 0 };
  private summaryTimer: number | null = null;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    host: HTMLElement,
    private readonly settings: SettingsStore,
    private readonly cb: HudCallbacks,
  ) {
    this.root = el("div", { class: "hud" });

    // Top bar: the hall chip on the left, settings on the right.
    this.hallChip = el("div", { class: "hud-hall", hidden: "" });
    this.hallBtn = el("button", { type: "button", class: "hud-btn", "aria-haspopup": "dialog" });
    this.hallBtn.addEventListener("click", () => this.openHalls());
    this.hereBtn = el(
      "button",
      { type: "button", class: "hud-btn", "aria-haspopup": "dialog" },
      PEOPLE,
    );
    this.hereBtn.append(el("span"));
    this.hereBtn.addEventListener("click", () => this.openWho());
    this.hallChip.append(this.hallBtn, this.hereBtn);

    const top = el("div", { class: "hud-top" });
    const settingsBtn = el(
      "button",
      {
        type: "button",
        class: "hud-btn hud-icon",
        "data-t-label": "settings.title",
        "aria-haspopup": "dialog",
      },
      SLIDERS,
    );
    settingsBtn.addEventListener("click", () => this.open(this.sheetEl, () => this.syncSheet()));
    top.append(settingsBtn);

    this.notice = el("div", { class: "hud-notice", hidden: "" });

    const bottom = el("div", { class: "hud-bottom" });
    this.contextBtn = el("button", { type: "button", class: "hud-btn hud-context", hidden: "" });
    this.contextBtn.addEventListener("click", () => cb.context());
    const dock = el("div", { class: "hud-dock", role: "toolbar", "data-t-label": "hud.dock" });
    const namaste = iconButton(PALMS, "action.namaste", "hud-btn hud-gesture");
    namaste.dataset.tLabel = "action.namaste_label";
    const pranam = iconButton(BOW, "action.pranam", "hud-btn hud-gesture");
    this.gestureBtns = { namaste, pranam };
    for (const g of ["namaste", "pranam"] as const) {
      this.gestureBtns[g].addEventListener("click", () => this.tryGesture(g));
    }
    this.darshanBtn = iconButton(EYE, "action.darshan");
    this.darshanBtn.setAttribute("aria-pressed", "false");
    this.darshanBtn.addEventListener("click", () => cb.darshan());
    dock.append(namaste, pranam, this.darshanBtn);
    bottom.append(this.contextBtn, dock);

    this.live = el("div", { class: "sr-only", "aria-live": "polite" });
    this.nameTag = el("div", { class: "name-tag", hidden: "", "aria-hidden": "true" });
    this.root.append(this.hallChip, top, this.notice, bottom, this.live, this.nameTag);

    this.sheetEl = this.buildSheet();
    this.hallsEl = this.buildDialog("halls");
    this.whoEl = this.buildDialog("who");
    this.rest = el("div", { class: "rest", role: "dialog", "aria-modal": "true", hidden: "" });
    this.rest.addEventListener("click", () => {
      if (this.restKind === "idle") cb.resume();
    });

    host.append(this.root, this.sheetEl, this.hallsEl, this.whoEl, this.rest);
    this.unsubscribe.push(onLangChange(() => this.refresh()));
    this.refresh();
  }

  get sheetOpen(): boolean {
    return this.sheetEl.open || this.hallsEl.open || this.whoEl.open;
  }

  setContext(action: ContextAction | null): void {
    if (action === this.context) return;
    this.context = action;
    this.contextBtn.hidden = action === null;
    this.refreshContext();
  }

  setDarshan(on: boolean): void {
    this.darshanBtn.setAttribute("aria-pressed", String(on));
  }

  /** The Bow button shows only where bowing is offered (spec 03 § Pranam). */
  setPranamAvailable(on: boolean): void {
    if (this.gestureBtns.pranam.hidden === !on) return;
    this.gestureBtns.pranam.hidden = !on;
  }

  /** Keys 3 and 1 come here too, so the cooldown is shared with the buttons. */
  tryGesture(g: Gesture): void {
    const now = performance.now();
    if (now < this.cooldownUntil) return;
    this.cooldownUntil = now + GESTURE_COOLDOWN_MS + 100;
    // The ring shows the 1.5 s cooldown on both gesture buttons (spec 03 § Namaste).
    for (const b of Object.values(this.gestureBtns)) {
      b.classList.remove("cooling");
      void b.offsetWidth;
      b.classList.add("cooling");
    }
    this.cb.gesture(g);
  }

  // --- Hall chip, hall list and Who's here -----------------------------------------------------

  setHall(hall: { id: HallId; number: number } | null, here: number): void {
    this.hall = hall;
    this.here = here;
    this.hallChip.hidden = hall === null;
    this.refreshHall();
    if (this.whoEl.open) this.fillWho();
  }

  setRooms(rooms: RoomsResponse | null): void {
    this.rooms = rooms;
    if (this.hallsEl.open) this.fillHalls();
  }

  setWho(view: WhoView): void {
    this.who = view;
    if (this.whoEl.open) this.fillWho();
  }

  openHalls(): void {
    this.open(this.hallsEl, () => this.fillHalls());
    this.cb.hallsOpened();
  }

  /** A name label above someone tapped in the scene (spec 07 § Screens: "Tap a person"). */
  showName(text: string | null, x = 0, y = 0): void {
    this.nameTag.hidden = text === null;
    if (text === null) return;
    if (this.nameTag.textContent !== text) this.nameTag.textContent = text;
    this.nameTag.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
  }

  // --- Notices -----------------------------------------------------------------------------------

  setConnection(status: NetStatus): void {
    if (status === this.conn) return;
    this.conn = status;
    this.renderNotice();
  }

  showLiteSuggestion(show: boolean): void {
    this.liteShown = show;
    this.renderNotice();
  }

  private renderNotice(): void {
    this.notice.replaceChildren();
    const conn = CONN_NOTICE[this.conn];
    if (conn) {
      this.notice.append(el("p", { "data-t": conn.text }));
      if (conn.button) {
        const b = el("button", { type: "button", "data-t": conn.button });
        b.addEventListener("click", () => {
          if (this.conn === "refresh") window.location.reload();
          else this.openHalls();
        });
        this.notice.append(b);
      }
      this.notice.setAttribute("role", "status");
    } else if (this.liteShown) {
      const use = el("button", { type: "button", "data-t": "lite.use" });
      const later = el("button", { type: "button", "data-t": "lite.dismiss" });
      use.addEventListener("click", () => this.cb.liteAccept());
      later.addEventListener("click", () => this.cb.liteDismiss());
      this.notice.append(el("p", { "data-t": "lite.suggest" }), use, later);
      this.notice.removeAttribute("role");
    }
    this.notice.hidden = this.notice.childElementCount === 0;
    applyStrings(this.notice);
  }

  // --- Announcements -----------------------------------------------------------------------------

  /** Screen-reader announcement of the visitor's own result (spec 07 § Accessibility). */
  announce(key: StringKey): void {
    this.say(t(key));
  }

  /** Others' gestures and bells, summarised at most once every 10 s, never one by one. */
  noteRemote(kind: "namaste" | "pranam" | "bell"): void {
    this.remote[kind]++;
    this.summaryTimer ??= window.setTimeout(() => this.summarise(), SUMMARY_MS);
  }

  private summarise(): void {
    this.summaryTimer = null;
    const parts: string[] = [];
    const add = (n: number, one: StringKey, many: StringKey): void => {
      if (n === 1) parts.push(t(one));
      else if (n > 1) parts.push(t(many, { n }));
    };
    add(this.remote.namaste, "a11y.others_namaste_one", "a11y.others_namaste");
    add(this.remote.pranam, "a11y.others_pranam_one", "a11y.others_pranam");
    add(this.remote.bell, "a11y.others_bell_one", "a11y.others_bell");
    this.remote.namaste = this.remote.pranam = this.remote.bell = 0;
    if (parts.length > 0) this.say(parts.join(" "));
  }

  private say(text: string): void {
    this.live.textContent = "";
    // A new text node after clearing makes screen readers announce repeats too.
    requestAnimationFrame(() => (this.live.textContent = text));
  }

  setRest(kind: RestKind | null): void {
    if (kind === this.restKind) return;
    this.restKind = kind;
    this.rest.replaceChildren();
    this.rest.hidden = kind === null;
    this.rest.classList.toggle("rest-idle", kind === "idle");
    if (kind === null) return;
    if (kind === "idle") {
      const btn = el("button", { type: "button", "data-t": "rest.idle" });
      this.rest.append(btn);
      this.rest.setAttribute("aria-label", t("rest.idle"));
      btn.focus({ preventScroll: true });
    } else {
      const msg = el("p", { id: "rest-msg", "data-t": "rest.other_tab" });
      const btn = el("button", { type: "button", "data-t": "rest.continue" });
      btn.addEventListener("click", () => this.cb.resume());
      this.rest.append(msg, btn);
      this.rest.removeAttribute("aria-label");
      this.rest.setAttribute("aria-labelledby", "rest-msg");
      btn.focus({ preventScroll: true });
    }
    applyStrings(this.rest);
  }

  closeSheet(): void {
    for (const d of [this.sheetEl, this.hallsEl, this.whoEl]) if (d.open) d.close();
  }

  dispose(): void {
    for (const u of this.unsubscribe) u();
    if (this.summaryTimer !== null) window.clearTimeout(this.summaryTimer);
    this.root.remove();
    this.sheetEl.remove();
    this.hallsEl.remove();
    this.whoEl.remove();
    this.rest.remove();
  }

  // -------------------------------------------------------------------------------------------

  private open(d: HTMLDialogElement, fill: () => void): void {
    if (d.open) return;
    this.closeSheet();
    fill();
    d.showModal();
    this.cb.sheet(true);
  }

  private openWho(): void {
    this.open(this.whoEl, () => this.fillWho());
  }

  private refresh(): void {
    applyStrings(this.root);
    applyStrings(this.sheetEl);
    applyStrings(this.notice);
    applyStrings(this.rest);
    if (this.restKind === "idle") this.rest.setAttribute("aria-label", t("rest.idle"));
    this.refreshContext();
    this.refreshHall();
    if (this.hallsEl.open) this.fillHalls();
    if (this.whoEl.open) this.fillWho();
    applyStrings(this.hallsEl);
    applyStrings(this.whoEl);
    syncLangUi();
  }

  private refreshContext(): void {
    if (!this.context) return;
    const key: Record<ContextAction, StringKey> = {
      sit: "action.sit",
      stand: "action.stand",
      bell: "action.bell",
    };
    this.contextBtn.textContent = t(key[this.context]);
  }

  private refreshHall(): void {
    if (!this.hall) return;
    this.hallBtn.textContent = t("hud.hall", { n: this.hall.number });
    const span = this.hereBtn.querySelector("span");
    if (span) span.textContent = t("hud.here", { count: this.here });
  }

  private buildDialog(kind: "halls" | "who"): HTMLDialogElement {
    const id = `${kind}-title`;
    const d = el("dialog", { class: "sheet", "aria-labelledby": id });
    const form = el("form", { method: "dialog" });
    const header = el("header");
    header.append(
      el("h2", { id, "data-t": kind === "halls" ? "halls.title" : "who.title" }),
      el("button", { type: "submit", value: "close", "data-t": "settings.close" }),
    );
    form.append(header, el("div", { class: "sheet-body" }));
    d.append(form);
    d.addEventListener("close", () => this.cb.sheet(false));
    return d;
  }

  private fillHalls(): void {
    const body = this.hallsEl.querySelector(".sheet-body");
    if (!body) return;
    const list = el("ul", { class: "hall-list" });
    for (const h of this.rooms?.halls ?? []) {
      const li = el("li");
      const current = h.id === this.hall?.id;
      const full = h.count >= h.capacity;
      const b = el("button", { type: "button", class: "hall-row" });
      b.append(el("span", {}, ""), el("span", { class: "hall-count" }));
      const [name, count] = [...b.children] as HTMLElement[];
      if (name) name.textContent = t("hud.hall", { n: h.number });
      if (count) count.textContent = full ? t("halls.full") : t("hud.here", { count: h.count });
      if (current) {
        b.setAttribute("aria-current", "true");
        const mark = el("span", { class: "hall-current" });
        mark.textContent = t("halls.current");
        b.append(mark);
      }
      b.disabled = full && !current;
      b.addEventListener("click", () => {
        if (!current) this.cb.chooseHall(h.id);
        this.hallsEl.close();
      });
      li.append(b);
      list.append(li);
    }
    const note = el("p", { class: "note", "data-t": "halls.note" });
    body.replaceChildren(list, note);
    applyStrings(body);
  }

  private fillWho(): void {
    const body = this.whoEl.querySelector(".sheet-body");
    if (!body) return;
    const lang = currentLang();
    const { me, others, today } = this.who;
    const count = el("p", { class: "who-count" });
    count.textContent = t("hud.here", { count: others.length + (me ? 1 : 0) });
    const list = el("ul", { class: "who-list" });
    if (me) {
      const li = el("li");
      li.textContent = t("who.you", { name: nameLabel(me.name, lang) });
      list.append(li);
    }
    const names = others
      .map((v) => nameLabel(v.name, lang))
      .sort((a, b) => a.localeCompare(b, lang));
    for (const n of names) {
      const li = el("li");
      li.textContent = n;
      list.append(li);
    }
    const parts: Node[] = [count, list];
    if (others.length === 0) parts.push(el("p", { class: "note", "data-t": "who.alone" }));
    else parts.push(el("p", { class: "note", "data-t": "who.hint" }));
    if (today) {
      const section = el("section");
      const dl = el("ul", { class: "today" });
      for (const [key, n] of [
        ["today.diyas", today.diyas],
        ["today.malas", today.malas],
        ["today.parikramas", today.parikramas],
        ["today.visits", today.visits],
      ] as const) {
        const li = el("li");
        li.textContent = t(key, { n });
        dl.append(li);
      }
      section.append(el("h3", { "data-t": "today.title" }), dl);
      parts.push(section);
    }
    body.replaceChildren(...parts);
    applyStrings(body);
  }

  private buildSheet(): HTMLDialogElement {
    const d = el("dialog", { class: "sheet", "aria-labelledby": "settings-title" });
    const form = el("form", { method: "dialog" });
    const header = el("header");
    header.append(
      el("h2", { id: "settings-title", "data-t": "settings.title" }),
      el("button", { type: "submit", value: "close", "data-t": "settings.close" }),
    );

    const lang = el("section");
    const seg = el("div", { class: "seg", role: "group", "aria-labelledby": "settings-lang" });
    for (const [code, label] of [
      ["hi", "lang.hi"],
      ["en", "lang.en"],
    ] as const) {
      const b = el("button", { type: "button", "data-lang": code, lang: code, "data-t": label });
      b.addEventListener("click", () => setLang(code));
      seg.append(b);
    }
    lang.append(el("h3", { id: "settings-lang", "data-t": "settings.language" }), seg);

    const lite = el("section");
    const liteRow = el("label", { class: "row" });
    const liteBox = el("input", { type: "checkbox", "aria-describedby": "settings-lite-note" });
    liteBox.addEventListener("change", () => this.settings.update({ lite: liteBox.checked }));
    liteRow.append(liteBox, el("span", { "data-t": "settings.lite" }));
    lite.append(
      liteRow,
      el("p", { class: "note", id: "settings-lite-note", "data-t": "settings.lite_note" }),
    );

    const quality = el("section");
    const choices = el("div", {
      class: "choices",
      role: "radiogroup",
      "aria-labelledby": "settings-quality",
    });
    for (const value of ["auto", ...TIERS] as const) {
      const label = el("label", { class: "choice" });
      const radio = el("input", { type: "radio", name: "quality", value });
      radio.addEventListener("change", () => {
        if (radio.checked) this.settings.update({ tier: value });
      });
      label.append(radio, el("span", { "data-t": QUALITY_KEYS[value] }));
      choices.append(label);
    }
    quality.append(el("h3", { id: "settings-quality", "data-t": "settings.quality" }), choices);

    const motion = el("section");
    const motionRow = el("label", { class: "row" });
    const motionBox = el("input", { type: "checkbox" });
    motionBox.addEventListener("change", () =>
      this.settings.update({ reducedMotion: motionBox.checked }),
    );
    motionRow.append(motionBox, el("span", { "data-t": "settings.motion" }));
    motion.append(motionRow);

    const controls = el("section");
    const dl = el("dl");
    const keys: [string, StringKey, boolean][] = [
      ["W A S D · ↑ ↓ ← →", "controls.walk", false],
      ["controls.drag", "controls.look", true],
      ["E", "controls.context", false],
      ["V", "controls.darshan", false],
      ["3", "action.namaste", false],
      ["1", "action.pranam", false],
      ["Esc", "controls.close", false],
    ];
    for (const [k, v, translated] of keys) {
      dl.append(
        translated ? el("dt", { "data-t": k }) : el("dt", {}, k),
        el("dd", { "data-t": v }),
      );
    }
    controls.append(el("h3", { "data-t": "settings.controls" }), dl);

    form.append(header, lang, lite, quality, motion, controls);
    d.append(form);
    d.addEventListener("close", () => this.cb.sheet(false));
    return d;
  }

  /** Reflect the stored settings in the sheet's controls. */
  private syncSheet(): void {
    const s = this.settings.get();
    const lite = this.sheetEl.querySelector<HTMLInputElement>(
      'input[type="checkbox"][aria-describedby]',
    );
    if (lite) lite.checked = s.lite;
    for (const r of this.sheetEl.querySelectorAll<HTMLInputElement>('input[name="quality"]')) {
      r.checked = r.value === s.tier;
    }
    const motion = this.sheetEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1];
    if (motion)
      motion.checked =
        s.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    syncLangUi();
  }
}
