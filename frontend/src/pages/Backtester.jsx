import { useMemo, useState } from "react";
import Plot from "react-plotly.js";
import Plotly from "plotly.js-dist-min";
import axios from "axios";
import toast from "react-hot-toast";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

const Backtester = () => {
  const [form, setForm] = useState({
    symbol: "btcusdt",
    timeframe: "1m",
    z_threshold: 2,
    useCustomData: false,
  });
  const [priceSeries, setPriceSeries] = useState([]);
  const [signals, setSignals] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleInputChange = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((prev) => ({
      ...prev,
      [name]:
        type === "checkbox"
          ? checked
          : name === "z_threshold"
          ? Number(value)
          : value,
    }));
  };

  const calculateMetrics = (priceData, signalData) => {
    if (!signalData.length) return null;

    const trades = [];
    let currentTrade = null;

    // Match entry and exit signals to create trades
    signalData.forEach((signal) => {
      if (signal.type === "entry" && !currentTrade) {
        currentTrade = { entry: signal, exit: null };
      } else if (signal.type === "exit" && currentTrade) {
        currentTrade.exit = signal;
        trades.push(currentTrade);
        currentTrade = null;
      }
    });

    if (trades.length === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalProfitLoss: 0,
        avgProfit: 0,
        avgLoss: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
      };
    }

    // Calculate trade profits/losses
    const tradePnL = trades.map((trade) => {
      const entryPrice = trade.entry.price;
      const exitPrice = trade.exit.price;
      return ((exitPrice - entryPrice) / entryPrice) * 100; // Percentage return
    });

    const winningTrades = tradePnL.filter((pnl) => pnl > 0);
    const losingTrades = tradePnL.filter((pnl) => pnl < 0);
    const totalProfitLoss = tradePnL.reduce((sum, pnl) => sum + pnl, 0);
    const avgProfit = winningTrades.length
      ? winningTrades.reduce((sum, pnl) => sum + pnl, 0) / winningTrades.length
      : 0;
    const avgLoss = losingTrades.length
      ? losingTrades.reduce((sum, pnl) => sum + pnl, 0) / losingTrades.length
      : 0;

    // Calculate max drawdown
    let peak = -Infinity;
    let maxDrawdown = 0;
    let cumulative = 0;
    tradePnL.forEach((pnl) => {
      cumulative += pnl;
      if (cumulative > peak) peak = cumulative;
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    });

    // Calculate Sharpe ratio (simplified - assuming risk-free rate of 0)
    const avgReturn = totalProfitLoss / trades.length;
    const variance =
      tradePnL.reduce((sum, pnl) => sum + Math.pow(pnl - avgReturn, 2), 0) /
      trades.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

    return {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate:
        trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
      totalProfitLoss,
      avgProfit,
      avgLoss,
      maxDrawdown,
      sharpeRatio,
    };
  };

  const runBacktest = async () => {
    setLoading(true);
    setError(null);
    try {
      const symbol = form.symbol.toLowerCase();
      const [priceResponse, signalResponse] = await Promise.all([
        axios.get(
          `${API_BASE}/api/price/${symbol}?timeframe=${form.timeframe}&limit=300`
        ),
        axios.get(
          `${API_BASE}/api/backtest-signals/${symbol}?timeframe=${form.timeframe}&z_threshold=${form.z_threshold}`
        ),
      ]);
      const candles = priceResponse.data?.candles ?? [];
      const sigs = signalResponse.data?.signals ?? [];

      setPriceSeries(candles);
      setSignals(sigs);

      // Calculate performance metrics
      const performanceMetrics = calculateMetrics(candles, sigs);
      setMetrics(performanceMetrics);

      if (sigs.length > 0) {
        toast.success(`Backtest complete! Found ${sigs.length} signals.`);
      } else {
        toast.error("No signals generated. Try adjusting parameters.");
      }
    } catch (err) {
      console.error("Backtest run failed", err);
      setError("Unable to run backtest with current parameters");
      setPriceSeries([]);
      setSignals([]);
      setMetrics(null);
      toast.error("Backtest failed");
    } finally {
      setLoading(false);
    }
  };

  const plotData = useMemo(() => {
    if (!priceSeries.length) return [];
    const x = priceSeries.map((candle) => new Date(candle.timestamp * 1000));
    const priceTrace = {
      type: "scatter",
      mode: "lines",
      x,
      y: priceSeries.map((candle) => candle.close),
      name: `${form.symbol.toUpperCase()} price`,
      line: { color: "#c084fc" },
    };

    const entrySignals = signals.filter((signal) => signal.type === "entry");
    const exitSignals = signals.filter((signal) => signal.type === "exit");

    const entryTrace = {
      type: "scatter",
      mode: "markers",
      x: entrySignals.map((signal) => new Date(signal.timestamp * 1000)),
      y: entrySignals.map((signal) => signal.price),
      name: "Entry",
      marker: { color: "#22c55e", size: 10, symbol: "triangle-up" },
    };

    const exitTrace = {
      type: "scatter",
      mode: "markers",
      x: exitSignals.map((signal) => new Date(signal.timestamp * 1000)),
      y: exitSignals.map((signal) => signal.price),
      name: "Exit",
      marker: { color: "#ef4444", size: 10, symbol: "triangle-down" },
    };

    return [priceTrace, entryTrace, exitTrace];
  }, [priceSeries, signals, form.symbol]);

  return (
    <section className="page">
      <header className="page__header">
        <h1>Backtester</h1>
        <p className="page__subtitle">
          Simulate mean-reversion entries and exits on top of the latest market
          data.
        </p>
      </header>

      <form
        className="form form--grid"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="form__field">
          <span>Symbol</span>
          <input
            name="symbol"
            value={form.symbol}
            onChange={handleInputChange}
          />
        </label>
        <label className="form__field">
          <span>Timeframe</span>
          <select
            name="timeframe"
            value={form.timeframe}
            onChange={handleInputChange}
          >
            <option value="1s">1s</option>
            <option value="1m">1m</option>
            <option value="5m">5m</option>
          </select>
        </label>
        <label className="form__field">
          <span>Z-Score threshold</span>
          <input
            type="number"
            step="0.1"
            min={0.5}
            max={5}
            name="z_threshold"
            value={form.z_threshold}
            onChange={handleInputChange}
          />
        </label>
        <div className="form__actions">
          <button type="button" onClick={runBacktest} disabled={loading}>
            {loading ? "Running…" : "Run Backtest"}
          </button>
        </div>
      </form>

      {error ? (
        <p className="panel__status panel__status--error">{error}</p>
      ) : null}

      {/* Performance Metrics */}
      {metrics && metrics.totalTrades > 0 && (
        <section className="panel">
          <h2 style={{ marginBottom: "1.5rem" }}>Performance Metrics</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "1rem",
            }}
          >
            <div
              style={{
                background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
                border: "1px solid #334155",
                borderRadius: "8px",
                padding: "1rem",
              }}
            >
              <div
                style={{
                  color: "#94a3b8",
                  fontSize: "0.875rem",
                  marginBottom: "0.5rem",
                }}
              >
                Total Trades
              </div>
              <div
                style={{
                  color: "#e2e8f0",
                  fontSize: "1.5rem",
                  fontWeight: "700",
                }}
              >
                {metrics.totalTrades}
              </div>
            </div>

            <div
              style={{
                background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
                border: `1px solid ${
                  metrics.winRate >= 50 ? "#22c55e" : "#ef4444"
                }`,
                borderRadius: "8px",
                padding: "1rem",
              }}
            >
              <div
                style={{
                  color: "#94a3b8",
                  fontSize: "0.875rem",
                  marginBottom: "0.5rem",
                }}
              >
                Win Rate
              </div>
              <div
                style={{
                  color: metrics.winRate >= 50 ? "#22c55e" : "#ef4444",
                  fontSize: "1.5rem",
                  fontWeight: "700",
                }}
              >
                {metrics.winRate.toFixed(1)}%
              </div>
              <div
                style={{
                  color: "#64748b",
                  fontSize: "0.75rem",
                  marginTop: "0.25rem",
                }}
              >
                {metrics.winningTrades}W / {metrics.losingTrades}L
              </div>
            </div>

            <div
              style={{
                background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
                border: `1px solid ${
                  metrics.totalProfitLoss >= 0 ? "#22c55e" : "#ef4444"
                }`,
                borderRadius: "8px",
                padding: "1rem",
              }}
            >
              <div
                style={{
                  color: "#94a3b8",
                  fontSize: "0.875rem",
                  marginBottom: "0.5rem",
                }}
              >
                Total P/L
              </div>
              <div
                style={{
                  color: metrics.totalProfitLoss >= 0 ? "#22c55e" : "#ef4444",
                  fontSize: "1.5rem",
                  fontWeight: "700",
                }}
              >
                {metrics.totalProfitLoss >= 0 ? "+" : ""}
                {metrics.totalProfitLoss.toFixed(2)}%
              </div>
            </div>

            <div
              style={{
                background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
                border: "1px solid #334155",
                borderRadius: "8px",
                padding: "1rem",
              }}
            >
              <div
                style={{
                  color: "#94a3b8",
                  fontSize: "0.875rem",
                  marginBottom: "0.5rem",
                }}
              >
                Avg Win / Loss
              </div>
              <div
                style={{
                  color: "#22c55e",
                  fontSize: "1.25rem",
                  fontWeight: "700",
                }}
              >
                +{metrics.avgProfit.toFixed(2)}%
              </div>
              <div
                style={{
                  color: "#ef4444",
                  fontSize: "1.25rem",
                  fontWeight: "700",
                }}
              >
                {metrics.avgLoss.toFixed(2)}%
              </div>
            </div>

            <div
              style={{
                background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
                border: "1px solid #ef4444",
                borderRadius: "8px",
                padding: "1rem",
              }}
            >
              <div
                style={{
                  color: "#94a3b8",
                  fontSize: "0.875rem",
                  marginBottom: "0.5rem",
                }}
              >
                Max Drawdown
              </div>
              <div
                style={{
                  color: "#ef4444",
                  fontSize: "1.5rem",
                  fontWeight: "700",
                }}
              >
                -{metrics.maxDrawdown.toFixed(2)}%
              </div>
            </div>

            <div
              style={{
                background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
                border: `1px solid ${
                  metrics.sharpeRatio >= 1 ? "#22c55e" : "#f59e0b"
                }`,
                borderRadius: "8px",
                padding: "1rem",
              }}
            >
              <div
                style={{
                  color: "#94a3b8",
                  fontSize: "0.875rem",
                  marginBottom: "0.5rem",
                }}
              >
                Sharpe Ratio
              </div>
              <div
                style={{
                  color: metrics.sharpeRatio >= 1 ? "#22c55e" : "#f59e0b",
                  fontSize: "1.5rem",
                  fontWeight: "700",
                }}
              >
                {metrics.sharpeRatio.toFixed(2)}
              </div>
              <div
                style={{
                  color: "#64748b",
                  fontSize: "0.75rem",
                  marginTop: "0.25rem",
                }}
              >
                {metrics.sharpeRatio >= 2
                  ? "Excellent"
                  : metrics.sharpeRatio >= 1
                  ? "Good"
                  : "Poor"}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        {plotData.length ? (
          <Plot
            data={plotData}
            layout={{
              margin: { t: 30, r: 20, b: 40, l: 50 },
              paper_bgcolor: "#0f172a",
              plot_bgcolor: "#0f172a",
              font: { color: "#e2e8f0" },
              xaxis: { title: "Timestamp" },
              yaxis: { title: "Price" },
              autosize: true,
            }}
            config={{ responsive: true, displayModeBar: false }}
            useResizeHandler
            className="panel__plot"
            style={{ width: "100%", height: "100%" }}
            plotly={Plotly}
          />
        ) : (
          <p className="panel__placeholder">
            Run the backtest to visualise signals.
          </p>
        )}
      </section>
    </section>
  );
};

export default Backtester;
