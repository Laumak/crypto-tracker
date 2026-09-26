import PriceChart from "./components/PriceChart.js";

export default function App() {
  return (
    <main className="page">
      <PriceChart coinId="bitcoin" name="Bitcoin" symbol="BTC" accent="#f7931a" />
      <PriceChart coinId="ethereum" name="Ethereum" symbol="ETH" accent="#8a92f2" />
    </main>
  );
}
