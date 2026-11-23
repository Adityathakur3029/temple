/**
 * Boot entry (spec 01 § Boot sequence). Kept small: the boot JS budget is 30 KB gzip (spec 10).
 * index.html already shows the boot screen; this file picks the next screen and lazy-loads the scene.
 */
import { initLangToggle } from "./i18n/lang";
import { readLocal, writeLocal } from "./platform/storage";
import { hasWebGL2 } from "./platform/webgl";

type Screen = "boot" | "unsupported" | "error" | "temple";

/** Spec 09 § Browser storage keys. Set once the visitor has read the boot notice. */
const NOTICE_KEY = "sannidhi:notice-v1";

function show(screen: Screen): void {
  document.body.dataset.screen = screen;
}

/**
 * Spec 07 § Boot notice. On a first visit the notice stays on the boot screen until the
 * visitor taps Enter; later visits skip it. Resolves at once when it was already read.
 */
function noticeRead(): Promise<void> {
  if (readLocal(NOTICE_KEY) === "1") return Promise.resolve();
  const enter = document.querySelector<HTMLButtonElement>("[data-action=enter]");
  if (!enter) return Promise.resolve();
  document.body.dataset.notice = "open";
  return new Promise((resolve) => {
    enter.addEventListener(
      "click",
      () => {
        writeLocal(NOTICE_KEY, "1");
        delete document.body.dataset.notice;
        resolve();
      },
      { once: true },
    );
  });
}

async function openTemple(): Promise<void> {
  // The scene bundle downloads while the visitor reads, but the temple (and their place
  // in a hall) only starts once they enter.
  const [scene] = await Promise.all([
    import("./scene/temple").catch((err: unknown) => {
      console.error("Scene bundle failed to load", err);
      return null;
    }),
    noticeRead(),
  ]);
  if (!scene) {
    show("error");
    return;
  }
  try {
    await scene.startTemple(document.body);
  } catch (err) {
    console.error("Renderer failed to start", err);
    show("unsupported");
    return;
  }
  show("temple");
}

initLangToggle();
document.querySelector("[data-action=retry]")?.addEventListener("click", () => {
  window.location.reload();
});

if (hasWebGL2()) {
  void openTemple();
} else {
  show("unsupported");
}
