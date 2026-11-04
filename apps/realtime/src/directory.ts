import { DurableObject } from "cloudflare:workers";

/**
 * The single "directory" object: instance counts, `pick(hall)` and the temple-wide
 * today counters (spec 05 § DirectoryDO).
 *
 * M0: the class exists so the first migration can create it with SQLite storage.
 * Nothing calls it yet; `/api/rooms` serves static data. Its behaviour arrives in M2.
 */
export class DirectoryDO extends DurableObject<Env> {}
