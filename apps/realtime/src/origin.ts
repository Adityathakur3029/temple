/** Origin allow-list, configured per environment in wrangler.jsonc `ALLOWED_ORIGINS` (spec 05). */

/**
 * Parses the comma-separated list into canonical origins ("https://host[:port]"), so a
 * trailing slash or upper-case host in the config can't silently lock every visitor out.
 * Throws on an entry that isn't an http(s) origin.
 */
export function parseAllowedOrigins(value: string): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const entry of value.split(",").map((o) => o.trim())) {
    if (entry === "") continue;
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`ALLOWED_ORIGINS has an invalid entry: "${entry}"`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error(`ALLOWED_ORIGINS entry must be http(s): "${entry}"`);
    }
    origins.add(url.origin);
  }
  return origins;
}

/** A request without an Origin header is not allowed. Load-test bots set one explicitly. */
export function isAllowedOrigin(origin: string | null, allowList: string): boolean {
  return origin !== null && parseAllowedOrigins(allowList).has(origin);
}
