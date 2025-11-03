import SymbolChart from "../components/SymbolChart.jsx";

const symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];

const LiveDashboard = () => {
  return (
    <section className="page">
      <header className="page__header">
        <h1>Live Dashboard</h1>
        <p className="page__subtitle">
          Streamed candlestick data from Binance-backed ingestion with
          per-symbol timeframe controls.
        </p>
      </header>
      <div className="dashboard-grid">
        {symbols.map((symbol) => (
          <SymbolChart key={symbol} symbol={symbol} />
        ))}
      </div>
    </section>
  );
};

export default LiveDashboard;
