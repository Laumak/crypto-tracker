# Crypto Tracker

https://laumak.github.io/crypto-tracker/

Live BTC and ETH price charts, built with Typescript, React + Vite. Data comes straight
from the public [CoinGecko API](https://www.coingecko.com/en/api) — no API
key required.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (defaults to http://localhost:5173).

## What's here

- Two panels, Bitcoin and Ethereum, each filling the full width of the
  page and exactly half the viewport height (chart, ticker, and range
  buttons included).
- Range selector per chart: **1H, 24H, 7D, 30D** — each re-fetches history
  from CoinGecko's `market_chart/range` endpoint, which auto-adjusts data
  granularity to the span requested.
- A live ticker polls the current spot price and 24h change every 20s
  (`simple/price`), and nudges the chart's most recent point so short
  ranges feel current without hammering the API.
- The full series quietly re-syncs every 60s in the background so a
  long-open tab doesn't go stale.

## Notes

- CoinGecko's free tier is rate-limited. If you see charts fail to load,
  wait a few seconds — the background poll will retry automatically.
- Swap `PriceChart`'s `coinId` prop for any other CoinGecko coin id to
  track a different asset.
