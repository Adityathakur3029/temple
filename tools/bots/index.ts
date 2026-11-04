/**
 * Load-test bots (spec 12 § Load and soak tests).
 *
 *   npm run bots -- --hall hall-01 --n 50 --duration 600 --mix wanderer:70,bell-ringer:20,reconnector:10
 *
 * Options: --url (default http://localhost:8787), --origin (an allowed app origin, default
 * http://localhost:5173), --hall, --n, --mix, --duration (seconds), --lite, --ramp (seconds over
 * which bots join), --check instance (exit 1 unless the instance load test passes).
 * Against local dev the report includes the server's flush times (/api/dev/stats).
 */
import { HALL_IDS, INSTANCES_PER_HALL, isHallId, type HallId } from "@sannidhi/protocol";
import { BEHAVIOURS, Bot, type Behaviour, type BotStats } from "./bot";

interface Args {
  url: string;
  origin: string;
  hall: HallId;
  n: number;
  mix: [Behaviour, number][];
  durationS: number;
  rampS: number;
  lite: boolean;
  check: "instance" | null;
}

export function parseArgs(argv: readonly string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const hall = get("hall") ?? HALL_IDS[0] ?? "hall-01";
  if (!isHallId(hall)) throw new Error(`--hall must be hall-01 … hall-20, got ${hall}`);
  const mix = (get("mix") ?? "wanderer:70,bell-ringer:20,reconnector:10").split(",").map((part) => {
    const [name = "", share = "1"] = part.split(":");
    if (!(BEHAVIOURS as readonly string[]).includes(name)) {
      throw new Error(`Unknown behaviour "${name}" (have: ${BEHAVIOURS.join(", ")})`);
    }
    return [name as Behaviour, Number(share)] as [Behaviour, number];
  });
  const check = get("check");
  if (check !== undefined && check !== "instance") throw new Error("--check takes: instance");
  return {
    url: (get("url") ?? "http://localhost:8787").replace(/\/+$/, ""),
    origin: get("origin") ?? "http://localhost:5173",
    hall,
    n: Number(get("n") ?? 10),
    mix,
    durationS: Number(get("duration") ?? 60),
    rampS: Number(get("ramp") ?? 10),
    lite: argv.includes("--lite"),
    check: check ?? null,
  };
}

