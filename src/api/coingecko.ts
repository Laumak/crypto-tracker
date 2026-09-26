const BASE_URL = "https://api.coingecko.com/api/v3";

// Matches the polling cadence in PriceChart — a reload within this window
// reuses the cached response instead of firing a fresh request.
const SPOT_CACHE_MS = 60_000;
const CHART_CACHE_MS = 60_000;

interface CacheEntry<T> {
  timestamp: number;
  value: T;
}

function readCache<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as CacheEntry<T>) : null;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, entry: CacheEntry<T>): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // sessionStorage unavailable or full — cache is best-effort, safe to ignore
  }
}

/**
 * Returns fresh cached data if within maxAgeMs, otherwise fetches, caches,
 * and returns the result. If the fetch fails, falls back to stale cached
 * data (if any) rather than throwing, so a rate-limited API doesn't crash
 * an otherwise-working view. The returned timestamp is always when the
 * data was actually fetched, not when this call was made.
 */
async function withCache<T>(
  key: string,
  maxAgeMs: number,
  fetcher: () => Promise<T>,
  force = false,
): Promise<CacheEntry<T>> {
  const cached = readCache<T>(key);
  if (!force && cached && Date.now() - cached.timestamp < maxAgeMs) {
    return cached;
  }
  try {
    const value = await fetcher();
    const entry = { timestamp: Date.now(), value };
    writeCache(key, entry);
    return entry;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

export interface RangeOption {
  key: string;
  label: string;
  seconds: number;
}

export interface PricePoint {
  timestamp: number;
  price: number;
}

export interface SpotPrice {
  price: number;
  change24h: number;
  lastUpdated: number;
}

// Range options exposed in the UI, mapped to a lookback window in seconds.
export const RANGES: RangeOption[] = [
  { key: "1H", label: "1H", seconds: 60 * 60 },
  { key: "24H", label: "24H", seconds: 60 * 60 * 24 },
  { key: "7D", label: "7D", seconds: 60 * 60 * 24 * 7 },
  { key: "30D", label: "30D", seconds: 60 * 60 * 24 * 30 },
];

export function rangeSeconds(rangeKey: string): number {
  const found = RANGES.find((r) => r.key === rangeKey);
  return found ? found.seconds : RANGES[1].seconds;
}

/**
 * Fetches historical price points for a coin over a given lookback window.
 * CoinGecko auto-selects granularity based on the from/to span (near-minute
 * data under a day, hourly under ~90 days).
 */
export async function fetchMarketChart(
  coinId: string,
  rangeKey: string,
  force = false,
): Promise<PricePoint[]> {
  const entry = await withCache(
    `chart:${coinId}:${rangeKey}`,
    CHART_CACHE_MS,
    async () => {
      const now = Math.floor(Date.now() / 1000);
      const from = now - rangeSeconds(rangeKey);
      const url = `${BASE_URL}/coins/${coinId}/market_chart/range?vs_currency=usd&from=${from}&to=${now}`;

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`CoinGecko request failed (${res.status})`);
      }
      const data = await res.json();
      return (data.prices || []).map(([timestamp, price]: [number, number]) => ({ timestamp, price }));
    },
    force,
  );
  return entry.value;
}

/**
 * Fetches the current spot price and 24h change for a coin — used to poll
 * a live-feeling ticker without re-fetching the whole chart every time.
 */
export async function fetchSpotPrice(coinId: string, force = false): Promise<SpotPrice> {
  const entry = await withCache(
    `spot:${coinId}`,
    SPOT_CACHE_MS,
    async () => {
      const url = `${BASE_URL}/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`CoinGecko request failed (${res.status})`);
      }
      const data = await res.json();
      const coin = data[coinId];
      if (!coin) throw new Error("Unexpected response shape");
      return { price: coin.usd, change24h: coin.usd_24h_change };
    },
    force,
  );
  return { ...entry.value, lastUpdated: entry.timestamp };
}
