import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  RANGES,
  fetchMarketChart,
  fetchSpotPrice,
  type PricePoint,
  type SpotPrice,
} from "../api/coingecko.js";

const SPOT_POLL_MS = 60_000; // live ticker refresh
const CHART_POLL_MS = 60_000; // background re-sync of the full series

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatPrice(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return currencyFormatter.format(value);
}

function formatLastUpdated(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatAxisTick(timestamp: number, rangeKey: string): string {
  const d = new Date(timestamp);
  if (rangeKey === "1H" || rangeKey === "24H") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

async function loadPriceSeries(
  coinId: string,
  rangeKey: string,
  rangeRef: RefObject<string>,
  setSeries: Dispatch<SetStateAction<PricePoint[]>>,
  setStatus: Dispatch<SetStateAction<Status>>,
  force = false,
) {
  try {
    const points = await fetchMarketChart(coinId, rangeKey, force);
    if (rangeRef.current !== rangeKey) return; // stale response, range changed mid-flight
    setSeries(points);
    setStatus("ready");
  } catch (err) {
    if (rangeRef.current !== rangeKey) return;
    console.error(err);
    setStatus("error");
  }
}

function formatTooltipLabel(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type Status = "loading" | "ready" | "error";

interface PriceChartProps {
  coinId: string;
  name: string;
  symbol: string;
  accent: string;
}

export default function PriceChart({ coinId, name, symbol, accent }: PriceChartProps) {
  const [range, setRange] = useState("24H");
  const [series, setSeries] = useState<PricePoint[]>([]);
  const [spot, setSpot] = useState<SpotPrice | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [nextFetchAt, setNextFetchAt] = useState(() => Date.now() + SPOT_POLL_MS);
  const [now, setNow] = useState(() => Date.now());
  const rangeRef = useRef(range);
  const pollSpotRef = useRef<(force?: boolean) => Promise<void>>(async () => {});

  // Tick once a second purely to redraw the "next update in" countdown.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  // Show the loading state immediately when the range changes, following
  // React's guidance to adjust state during render rather than in an effect.
  const [prevRange, setPrevRange] = useState(range);
  if (range !== prevRange) {
    setPrevRange(range);
    setStatus("loading");
  }

  // Reload the whole series whenever the selected range changes.
  useEffect(() => {
    loadPriceSeries(coinId, range, rangeRef, setSeries, setStatus);
  }, [coinId, range]);

  // Keep the series warm in the background so a long-open tab doesn't go stale.
  useEffect(() => {
    const id = setInterval(
      () => loadPriceSeries(coinId, rangeRef.current, rangeRef, setSeries, setStatus),
      CHART_POLL_MS,
    );
    return () => clearInterval(id);
  }, [coinId]);

  // Live ticker: poll spot price independently of the chart range, and
  // nudge the most recent chart point so short ranges feel live.
  useEffect(() => {
    let cancelled = false;

    async function pollSpot(force = false) {
      setNextFetchAt(Date.now() + SPOT_POLL_MS);
      try {
        const result = await fetchSpotPrice(coinId, force);
        if (cancelled) return;
        setSpot(result);
        setSeries((prev) => {
          if (!prev.length) return prev;
          const now = Date.now();
          const next = prev.slice();
          const last = next[next.length - 1];
          // Only append a fresh tick if enough time passed since the last point,
          // otherwise just move the last point's price to avoid a noisy tail.
          if (now - last.timestamp > 15_000) {
            next.push({ timestamp: now, price: result.price });
          } else {
            next[next.length - 1] = { ...last, price: result.price };
          }
          return next;
        });
      } catch (err) {
        console.error(err);
      }
    }

    pollSpotRef.current = pollSpot;
    pollSpot();
    const id = setInterval(() => pollSpot(), SPOT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [coinId]);

  function handleRefresh() {
    pollSpotRef.current(true);
    loadPriceSeries(coinId, rangeRef.current, rangeRef, setSeries, setStatus, true);
  }

  const change = spot?.change24h;
  const changeIsUp = typeof change === "number" && change >= 0;
  const secondsToNextFetch = Math.max(0, Math.round((nextFetchAt - now) / 1000));

  return (
    <section className="panel" style={{ "--accent": accent } as CSSProperties}>
      <header className="panel__header">
        <div className="panel__identity">
          <span className="panel__symbol">{symbol}</span>
          <h2 className="panel__name">{name}</h2>
        </div>

        <div className="panel__ticker">
          <span className="panel__price">{formatPrice(spot?.price)}</span>
          {typeof change === "number" && (
            <span className={`panel__change ${changeIsUp ? "is-up" : "is-down"}`}>
              {changeIsUp ? "▲" : "▼"} {Math.abs(change).toFixed(2)}% past 24h
            </span>
          )}
          {spot?.lastUpdated && (
            <span className="panel__updated">Updated {formatLastUpdated(spot.lastUpdated)}</span>
          )}
          <span className="panel__countdown">Next update in {secondsToNextFetch}s</span>
          <button
            type="button"
            className="panel__refresh"
            onClick={handleRefresh}
            aria-label={`Refresh ${name} now`}
          >
            ↻
          </button>
        </div>

        <div className="panel__ranges" role="tablist" aria-label={`${name} time range`}>
          {RANGES.map((r) => (
            <button
              key={r.key}
              role="tab"
              aria-selected={range === r.key}
              className={`range-btn ${range === r.key ? "is-active" : ""}`}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      <div className="panel__chart">
        {status === "error" && (
          <div className="panel__notice">
            Couldn't load {name} data. Retrying in the background.
          </div>
        )}
        {status === "loading" && series.length === 0 && (
          <div className="panel__notice">Loading {name} price history…</div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`fill-${coinId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--grid-line)" vertical={false} />
            <XAxis
              dataKey="timestamp"
              tickFormatter={(v) => formatAxisTick(v, range)}
              stroke="var(--axis)"
              tick={{ fontSize: 12, fill: "var(--axis)" }}
              minTickGap={40}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={["auto", "auto"]}
              orientation="right"
              stroke="var(--axis)"
              tick={{ fontSize: 12, fill: "var(--axis)" }}
              tickFormatter={(v) => formatPrice(v)}
              width={90}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value) => [formatPrice(value as number), name]}
              labelFormatter={(label) => formatTooltipLabel(Number(label))}
              contentStyle={{
                background: "var(--tooltip-bg)",
                border: "1px solid var(--tooltip-border)",
                borderRadius: 8,
                fontSize: 13,
              }}
              labelStyle={{ color: "var(--tooltip-label)" }}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke="var(--accent)"
              strokeWidth={2}
              fill={`url(#fill-${coinId})`}
              isAnimationActive={false}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
