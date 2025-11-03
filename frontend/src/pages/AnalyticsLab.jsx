import { useEffect, useState, useRef } from "react";
import Plotly from "plotly.js-dist-min";
import axios from "axios";
import { useSocket } from "../context/SocketContext.jsx";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
const SYMBOLS = ["btcusdt", "ethusdt", "bnbusdt"];
const TIMEFRAMES = ["1s", "1m", "5m"];

const AnalyticsLab = () => {
  const [analyticsData, setAnalyticsData] = useState({});
  const [priceData, setPriceData] = useState({});
  const [correlationMatrices, setCorrelationMatrices] = useState({});
  const [liveZScores, setLiveZScores] = useState({});

  const { lastMessage } = useSocket();

  const priceChart1sRef = useRef(null);
  const priceChart1mRef = useRef(null);
  const priceChart5mRef = useRef(null);
  const zScoreChart1sRef = useRef(null);
  const zScoreChart1mRef = useRef(null);
  const zScoreChart5mRef = useRef(null);
  const correlationChart1sRef = useRef(null);
  const correlationChart1mRef = useRef(null);
  const correlationChart5mRef = useRef(null);

  // Listen for live z-score updates
  useEffect(() => {
    if (!lastMessage || lastMessage.type !== "live_zscore") return;

    const symbol = (lastMessage.symbol || "").toLowerCase();
    const tf = lastMessage.timeframe;
    const key = `${symbol}_${tf}`;

    setLiveZScores((prev) => {
      const existing = prev[key] || [];
      const newPoint = {
        timestamp: new Date(lastMessage.timestamp || Date.now()),
        value: Number(lastMessage.z_score ?? 0),
      };
      return { ...prev, [key]: [...existing, newPoint].slice(-200) };
    });
  }, [lastMessage]);

  const fetchAllData = async () => {
    try {
      const analyticsPromises = [];
      const pricePromises = [];
      const correlationPromises = [];

      TIMEFRAMES.forEach((tf) => {
        SYMBOLS.forEach((symbol) => {
          analyticsPromises.push(
            axios
              .get(
                `${API_BASE}/api/analytics/${symbol}?timeframe=${tf}&window=20`
              )
              .then((res) => ({ symbol, tf, data: res.data }))
              .catch(() => ({ symbol, tf, data: null }))
          );
          pricePromises.push(
            axios
              .get(`${API_BASE}/api/price/${symbol}?timeframe=${tf}&limit=100`)
              .then((res) => ({ symbol, tf, data: res.data.candles || [] }))
              .catch(() => ({ symbol, tf, data: [] }))
          );
        });

        correlationPromises.push(
          axios
            .get(`${API_BASE}/api/correlation?timeframe=${tf}`)
            .then((res) => ({ tf, data: res.data }))
            .catch(() => ({ tf, data: null }))
        );
      });

      const [analyticsResults, priceResults, correlationResults] =
        await Promise.all([
          Promise.all(analyticsPromises),
          Promise.all(pricePromises),
          Promise.all(correlationPromises),
        ]);

      const newAnalytics = {};
      analyticsResults.forEach(({ symbol, tf, data }) => {
        const key = `${symbol}_${tf}`;
        newAnalytics[key] = data;
      });

      const newPrices = {};
      priceResults.forEach(({ symbol, tf, data }) => {
        const key = `${symbol}_${tf}`;
        newPrices[key] = data;
      });

      const newCorrelations = {};
      correlationResults.forEach(({ tf, data }) => {
        newCorrelations[tf] = data;
      });

      setAnalyticsData(newAnalytics);
      setPriceData(newPrices);
      setCorrelationMatrices(newCorrelations);
    } catch (error) {
      console.error("Data fetch failed", error);
    }
  };

  // Initial load
  useEffect(() => {
    fetchAllData();
  }, []);

  // Periodic updates
  useEffect(() => {
    const interval1s = setInterval(() => fetchAllData(), 1000);
    const interval1m = setInterval(() => fetchAllData(), 60000);
    const interval5m = setInterval(() => fetchAllData(), 300000);

    return () => {
      clearInterval(interval1s);
      clearInterval(interval1m);
      clearInterval(interval5m);
    };
  }, []);

  const chartConfig = {
    displayModeBar: true,
    scrollZoom: true,
    responsive: true,
  };

  const updateCharts = () => {
    TIMEFRAMES.forEach((tf) => {
      // Price chart
      const priceTraces = SYMBOLS.map((symbol) => {
        const key = `${symbol}_${tf}`;
        const candles = priceData[key] || [];
        return {
          x: candles.map((c) => new Date(c.timestamp)),
          y: candles.map((c) => c.close),
          type: "scatter",
          mode: "lines",
          name: symbol.replace("usdt", "").toUpperCase(),
          line: { width: 2 },
        };
      });

      // Z-score chart
      const zScoreTraces = SYMBOLS.map((symbol) => {
        const key = `${symbol}_${tf}`;
        const zScores = liveZScores[key] || [];
        return {
          x: zScores.map((z) => z.timestamp),
          y: zScores.map((z) => z.value),
          type: "scatter",
          mode: "lines",
          name: symbol.replace("usdt", "").toUpperCase(),
          line: { width: 2 },
        };
      });

      // Add threshold lines
      if (zScoreTraces[0]?.x?.length > 0) {
        const xRange = zScoreTraces[0].x;
        zScoreTraces.push({
          x: [xRange[0], xRange[xRange.length - 1]],
          y: [2, 2],
          type: "scatter",
          mode: "lines",
          name: "+2σ",
          line: { dash: "dash", color: "red", width: 1 },
          showlegend: false,
        });
        zScoreTraces.push({
          x: [xRange[0], xRange[xRange.length - 1]],
          y: [-2, -2],
          type: "scatter",
          mode: "lines",
          name: "-2σ",
          line: { dash: "dash", color: "red", width: 1 },
          showlegend: false,
        });
      }

      // Correlation chart
      const matrix = correlationMatrices[tf];
      const correlationTraces = [];
      if (matrix && matrix.values) {
        correlationTraces.push({
          z: matrix.values,
          x: matrix.symbols,
          y: matrix.symbols,
          type: "heatmap",
          colorscale: "RdBu",
          zmid: 0,
          zmin: -1,
          zmax: 1,
          text: matrix.values.map((row) => row.map((val) => val.toFixed(3))),
          texttemplate: "%{text}",
          textfont: { size: 12 },
          colorbar: { title: "Correlation" },
        });
      }

      const priceRef =
        tf === "1s"
          ? priceChart1sRef
          : tf === "1m"
          ? priceChart1mRef
          : priceChart5mRef;
      const zScoreRef =
        tf === "1s"
          ? zScoreChart1sRef
          : tf === "1m"
          ? zScoreChart1mRef
          : zScoreChart5mRef;
      const correlationRef =
        tf === "1s"
          ? correlationChart1sRef
          : tf === "1m"
          ? correlationChart1mRef
          : correlationChart5mRef;

      if (
        priceRef.current &&
        priceTraces.length > 0 &&
        priceTraces[0].x.length > 0
      ) {
        Plotly.react(
          priceRef.current,
          priceTraces,
          {
            title: {
              text: `Price Comparison (${tf.toUpperCase()})`,
              font: { color: "#e2e8f0" },
            },
            xaxis: { title: "Time", type: "date", gridcolor: "#334155" },
            yaxis: { title: "Price (USDT)", gridcolor: "#334155" },
            paper_bgcolor: "#1e293b",
            plot_bgcolor: "#0f172a",
            font: { color: "#e2e8f0" },
            legend: { orientation: "h", y: 1.15 },
            margin: { t: 80, r: 40, b: 60, l: 60 },
            hovermode: "x unified",
          },
          chartConfig
        );
      }

      if (zScoreRef.current && zScoreTraces.length > 0) {
        Plotly.react(
          zScoreRef.current,
          zScoreTraces,
          {
            title: {
              text: `Live Z-Score (${tf.toUpperCase()})`,
              font: { color: "#e2e8f0" },
            },
            xaxis: { title: "Time", type: "date", gridcolor: "#334155" },
            yaxis: { title: "Z-Score", zeroline: true, gridcolor: "#334155" },
            paper_bgcolor: "#1e293b",
            plot_bgcolor: "#0f172a",
            font: { color: "#e2e8f0" },
            legend: { orientation: "h", y: 1.15 },
            margin: { t: 80, r: 40, b: 60, l: 60 },
            hovermode: "x unified",
          },
          chartConfig
        );
      }

      if (correlationRef.current && correlationTraces.length > 0) {
        Plotly.react(
          correlationRef.current,
          correlationTraces,
          {
            title: {
              text: `Correlation Matrix (${tf.toUpperCase()})`,
              font: { color: "#e2e8f0" },
            },
            paper_bgcolor: "#1e293b",
            plot_bgcolor: "#0f172a",
            font: { color: "#e2e8f0" },
            margin: { t: 80, r: 40, b: 60, l: 60 },
          },
          chartConfig
        );
      }
    });
  };

  useEffect(() => {
    updateCharts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceData, liveZScores, correlationMatrices]);

  return (
    <div className="page">
      <h1>Analytics Lab</h1>
      <p style={{ color: "#94a3b8", marginBottom: "2rem" }}>
        Real-time analytics across all timeframes. Charts update automatically:
        1s (every second), 1m (every minute), 5m (every 5 minutes).
      </p>

      {TIMEFRAMES.map((tf) => (
        <section key={tf} className="panel">
          <h2>{tf.toUpperCase()} Timeframe</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: "1.5rem",
              marginTop: "1rem",
            }}
          >
            <div
              ref={
                tf === "1s"
                  ? priceChart1sRef
                  : tf === "1m"
                  ? priceChart1mRef
                  : priceChart5mRef
              }
              style={{ width: "100%", height: "400px" }}
            />
            <div
              ref={
                tf === "1s"
                  ? zScoreChart1sRef
                  : tf === "1m"
                  ? zScoreChart1mRef
                  : zScoreChart5mRef
              }
              style={{ width: "100%", height: "400px" }}
            />
            <div
              ref={
                tf === "1s"
                  ? correlationChart1sRef
                  : tf === "1m"
                  ? correlationChart1mRef
                  : correlationChart5mRef
              }
              style={{ width: "100%", height: "400px" }}
            />
          </div>
        </section>
      ))}

      <section className="panel">
        <h2>Summary Statistics (All Timeframes)</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "2rem",
            marginTop: "1.5rem",
          }}
        >
          {SYMBOLS.map((symbol) => {
            const symbolName = symbol.replace("usdt", "").toUpperCase();
            const symbolColors = {
              BTC: "#f7931a",
              ETH: "#627eea",
              BNB: "#f3ba2f",
            };
            const color = symbolColors[symbolName] || "#38bdf8";

            return (
              <div
                key={symbol}
                style={{
                  background:
                    "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
                  border: `1px solid ${color}33`,
                  borderRadius: "12px",
                  padding: "1.5rem",
                  boxShadow: `0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)`,
                }}
              >
                <h3
                  style={{
                    color: color,
                    marginBottom: "1.5rem",
                    fontSize: "1.25rem",
                    fontWeight: "bold",
                    textAlign: "center",
                    borderBottom: `2px solid ${color}33`,
                    paddingBottom: "0.75rem",
                  }}
                >
                  {symbolName}
                </h3>
                {TIMEFRAMES.map((tf) => {
                  const key = `${symbol}_${tf}`;
                  const analytics = analyticsData[key];
                  if (!analytics) return null;

                  const zScoreColor =
                    Math.abs(analytics.z_score || 0) > 2
                      ? "#ef4444"
                      : Math.abs(analytics.z_score || 0) > 1
                      ? "#f59e0b"
                      : "#10b981";

                  return (
                    <div
                      key={tf}
                      style={{
                        background: "#0f172a",
                        border: "1px solid #334155",
                        padding: "1rem",
                        borderRadius: "8px",
                        marginBottom: "0.75rem",
                        transition: "all 0.2s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "#1e293b";
                        e.currentTarget.style.borderColor = color;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "#0f172a";
                        e.currentTarget.style.borderColor = "#334155";
                      }}
                    >
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: color,
                          marginBottom: "0.75rem",
                          fontWeight: "600",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        {tf} Timeframe
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: "0.5rem",
                          fontSize: "0.875rem",
                        }}
                      >
                        <div>
                          <div
                            style={{ color: "#64748b", fontSize: "0.75rem" }}
                          >
                            Price
                          </div>
                          <div style={{ color: "#e2e8f0", fontWeight: "600" }}>
                            ${(analytics.price || 0).toFixed(2)}
                          </div>
                        </div>
                        <div>
                          <div
                            style={{ color: "#64748b", fontSize: "0.75rem" }}
                          >
                            Z-Score
                          </div>
                          <div
                            style={{ color: zScoreColor, fontWeight: "600" }}
                          >
                            {(analytics.z_score || 0).toFixed(3)}
                          </div>
                        </div>
                        <div>
                          <div
                            style={{ color: "#64748b", fontSize: "0.75rem" }}
                          >
                            Volatility
                          </div>
                          <div style={{ color: "#cbd5e1", fontWeight: "600" }}>
                            {(analytics.volatility || 0).toFixed(4)}
                          </div>
                        </div>
                        <div>
                          <div
                            style={{ color: "#64748b", fontSize: "0.75rem" }}
                          >
                            Mean
                          </div>
                          <div style={{ color: "#cbd5e1", fontWeight: "600" }}>
                            ${(analytics.mean_price || 0).toFixed(2)}
                          </div>
                        </div>
                        <div>
                          <div
                            style={{ color: "#64748b", fontSize: "0.75rem" }}
                          >
                            Std Dev
                          </div>
                          <div style={{ color: "#cbd5e1", fontWeight: "600" }}>
                            ${(analytics.std_dev || 0).toFixed(2)}
                          </div>
                        </div>
                        <div>
                          <div
                            style={{ color: "#64748b", fontSize: "0.75rem" }}
                          >
                            Candles
                          </div>
                          <div style={{ color: "#cbd5e1", fontWeight: "600" }}>
                            {analytics.candles_count || 0}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default AnalyticsLab;
