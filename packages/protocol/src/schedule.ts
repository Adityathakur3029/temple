/**
 * IST helpers shared by client and server. India Standard Time is UTC+05:30 all year
 * (no daylight saving), so a fixed offset is exact.
 * Aarti scheduling and day phases arrive with M1/M4 (specs 02, 03, 06).
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The IST calendar date, "YYYY-MM-DD", for a moment given in ms since epoch. */
export function istDate(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}