/** Deals behaviours out by share, e.g. 70/20/10 of 50 bots → 35, 10, 5. */
export function assign(n: number, mix: readonly [Behaviour, number][]): Behaviour[] {
  const total = mix.reduce((s, [, w]) => s + w, 0);
  const out: Behaviour[] = [];
  mix.forEach(([b, w], i) => {
    const count = i === mix.length - 1 ? n - out.length : Math.round((n * w) / total);
    for (let k = 0; k < count && out.length < n; k++) out.push(b);
  });
  return out;
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

function merge(all: readonly BotStats[]): BotStats {
  const out: BotStats = {
    connects: 0,
    connectMs: [],
    deltaGapsMs: [],
    bytesDown: 0,
    bytesUp: 0,
    corrects: 0,
    closes: {},
    errors: 0,
    resumes: 0,
    resumesKept: 0,
    instances: new Set(),
    wireDown: 0,
    extensions: "",
    stuck: 0,
  };
  for (const s of all) {
    out.stuck += s.stuck;
    if (s.extensions) out.extensions = s.extensions;
    out.connects += s.connects;
    out.connectMs.push(...s.connectMs);
    out.deltaGapsMs.push(...s.deltaGapsMs);
    out.bytesDown += s.bytesDown;
    out.bytesUp += s.bytesUp;
    out.corrects += s.corrects;
    out.errors += s.errors;
    out.resumes += s.resumes;
    out.resumesKept += s.resumesKept;
    for (const [k, v] of Object.entries(s.closes)) out.closes[k] = (out.closes[k] ?? 0) + v;
    for (const i of s.instances) out.instances.add(i);
  }
  return out;
}

interface RoomStats {
  sockets: number;
  flushes: number;
  flushP95Ms: number;
  flushMaxMs: number;
}

async function serverStats(args: Args): Promise<Map<number, RoomStats>> {
  const out = new Map<number, RoomStats>();
  for (let i = 1; i <= INSTANCES_PER_HALL; i++) {
    try {
      const res = await fetch(
        `${args.url}/api/dev/stats?room=${encodeURIComponent(`${args.hall}#${i}`)}`,
      );
      if (!res.ok) return out; // not local dev
      const s = (await res.json()) as RoomStats;
      if (s.flushes > 0) out.set(i, s);
    } catch {
      return out;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const wsUrl = args.url.replace(/^http/, "ws");
  const kinds = assign(args.n, args.mix);
  console.log(
    `${args.n} bots → ${args.hall} at ${args.url} for ${args.durationS} s` +
      ` (${args.mix.map(([b]) => `${b} ${kinds.filter((k) => k === b).length}`).join(", ")})${args.lite ? ", Lite" : ""}`,
  );
  const bots = kinds.map(
    (behaviour) =>
      new Bot({
        url: wsUrl,
        origin: args.origin,
        hall: args.hall,
        lite: args.lite,
        behaviour,
        random: Math.random,
      }),
  );
  const gap = bots.length > 1 ? (args.rampS * 1000) / bots.length : 0;
  for (const bot of bots) {
    bot.start();
    await new Promise((r) => setTimeout(r, gap));
  }
  // Measure after the ramp: payload and wire bytes per bot, and the busiest second.
  const measureFrom = Date.now();
  const total = (f: (b: Bot) => number): number => bots.reduce((sum, b) => sum + f(b), 0);
  const zeroDown = total((b) => b.stats.bytesDown);
  const zeroWire = total((b) => b.wireDownNow());
  const zeroUp = total((b) => b.stats.bytesUp);
  let peakWire = 0;
  let lastWire = zeroWire;
  const sampler = setInterval(() => {
    const now = total((b) => b.wireDownNow());
    peakWire = Math.max(peakWire, (now - lastWire) / bots.length);
    lastWire = now;
  }, 1000);
  await new Promise((r) => setTimeout(r, args.durationS * 1000));
  clearInterval(sampler);
  const seconds = (Date.now() - measureFrom) / 1000;
  const downDuring = total((b) => b.stats.bytesDown) - zeroDown;
  const wireDuring = total((b) => b.wireDownNow()) - zeroWire;
  const upDuring = total((b) => b.stats.bytesUp) - zeroUp;
  const rooms = await serverStats(args);
  for (const bot of bots) bot.stop();
  await new Promise((r) => setTimeout(r, 500));

  const s = merge(bots.map((b) => b.stats));
  const perBotDown = downDuring / bots.length / seconds;
  const perBotWire = wireDuring / bots.length / seconds;
  const perBotUp = upDuring / bots.length / seconds;
  const expected = new Set(["dropped", "1000", "1005"]);
  const unexpected = Object.entries(s.closes).filter(([code]) => !expected.has(code));
  console.log("");
  console.log(
    `connect time        p50 ${percentile(s.connectMs, 0.5)} ms · p95 ${percentile(s.connectMs, 0.95)} ms (${s.connects} welcomes)`,
  );
  console.log(
    `delta interval      p50 ${percentile(s.deltaGapsMs, 0.5)} ms · p95 ${percentile(s.deltaGapsMs, 0.95)} ms`,
  );
  const kb = (n: number): string => `${(n / 1000).toFixed(2)} KB/s`;
  console.log(
    `downstream per bot  ${kb(perBotWire)} on the wire (peak second ${kb(peakWire)}) · ${kb(perBotDown)} as JSON`,
  );
  console.log(`upstream per bot    ${kb(perBotUp)} as JSON`);
  console.log(`compression         ${s.extensions || "none negotiated"}`);
  console.log(`steps refused       ${s.stuck} (bot route check)`);
  console.log(`corrections         ${s.corrects}`);
  console.log(`closes              ${JSON.stringify(s.closes)}`);
  console.log(`errors              ${s.errors}`);
  console.log(`resumes             ${s.resumesKept}/${s.resumes} kept their visitor id`);
  console.log(`instances           ${[...s.instances].sort().join(", ")}`);
  for (const [i, r] of rooms) {
    console.log(
      `server ${args.hall}#${i}  ${r.sockets} sockets · flush p95 ${r.flushP95Ms} ms · max ${r.flushMaxMs} ms · ${r.flushes} flushes`,
    );
  }

  if (args.check === "instance") {
    // Spec 10 § Network and data budget, measured on the wire (after compression).
    const average = args.lite ? 1500 : 3000;
    const peak = args.lite ? 5000 : 12_000;
    const up = args.lite ? 500 : 1000;
    const flush = Math.max(0, ...[...rooms.values()].map((r) => r.flushP95Ms));
    const failures = [
      rooms.size === 0 ? "no server flush stats (run against local dev with DEV_STATS)" : null,
      flush >= 10 ? `flush p95 ${flush} ms ≥ 10 ms` : null,
      perBotWire > average ? `average downstream ${kb(perBotWire)} > ${kb(average)}` : null,
      peakWire > peak ? `peak downstream ${kb(peakWire)} > ${kb(peak)}` : null,
      perBotUp > up ? `upstream ${kb(perBotUp)} > ${kb(up)}` : null,
      s.stuck > 0 ? `${s.stuck} bot steps refused by the zone check` : null,
      unexpected.length > 0
        ? `unexpected closes ${JSON.stringify(Object.fromEntries(unexpected))}`
        : null,
    ].filter((f): f is string => f !== null);
    console.log("");
    if (failures.length > 0) {
      console.log(`Instance load test: FAIL\n  - ${failures.join("\n  - ")}`);
      process.exitCode = 1;
    } else console.log("Instance load test: PASS");
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("tools/bots/index.ts")) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
