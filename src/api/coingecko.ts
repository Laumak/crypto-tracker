const BASE_URL = "https://api.coingecko.com/api/v3";

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
export async function fetchMarketChart(coinId: string, rangeKey: string): Promise<PricePoint[]> {
  const now = Math.floor(Date.now() / 1000);
  const from = now - rangeSeconds(rangeKey);
  const url = `${BASE_URL}/coins/${coinId}/market_chart/range?vs_currency=usd&from=${from}&to=${now}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CoinGecko request failed (${res.status})`);
  }
  const data = await res.json();
  return (data.prices || []).map(([timestamp, price]: [number, number]) => ({ timestamp, price }));
}

/**
 * Fetches the current spot price and 24h change for a coin — used to poll
 * a live-feeling ticker without re-fetching the whole chart every time.
 */
export async function fetchSpotPrice(coinId: string): Promise<SpotPrice> {
  const url = `${BASE_URL}/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CoinGecko request failed (${res.status})`);
  }
  const data = await res.json();
  const entry = data[coinId];
  if (!entry) throw new Error("Unexpected response shape");
  return { price: entry.usd, change24h: entry.usd_24h_change };
}
