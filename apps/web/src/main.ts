/**
 * Boot entry (spec 01 § Boot sequence). Kept small: the boot JS budget is 30 KB gzip (spec 10).
 * index.html already shows the boot screen; this file picks the next screen and lazy-loads the scene.
 */
import { initLangToggle } from "./i18n/lang";
import { hasWebGL2 } from "./platform/webgl";

type Screen = "boot" | "unsupported" | "error" | "temple";

function show(screen: Screen): void {
  document.body.dataset.screen = screen;
}

async function openTemple(): Promise<void> {
  const scene = await import("./scene/placeholder").catch((err: unknown) => {
    console.error("Scene bundle failed to load", err);
    return null;
  });
  if (!scene) {
    show("error");
    return;
  }
  try {
    scene.startPlaceholderScene(document.body);
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
