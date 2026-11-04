/**
 * The temple HUD (spec 07 § HUD and § Screens), plain DOM. M1 shows what M1 can do: the Darshan
 * button in the dock, the Sit / Stand up context button, Settings, the Lite suggestion and the
 * rest overlay. Other dock actions arrive with their milestones.
 * Every visible string comes from the locale files (spec 07 § Acceptance criteria).
 */
import "./hud.css";
import { onLangChange, setLang, syncLangUi } from "../i18n/lang";
import { applyStrings, t, type StringKey } from "../i18n/t";
import type { SettingsStore } from "../platform/settings";
import { TIERS } from "../platform/tier";

export type ContextAction = "sit" | "stand";
export type RestKind = "other-tab" | "idle";

export interface HudCallbacks {
  context(): void;
  darshan(): void;
  /** The settings sheet opened or closed (input pauses while it is open). */
  sheet(open: boolean): void;
  resume(): void;
  liteAccept(): void;
  liteDismiss(): void;
}

// Original line icons (spec 11 § UI icon set): an eye for darshan, sliders for settings.
const EYE =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12c2.6-4.3 5.8-6.5 9.5-6.5s6.9 2.2 9.5 6.5c-2.6 4.3-5.8 6.5-9.5 6.5S5.1 16.3 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const SLIDERS =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';

const QUALITY_KEYS: Record<(typeof TIERS)[number] | "auto", StringKey> = {
  auto: "settings.quality_auto",
  low: "settings.quality_low",
  mid: "settings.quality_mid",
  high: "settings.quality_high",
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

export class Hud {
  private readonly root: HTMLElement;
  private readonly contextBtn: HTMLButtonElement;
  private readonly darshanBtn: HTMLButtonElement;
  private readonly notice: HTMLElement;
  private readonly live: HTMLElement;
  private readonly sheetEl: HTMLDialogElement;
  private readonly rest: HTMLElement;
  private context: ContextAction | null = null;
  private restKind: RestKind | null = null;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    host: HTMLElement,
    private readonly settings: SettingsStore,
    private readonly cb: HudCallbacks,
  ) {
    this.root = el("div", { class: "hud" });

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
    settingsBtn.addEventListener("click", () => this.openSheet());
    top.append(settingsBtn);

    this.notice = el("div", { class: "hud-notice", hidden: "" });

    const bottom = el("div", { class: "hud-bottom" });
    this.contextBtn = el("button", { type: "button", class: "hud-btn hud-context", hidden: "" });
    this.contextBtn.addEventListener("click", () => cb.context());
    const dock = el("div", { class: "hud-dock", role: "toolbar", "data-t-label": "hud.dock" });
    this.darshanBtn = el(
      "button",
      { type: "button", class: "hud-btn", "aria-pressed": "false" },
      EYE,
    );
    this.darshanBtn.append(el("span", { "data-t": "action.darshan" }));
    this.darshanBtn.addEventListener("click", () => cb.darshan());
    dock.append(this.darshanBtn);
    bottom.append(this.contextBtn, dock);

    this.live = el("div", { class: "sr-only", "aria-live": "polite" });
    this.root.append(top, this.notice, bottom, this.live);

    this.sheetEl = this.buildSheet();
    this.rest = el("div", { class: "rest", role: "dialog", "aria-modal": "true", hidden: "" });
    this.rest.addEventListener("click", () => {
      if (this.restKind === "idle") cb.resume();
    });

    host.append(this.root, this.sheetEl, this.rest);
    this.unsubscribe.push(onLangChange(() => this.refresh()));
    this.refresh();
  }

  get sheetOpen(): boolean {
    return this.sheetEl.open;
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

  showLiteSuggestion(show: boolean): void {
    this.notice.replaceChildren();
    this.notice.hidden = !show;
    if (!show) return;
    const msg = el("p", { "data-t": "lite.suggest" });
    const use = el("button", { type: "button", "data-t": "lite.use" });
    const later = el("button", { type: "button", "data-t": "lite.dismiss" });
    use.addEventListener("click", () => this.cb.liteAccept());
    later.addEventListener("click", () => this.cb.liteDismiss());
    this.notice.append(msg, use, later);
    applyStrings(this.notice);
  }

  /** Screen-reader announcement of the visitor's own result (spec 07 § Accessibility). */
  announce(key: StringKey): void {
    this.live.textContent = "";
    // A new text node after clearing makes screen readers announce repeats too.
    requestAnimationFrame(() => (this.live.textContent = t(key)));
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

  openSheet(): void {
    if (this.sheetEl.open) return;
    this.syncSheet();
    this.sheetEl.showModal();
    this.cb.sheet(true);
  }

  closeSheet(): void {
    if (this.sheetEl.open) this.sheetEl.close();
  }

  dispose(): void {
    for (const u of this.unsubscribe) u();
    this.root.remove();
    this.sheetEl.remove();
    this.rest.remove();
  }

  private refresh(): void {
    applyStrings(this.root);
    applyStrings(this.sheetEl);
    applyStrings(this.notice);
    applyStrings(this.rest);
    if (this.restKind === "idle") this.rest.setAttribute("aria-label", t("rest.idle"));
    this.refreshContext();
    syncLangUi();
  }

  private refreshContext(): void {
    if (this.context)
      this.contextBtn.textContent = t(this.context === "sit" ? "action.sit" : "action.stand");
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
