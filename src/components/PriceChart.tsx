import {
  forwardRef,
  useEffect,
  useImperativeHandle,
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
  ReferenceLine,
} from "recharts";
import {
  fetchMarketChart,
  fetchSpotPrice,
  type PricePoint,
  type SpotPrice,
} from "../api/coingecko.js";
import {
  SPOT_POLL_MS,
  CHART_POLL_MS,
  ALIGN_BUFFER_MS,
  delayToNextAlignedMark,
} from "../lib/pollSchedule.js";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const axisPriceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatPrice(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return currencyFormatter.format(value);
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

export interface PriceChartHandle {
  refresh: () => void;
}

interface PriceChartProps {
  coinId: string;
  name: string;
  symbol: string;
  accent: string;
  range: string;
  lastVisit: number | null;
  onSpotUpdate?: (timestamp: number) => void;
}

function PriceChart(
  { coinId, name, symbol, accent, range, lastVisit, onSpotUpdate }: PriceChartProps,
  ref: React.Ref<PriceChartHandle>,
) {
  const [series, setSeries] = useState<PricePoint[]>([]);
  const [spot, setSpot] = useState<SpotPrice | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const rangeRef = useRef(range);
  const pollSpotRef = useRef<(force?: boolean) => Promise<void>>(async () => {});
  const onSpotUpdateRef = useRef(onSpotUpdate);

  useEffect(() => {
    onSpotUpdateRef.current = onSpotUpdate;
  }, [onSpotUpdate]);

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
  // Aligned to wall-clock 5-minute marks (+ buffer) since that's roughly
  // CoinGecko's own data cadence — no point polling out of step with it.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const fire = () => loadPriceSeries(coinId, rangeRef.current, rangeRef, setSeries, setStatus);
    const timeoutId = setTimeout(
      () => {
        fire();
        intervalId = setInterval(fire, CHART_POLL_MS);
      },
      delayToNextAlignedMark(CHART_POLL_MS, ALIGN_BUFFER_MS),
    );
    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [coinId]);

  // Live ticker: poll spot price independently of the chart range, and
  // nudge the most recent chart point so short ranges feel live. Aligned
  // to wall-clock 5-minute marks (+ buffer), same reasoning as the chart poll.
  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    async function pollSpot(force = false) {
      try {
        const result = await fetchSpotPrice(coinId, force);
        if (cancelled) return;
        setSpot(result);
        onSpotUpdateRef.current?.(result.lastUpdated);
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
    pollSpot(); // cold start: show something immediately

    const alignedDelay = delayToNextAlignedMark(SPOT_POLL_MS, ALIGN_BUFFER_MS);
    const timeoutId = setTimeout(() => {
      pollSpot();
      intervalId = setInterval(() => pollSpot(), SPOT_POLL_MS);
    }, alignedDelay);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [coinId]);

  useImperativeHandle(ref, () => ({
    refresh() {
      pollSpotRef.current(true);
      loadPriceSeries(coinId, rangeRef.current, rangeRef, setSeries, setStatus, true);
    },
  }));

  const rangeStartPrice = series[0]?.price;
  const change = status === "ready" && spot && rangeStartPrice
    ? ((spot.price - rangeStartPrice) / rangeStartPrice) * 100
    : null;
  const changeIsUp = typeof change === "number" && change >= 0;
  const lastVisitPoint = lastVisit == null || series.length === 0
    ? null
    : series.reduce((closest, point) =>
        Math.abs(point.timestamp - lastVisit) < Math.abs(closest.timestamp - lastVisit)
          ? point
          : closest,
      series[0]);
  const showLastVisit = lastVisitPoint != null && lastVisit! >= series[0].timestamp &&
    lastVisit! <= series[series.length - 1].timestamp;

  return (
    <section className="panel" style={{ "--accent": accent } as CSSProperties}>
      <header className="panel__header">
        <div className="panel__identity">
          <span className="panel__symbol">{symbol}</span>
          <h2 className="panel__name">{name}</h2>
        </div>

        <div className="panel__ticker">
          <span className="panel__price">{formatPrice(spot?.price)}</span>
          {change != null && (
            <span className={`panel__change ${changeIsUp ? "is-up" : "is-down"}`}>
              {changeIsUp ? "▲" : "▼"} {Math.abs(change).toFixed(2)}% past {range.toLowerCase()}
            </span>
          )}
        </div>
      </header>

      <div className="panel__chart">
        {status === "error" && (
          <div className="panel__notice">
            Couldn't load {name} data. Retrying in the background.
          </div>
        )}
        {status === "loading" && (
          <div className="panel__spinner-overlay" role="status" aria-label={`Loading ${name} data`}>
            <span className="panel__spinner" />
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`fill-${coinId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--grid-line)" vertical={false} />
            <XAxis
              type="number"
              scale="time"
              dataKey="timestamp"
              domain={["dataMin", "dataMax"]}
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
              tickFormatter={(v) => axisPriceFormatter.format(v)}
              width={48}
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
            {showLastVisit && lastVisitPoint && (
              <ReferenceLine
                x={lastVisit ?? undefined}
                stroke="var(--axis)"
                strokeDasharray="5 5"
                label={{
                  value: `Last visit · ${formatPrice(lastVisitPoint.price)}`,
                  position: "insideTopRight",
                  fill: "var(--axis)",
                  fontSize: 12,
                }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export default forwardRef(PriceChart);
