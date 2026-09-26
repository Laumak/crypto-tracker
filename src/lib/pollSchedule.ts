// CoinGecko's finest granularity is ~5 minutes, so polling faster than that
// just burns rate limit without ever seeing a new data point.
export const SPOT_POLL_MS = 5 * 60_000;
export const CHART_POLL_MS = 5 * 60_000;
// Give their backend a moment past each 5-minute mark to actually update,
// rather than fetching right on the boundary and risking a stale read.
export const ALIGN_BUFFER_MS = 15_000;

/** Ms until the next wall-clock mark (e.g. :00, :05, :10, ...) plus a buffer. */
export function delayToNextAlignedMark(intervalMs: number, bufferMs: number): number {
  const now = Date.now();
  const lastMark = Math.floor(now / intervalMs) * intervalMs;
  let target = lastMark + bufferMs;
  if (target <= now) target += intervalMs;
  return target - now;
}
