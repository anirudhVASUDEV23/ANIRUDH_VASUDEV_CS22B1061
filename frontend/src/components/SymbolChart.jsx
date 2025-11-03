import { useEffect, useMemo, useState, useRef } from "react";
import Plot from "react-plotly.js";
import Plotly from "plotly.js-dist-min";
import axios from "axios";
import { useSocket } from "../context/SocketContext.jsx";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
const TIMEFRAMES = ["1s", "1m", "5m"];
const MAX_POINTS = {
  "1s": 120, // last 2 minutes of one-second candles
  "1m": 60, // last hour of one-minute candles
  "5m": 72, // last 6 hours of five-minute candles
};

const SymbolChart = ({ symbol }) => {
  const [activeTimeframe, setActiveTimeframe] = useState("1m");
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { lastMessage } = useSocket();
  const priceChartRef = useRef(null);
  const volumeChartRef = useRef(null);

  useEffect(() => {
    let ignore = false;
    const fetchCandles = async () => {
      setLoading(true);
      setError(null);
      try {
        const maxPoints = MAX_POINTS[activeTimeframe] ?? 120;
        const response = await axios.get(
          `${API_BASE}/api/price/${symbol.toLowerCase()}?timeframe=${activeTimeframe}&limit=${maxPoints}`
        );
        const candles = [...(response.data?.candles ?? [])]
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-maxPoints);
        if (!ignore) {
          setCandles(candles);
        }
      } catch (err) {
        if (!ignore) {
          console.error(`Failed to fetch candles for ${symbol}`, err);
          const message =
            err?.response?.data?.detail || "Unable to load historical data";
          setError(message);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    fetchCandles();
    return () => {
      ignore = true;
    };
  }, [symbol, activeTimeframe]);

  useEffect(() => {
    if (!lastMessage || lastMessage.type !== "candle_update") return;
    const messageSymbol = (lastMessage.symbol || "").toLowerCase();
    if (messageSymbol !== symbol.toLowerCase()) return;
    if (lastMessage.timeframe !== activeTimeframe) return;

    const newCandle = lastMessage.candle;
    if (!newCandle) return;

    console.log(
      `📊 ${symbol} ${activeTimeframe}: Updating with candle at ${newCandle.timestamp}`
    );

    setCandles((prev) => {
      const maxPoints = MAX_POINTS[activeTimeframe] ?? 120;
      if (!prev.length) {
        console.log(`📊 ${symbol} ${activeTimeframe}: First candle`);
        return [newCandle];
      }

      const lastTimestamp = prev[prev.length - 1]?.timestamp;
      if (lastTimestamp === newCandle.timestamp) {
        console.log(
          `📊 ${symbol} ${activeTimeframe}: Updating existing candle`
        );
        const next = [...prev];
        next[next.length - 1] = newCandle;
        return next;
      }

      console.log(
        `📊 ${symbol} ${activeTimeframe}: New candle, prev count: ${prev.length}`
      );
      const next = [...prev.slice(-(maxPoints - 1)), newCandle];
      return next;
    });
  }, [lastMessage, symbol, activeTimeframe]);

  const plotData = useMemo(() => {
    return [
      {
        type: "candlestick",
        x: [],
        open: [],
        high: [],
        low: [],
        close: [],
        increasing: { line: { color: "#10b981" } },
        decreasing: { line: { color: "#ef4444" } },
        name: `${symbol.toUpperCase()}`,
        hoverlabel: {
          bgcolor: "#1e293b",
          bordercolor: "#38bdf8",
          font: { color: "#e2e8f0", size: 12 },
        },
      },
    ];
  }, [symbol]);

  const volumePlotData = useMemo(() => {
    return [
      {
        type: "scatter",
        mode: "lines",
        x: [],
        y: [],
        name: "Volume",
        line: {
          color: "#64748b",
          width: 1.5,
        },
        fill: "tozeroy",
        fillcolor: "rgba(100, 116, 139, 0.3)",
        hovertemplate: "Volume: %{y:.2f}<extra></extra>",
      },
    ];
  }, []);

  const plotLayout = useMemo(() => {
    const xTickFormat = activeTimeframe === "1s" ? "%H:%M:%S" : "%H:%M";

    // Calculate x-axis range for 1s timeframe (last 10 seconds) - recalculate on every candle update for live updates
    let xAxisRange = undefined;
    if (activeTimeframe === "1s" && candles.length > 0) {
      const now = new Date();
      const tenSecondsAgo = new Date(now.getTime() - 10 * 1000);
      xAxisRange = [tenSecondsAgo, now];
    }

    // Calculate proper Y-axis range based on current candle data
    let yAxisRange = undefined;
    if (candles.length > 0) {
      const allPrices = candles.flatMap((c) => [c.low, c.high]);
      const minPrice = Math.min(...allPrices);
      const maxPrice = Math.max(...allPrices);
      const spread = maxPrice - minPrice;
      const padding =
        spread === 0
          ? Math.max(Math.abs(maxPrice) * 0.0005, 0.1)
          : spread * 0.05; // Add 5% padding or fallback padding when flat
      yAxisRange = [minPrice - padding, maxPrice + padding];
    }

    return {
      margin: { t: 10, r: 50, b: 40, l: 60 },
      paper_bgcolor: "#0f172a",
      plot_bgcolor: "#0f172a",
      font: {
        color: "#cbd5e1",
        size: 11,
        family: "Inter, system-ui, sans-serif",
      },
      xaxis: {
        title: { text: "", font: { size: 10 } },
        rangeslider: { visible: false },
        showgrid: true,
        gridcolor: "rgba(148, 163, 184, 0.08)",
        showline: true,
        linecolor: "rgba(148, 163, 184, 0.2)",
        tickformat: xTickFormat,
        type: "date",
        autorange: xAxisRange === undefined,
        range: xAxisRange,
      },
      yaxis: {
        title: { text: "Price", font: { size: 11 } },
        showgrid: true,
        gridcolor: "rgba(148, 163, 184, 0.08)",
        zeroline: false,
        autorange: yAxisRange === undefined,
        range: yAxisRange,
        fixedrange: false,
      },
      hovermode: "x unified",
      showlegend: false,
      transition: { duration: 200, easing: "cubic-in-out" },
    };
  }, [activeTimeframe, candles]);

  const volumeLayout = useMemo(() => {
    const xTickFormat = activeTimeframe === "1s" ? "%H:%M:%S" : "%H:%M";

    // Calculate x-axis range for 1s timeframe (last 10 seconds) - recalculate on every candle update for live updates
    let xAxisRange = undefined;
    if (activeTimeframe === "1s" && candles.length > 0) {
      const now = new Date();
      const tenSecondsAgo = new Date(now.getTime() - 10 * 1000);
      xAxisRange = [tenSecondsAgo, now];
    }

    // Calculate proper Y-axis range for volume based on current data
    let yAxisConfig = {
      title: { text: "Volume", font: { size: 10 } },
      showgrid: true,
      gridcolor: "rgba(148, 163, 184, 0.08)",
      zeroline: false,
      autorange: true,
      fixedrange: false,
    };

    // Use dynamic range based on actual volume data
    if (candles.length > 0) {
      const volumes = candles.map((c) => c.volume);
      const maxVolume = Math.max(...volumes);
      const minVolume = 0; // Volume always starts at 0

      // Ensure minimum range to prevent empty charts when volume is very low
      const minRange = 1; // Minimum Y-axis range
      const actualMax = Math.max(maxVolume, minRange);
      const padding = actualMax * 0.1; // 10% padding on top

      yAxisConfig = {
        ...yAxisConfig,
        autorange: false,
        range: [minVolume, actualMax + padding],
      };
    }

    return {
      margin: { t: 0, r: 50, b: 40, l: 60 },
      paper_bgcolor: "#0f172a",
      plot_bgcolor: "#0f172a",
      font: {
        color: "#cbd5e1",
        size: 11,
        family: "Inter, system-ui, sans-serif",
      },
      xaxis: {
        title: { text: "", font: { size: 10 } },
        showgrid: true,
        gridcolor: "rgba(148, 163, 184, 0.08)",
        showline: true,
        linecolor: "rgba(148, 163, 184, 0.2)",
        tickformat: xTickFormat,
        type: "date",
        autorange: xAxisRange === undefined,
        range: xAxisRange,
      },
      yaxis: yAxisConfig,
      hovermode: "x unified",
      showlegend: false,
    };
  }, [activeTimeframe, candles]);

  const plotConfig = useMemo(
    () => ({ responsive: true, displayModeBar: false, scrollZoom: false }),
    []
  );

  useEffect(() => {
    const priceComponent = priceChartRef.current;
    const volumeComponent = volumeChartRef.current;
    if (!priceComponent || !volumeComponent) return;

    const priceElement = priceComponent.el ?? priceComponent;
    const volumeElement = volumeComponent.el ?? volumeComponent;
    if (!priceElement || !volumeElement) return;

    if (!candles.length) return;

    const x = candles.map((candle) => new Date(candle.timestamp * 1000));
    const closes = candles.map((candle) => candle.close);

    // Update price chart
    const priceTrace = {
      ...plotData[0],
      x,
      open: candles.map((candle) => candle.open),
      high: candles.map((candle) => candle.high),
      low: candles.map((candle) => candle.low),
      close: closes,
    };

    const priceLayoutWithRevision = {
      ...plotLayout,
      datarevision: Date.now(),
    };

    // Update volume chart
    const volumeTrace = {
      ...volumePlotData[0],
      x,
      y: candles.map((candle) => candle.volume),
    };

    const volumeLayoutWithRevision = {
      ...volumeLayout,
      datarevision: Date.now(),
    };

    Plotly.react(
      priceElement,
      [priceTrace],
      priceLayoutWithRevision,
      plotConfig
    ).catch((err) => {
      console.error("Plotly price chart update failed", err);
    });

    Plotly.react(
      volumeElement,
      [volumeTrace],
      volumeLayoutWithRevision,
      plotConfig
    ).catch((err) => {
      console.error("Plotly volume chart update failed", err);
    });
  }, [candles, plotData, volumePlotData, plotLayout, volumeLayout, plotConfig]);

  return (
    <section className="symbol-card">
      <header className="symbol-card__header">
        <h2>{symbol.toUpperCase()}</h2>
        <div className="symbol-card__tabs">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              className={`symbol-card__tab ${
                activeTimeframe === tf ? "symbol-card__tab--active" : ""
              }`}
              onClick={() => setActiveTimeframe(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
      </header>

      {loading && <p className="symbol-card__status">Loading…</p>}
      {error && (
        <p className="symbol-card__status symbol-card__status--error">
          {error}
        </p>
      )}

      {!error && (
        <div className="symbol-card__charts">
          <div className="symbol-card__price-chart">
            <Plot
              ref={priceChartRef}
              data={plotData}
              layout={plotLayout}
              config={plotConfig}
              className="symbol-card__plot"
              useResizeHandler
              style={{ width: "100%", height: "100%" }}
              plotly={Plotly}
            />
          </div>
          <div className="symbol-card__volume-chart">
            <Plot
              ref={volumeChartRef}
              data={volumePlotData}
              layout={volumeLayout}
              config={plotConfig}
              className="symbol-card__plot"
              useResizeHandler
              style={{ width: "100%", height: "100%" }}
              plotly={Plotly}
            />
          </div>
        </div>
      )}

      {!loading && !error && candles.length === 0 && (
        <p className="symbol-card__status">No data available</p>
      )}
    </section>
  );
};

export default SymbolChart;
