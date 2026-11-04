/**
 * Clock sync (spec 04 § Clock sync). Each `time` sample gives a round trip and an offset; the
 * sample with the lowest round trip of the last 5 wins. `serverNow()` is what lamp timers and the
 * aarti player use, never `Date.now()`.
 */

export const CLOCK_SAMPLES_KEPT = 5;

export interface ClockSample {
  rtt: number;
  off: number;
}

export class ClockSync {
  private readonly samples: ClockSample[] = [];
  /** Server time minus device time, in ms. */
  offset = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  get synced(): boolean {
    return this.samples.length > 0;
  }

  /** A reply to `time {c}`: `c` is the client ms sent, `s` the server ms, `at` when it arrived. */
  add(c: number, s: number, at: number = this.now()): void {
    const rtt = at - c;
    if (!(rtt >= 0) || !Number.isFinite(s)) return;
    this.samples.push({ rtt, off: s - (c + rtt / 2) });
    if (this.samples.length > CLOCK_SAMPLES_KEPT) this.samples.shift();
    let best = this.samples[0];
    for (const x of this.samples) if (best && x.rtt < best.rtt) best = x;
    if (best) this.offset = best.off;
  }

  /** Before the first sample, the welcome's serverTime gives a rough offset. */
  seed(serverTime: number, at: number = this.now()): void {
    if (!this.synced) this.offset = serverTime - at;
  }

  serverNow(): number {
    return this.now() + this.offset;
  }
}
