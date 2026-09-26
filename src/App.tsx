import { useEffect, useRef, useState } from "react";
import PriceChart, { type PriceChartHandle } from "./components/PriceChart.js";
import { RANGES } from "./api/coingecko.js";
import { SPOT_POLL_MS, ALIGN_BUFFER_MS, delayToNextAlignedMark } from "./lib/pollSchedule.js";
import { formatClock, formatCountdown } from "./lib/format.js";

const COINS = [
  { coinId: "bitcoin", name: "Bitcoin", symbol: "BTC", accent: "#f7931a" },
  { coinId: "ethereum", name: "Ethereum", symbol: "ETH", accent: "#8a92f2" },
];

export default function App() {
  const [range, setRange] = useState("24H");
  const [lastUpdated, setLastUpdated] = useState<Record<string, number>>({});
  const [nextFetchAt, setNextFetchAt] = useState(
    () => Date.now() + delayToNextAlignedMark(SPOT_POLL_MS, ALIGN_BUFFER_MS),
  );
  const [now, setNow] = useState(() => Date.now());
  const chartRefs = useRef<Record<string, PriceChartHandle | null>>({});

  // Tick once a second purely to redraw the "next update in" countdown.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // The countdown is purely wall-clock driven — every panel polls on the
  // same aligned schedule, so there's one shared "next update" to display.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const alignedDelay = delayToNextAlignedMark(SPOT_POLL_MS, ALIGN_BUFFER_MS);
    const timeoutId = setTimeout(() => {
      setNextFetchAt(Date.now() + SPOT_POLL_MS);
      intervalId = setInterval(() => setNextFetchAt(Date.now() + SPOT_POLL_MS), SPOT_POLL_MS);
    }, alignedDelay);
    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, []);

  const updateTimestamps = Object.values(lastUpdated);
  const oldestUpdate = updateTimestamps.length === COINS.length ? Math.min(...updateTimestamps) : null;
  const secondsToNextFetch = Math.max(0, Math.round((nextFetchAt - now) / 1000));

  function handleRefreshAll() {
    for (const coin of COINS) {
      chartRefs.current[coin.coinId]?.refresh();
    }
  }

  return (
    <main className="page">
      <div className="toolbar">
        <div className="toolbar__status">
          {oldestUpdate && <span className="toolbar__updated">Updated {formatClock(oldestUpdate)}</span>}
          <span className="toolbar__countdown">
            Next update in {formatCountdown(secondsToNextFetch)}
          </span>
          <button
            type="button"
            className="toolbar__refresh"
            onClick={handleRefreshAll}
            aria-label="Refresh now"
          >
            ↻
          </button>
        </div>

        <div className="toolbar__ranges" role="tablist" aria-label="Time range">
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
      </div>

      {COINS.map((coin) => (
        <PriceChart
          key={coin.coinId}
          ref={(handle) => {
            chartRefs.current[coin.coinId] = handle;
          }}
          coinId={coin.coinId}
          name={coin.name}
          symbol={coin.symbol}
          accent={coin.accent}
          range={range}
          onSpotUpdate={(timestamp) =>
            setLastUpdated((prev) => ({ ...prev, [coin.coinId]: timestamp }))
          }
        />
      ))}
    </main>
  );
}
