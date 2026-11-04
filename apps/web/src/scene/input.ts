/**
 * Pointer and keyboard input for the temple (spec 02 § Controls, spec 07 § Keyboard):
 * drag to look, pinch or scroll to zoom, tap or click the ground to walk, W A S D or arrows to walk,
 * E for the context action, V for the darshan view, 1 to bow, 3 for namaste, Esc to close.
 */

export type KeyAction = "context" | "darshan" | "escape" | "pranam" | "namaste";

export interface InputHandlers {
  look(dxPx: number, dyPx: number): void;
  zoom(factor: number): void;
  tap(clientX: number, clientY: number): void;
  action(a: KeyAction): void;
  /** Any input at all (idle timer, tab ownership). */
  activity(): void;
}

const MOVE_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

const ACTION_KEYS: Readonly<Record<string, KeyAction>> = {
  KeyE: "context",
  KeyV: "darshan",
  Digit1: "pranam",
  Numpad1: "pranam",
  Digit3: "namaste",
  Numpad3: "namaste",
  Escape: "escape",
};

/** A drag shorter than this (in CSS px) still counts as a tap. */
const TAP_SLOP_PX = 8;
const TAP_MAX_MS = 600;

/** Keys typed into a form control are not walking. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))
  );
}

export class Input {
  private readonly held = new Set<string>();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private press: { id: number; x: number; y: number; at: number; dragged: boolean } | null = null;
  private pinch: number | null = null;
  /** While false (a sheet or overlay is open), keys don't walk and the canvas ignores gestures. */
  enabled = true;
  private readonly off: (() => void)[] = [];
  private readonly axesOut = { right: 0, forward: 0 };

  constructor(
    private readonly canvas: HTMLElement,
    private readonly h: InputHandlers,
  ) {
    const on = <K extends keyof WindowEventMap>(
      target: Window | HTMLElement,
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ): void => {
      target.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };

    on(canvas, "pointerdown", (e) => this.down(e));
    on(canvas, "pointermove", (e) => this.move(e));
    on(canvas, "pointerup", (e) => this.up(e));
    on(canvas, "pointercancel", (e) => this.cancel(e));
    on(canvas, "wheel", (e) => this.wheel(e), { passive: false });
    on(window, "keydown", (e) => this.key(e, true));
    on(window, "keyup", (e) => this.key(e, false));
    on(window, "blur", () => this.held.clear());
    on(window, "pointermove", () => h.activity(), { passive: true });
  }

  /** Keyboard walking as (right, forward), each −1…1, relative to the camera. Reused object. */
  axes(): { readonly right: number; readonly forward: number } {
    let right = 0;
    let forward = 0;
    const out = this.axesOut;
    out.right = 0;
    out.forward = 0;
    if (!this.enabled) return out;
    for (const code of this.held) {
      const v = MOVE_KEYS[code];
      if (v) {
        right += v[0];
        forward += v[1];
      }
    }
    out.right = Math.sign(right);
    out.forward = Math.sign(forward);
    return out;
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off.length = 0;
  }

  private key(e: KeyboardEvent, down: boolean): void {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (down) this.h.activity();
    if (e.code in MOVE_KEYS) {
      if (!down) this.held.delete(e.code);
      else if (this.enabled) {
        this.held.add(e.code);
        if (e.code.startsWith("Arrow")) e.preventDefault(); // don't scroll the page
      }
      return;
    }
    const action = ACTION_KEYS[e.code];
    if (down && action && !e.repeat && (this.enabled || action === "escape")) {
      this.h.action(action);
    }
  }

  private down(e: PointerEvent): void {
    this.h.activity();
    if (!this.enabled) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.press = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        at: performance.now(),
        dragged: false,
      };
    } else {
      // A second finger: pinch, never a tap.
      if (this.press) this.press.dragged = true;
      this.pinch = this.spread();
    }
  }

  private move(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev || !this.enabled) return;
    const next = { x: e.clientX, y: e.clientY };
    this.pointers.set(e.pointerId, next);
    if (this.pointers.size >= 2) {
      const d = this.spread();
      if (this.pinch && d > 0) this.h.zoom(this.pinch / d);
      this.pinch = d;
      return;
    }
    const p = this.press;
    if (!p || p.id !== e.pointerId) return;
    if (!p.dragged && Math.hypot(next.x - p.x, next.y - p.y) > TAP_SLOP_PX) p.dragged = true;
    if (p.dragged) this.h.look(next.x - prev.x, next.y - prev.y);
  }

  private up(e: PointerEvent): void {
    const p = this.press;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (!p || p.id !== e.pointerId) return;
    this.press = null;
    if (this.enabled && !p.dragged && performance.now() - p.at < TAP_MAX_MS)
      this.h.tap(e.clientX, e.clientY);
  }

  private cancel(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.press?.id === e.pointerId) this.press = null;
    if (this.pointers.size < 2) this.pinch = null;
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    this.h.activity();
    if (!this.enabled) return;
    this.h.zoom(Math.exp(Math.max(-1, Math.min(1, e.deltaY * 0.0015))));
  }

  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
