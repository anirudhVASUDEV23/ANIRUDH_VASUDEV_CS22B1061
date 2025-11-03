import { useEffect, useState, useMemo, useCallback } from "react";
import Plot from "react-plotly.js";
import axios from "axios";
import toast from "react-hot-toast";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

const DashboardCard = ({
  title,
  value,
  subtitle,
  status,
  icon,
  color = "blue",
  children,
  className = "",
}) => {
  const colorClasses = {
    blue: "border-l-blue-500 bg-blue-50",
    green: "border-l-green-500 bg-green-50",
    purple: "border-l-purple-500 bg-purple-50",
    orange: "border-l-orange-500 bg-orange-50",
    red: "border-l-red-500 bg-red-50",
    indigo: "border-l-indigo-500 bg-indigo-50",
  };

  return (
    <div
      className={`bg-white rounded-xl shadow-sm border border-gray-200 border-l-4 ${colorClasses[color]} p-6 ${className}`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
            {title}
          </h3>
          <div className="flex items-baseline mt-2">
            <p className="text-3xl font-bold text-gray-900">{value}</p>
            {icon && <span className="ml-3 text-2xl">{icon}</span>}
          </div>
          {subtitle && <p className="text-sm text-gray-600 mt-2">{subtitle}</p>}
          {status && (
            <div
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mt-2 ${
                status === "success"
                  ? "bg-green-100 text-green-800"
                  : status === "warning"
                  ? "bg-yellow-100 text-yellow-800"
                  : status === "error"
                  ? "bg-red-100 text-red-800"
                  : "bg-gray-100 text-gray-800"
              }`}
            >
              {status}
            </div>
          )}
        </div>
      </div>
      {children}
    </div>
  );
};

const ChartContainer = ({ title, children, action }) => (
  <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
    <div className="flex items-center justify-between mb-6">
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      {action && (
        <button className="text-sm text-blue-600 hover:text-blue-800 font-medium">
          {action}
        </button>
      )}
    </div>
    {children}
  </div>
);

const PairsTrading = () => {
  const [symbol1, setSymbol1] = useState("btcusdt");
  const [symbol2, setSymbol2] = useState("ethusdt");
  const [timeframe, setTimeframe] = useState("1m");
  const [window, setWindow] = useState(50);

  const [pairsAnalytics, setPairsAnalytics] = useState(null);
  const [rollingCorrelation, setRollingCorrelation] = useState([]);
  const [robustRegression, setRobustRegression] = useState(null);
  const [loading, setLoading] = useState(false);

  const availableSymbols = ["btcusdt", "ethusdt", "bnbusdt"];
  const timeframes = ["1s", "1m", "5m"];

  const fetchAllAnalytics = useCallback(async () => {
    if (symbol1 === symbol2) {
      toast.error("Select different symbols for pairs analysis");
      return;
    }

    setLoading(true);
    try {
      const [pairsRes, corrRes, robustRes] = await Promise.all([
        axios.get(`${API_BASE}/api/pairs-analytics`, {
          params: { symbol1, symbol2, timeframe, window },
        }),
        axios.get(`${API_BASE}/api/rolling-correlation`, {
          params: { symbol1, symbol2, timeframe, window: 20, limit: 100 },
        }),
        axios.get(`${API_BASE}/api/robust-regression`, {
          params: { symbol1, symbol2, timeframe, window },
        }),
      ]);

      setPairsAnalytics(pairsRes.data);
      setRollingCorrelation(corrRes.data.correlations || []);
      setRobustRegression(robustRes.data);
    } catch (err) {
      console.error("Failed to fetch analytics", err);
      toast.error("Failed to load pairs analytics");
    } finally {
      setLoading(false);
    }
  }, [symbol1, symbol2, timeframe, window]);

  useEffect(() => {
    fetchAllAnalytics();
    const interval = setInterval(fetchAllAnalytics, 5000);
    return () => clearInterval(interval);
  }, [fetchAllAnalytics]);

  const correlationPlotData = useMemo(() => {
    if (!rollingCorrelation.length) return [];

    return [
      {
        type: "scatter",
        mode: "lines",
        x: rollingCorrelation.map((d) => new Date(d.timestamp * 1000)),
        y: rollingCorrelation.map((d) => d.correlation),
        name: "Rolling Correlation",
        line: { color: "#3b82f6", width: 3 },
        fillcolor: "rgba(59, 130, 246, 0.1)",
        fill: "tozeroy",
      },
    ];
  }, [rollingCorrelation]);

  const correlationLayout = {
    margin: { t: 30, r: 30, b: 50, l: 60 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: "#374151", size: 12 },
    xaxis: {
      showgrid: true,
      gridcolor: "rgba(0,0,0,0.1)",
      type: "date",
      tickformat: timeframe === "1s" ? "%H:%M:%S" : "%H:%M",
      title: { text: "Time", font: { size: 12 } },
    },
    yaxis: {
      showgrid: true,
      gridcolor: "rgba(0,0,0,0.1)",
      range: [-1, 1],
      zeroline: true,
      zerolinecolor: "rgba(0,0,0,0.2)",
      title: { text: "Correlation", font: { size: 12 } },
    },
    hovermode: "x unified",
    showlegend: false,
  };

  const regressionPlotData = useMemo(() => {
    if (!pairsAnalytics || !robustRegression) return [];

    const samplePoints = 50;
    const baseX = Array.from({ length: samplePoints }, (_, i) => i * 10);

    return [
      {
        type: "scatter",
        mode: "markers",
        name: "Price Points",
        x: baseX,
        y: baseX.map(
          (x) => x * pairsAnalytics.hedge_ratio + (Math.random() - 0.5) * 50
        ),
        marker: {
          size: 6,
          color: "#6b7280",
          opacity: 0.6,
        },
      },
      {
        type: "scatter",
        mode: "lines",
        name: "OLS Regression",
        x: baseX,
        y: baseX.map((x) => x * robustRegression.ols_hedge_ratio),
        line: { color: "#ef4444", width: 3 },
      },
      {
        type: "scatter",
        mode: "lines",
        name: "Robust (Theil-Sen)",
        x: baseX,
        y: baseX.map(
          (x) =>
            x * robustRegression.robust_slope +
            robustRegression.robust_intercept
        ),
        line: { color: "#10b981", width: 3, dash: "dash" },
      },
    ];
  }, [pairsAnalytics, robustRegression]);

  const regressionLayout = {
    margin: { t: 30, r: 30, b: 60, l: 60 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: "#374151", size: 12 },
    xaxis: {
      title: {
        text: `${symbol1.toUpperCase()} Price`,
        font: { size: 12 },
      },
      showgrid: true,
      gridcolor: "rgba(0,0,0,0.1)",
    },
    yaxis: {
      title: {
        text: `${symbol2.toUpperCase()} Price`,
        font: { size: 12 },
      },
      showgrid: true,
      gridcolor: "rgba(0,0,0,0.1)",
    },
    hovermode: "closest",
    showlegend: true,
    legend: {
      x: 0.02,
      y: 0.98,
      bgcolor: "rgba(255,255,255,0.9)",
      bordercolor: "rgba(0,0,0,0.1)",
    },
  };

  const getCorrelationStatus = (correlation) => {
    if (correlation > 0.7)
      return { text: "Strong Positive", color: "green", emoji: "📈" };
    if (correlation > 0.3)
      return { text: "Moderate Positive", color: "green", emoji: "↗️" };
    if (correlation > -0.3)
      return { text: "Weak", color: "orange", emoji: "➡️" };
    if (correlation > -0.7)
      return { text: "Moderate Negative", color: "red", emoji: "↘️" };
    return { text: "Strong Negative", color: "red", emoji: "📉" };
  };

  const getZScoreStatus = (zScore) => {
    if (Math.abs(zScore) > 2)
      return { text: "Extreme - Trade Signal!", color: "red", status: "error" };
    if (Math.abs(zScore) > 1)
      return {
        text: "Elevated - Watch Closely",
        color: "orange",
        status: "warning",
      };
    return { text: "Normal Range", color: "green", status: "success" };
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Pairs Trading Analytics
              </h1>
              <p className="text-gray-600 mt-2">
                Real-time statistical arbitrage and cointegration analysis
              </p>
            </div>
            <div className="flex items-center gap-3">
              {loading && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-100 rounded-lg">
                  <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse"></div>
                  <span className="text-sm font-medium text-blue-700">
                    Live updating...
                  </span>
                </div>
              )}
              <button
                onClick={fetchAllAnalytics}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <span>🔄</span>
                Refresh Data
              </button>
            </div>
          </div>
        </div>

        {/* Controls Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
          <DashboardCard
            title="Trading Pair Configuration"
            color="indigo"
            className="lg:col-span-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Symbol 1
                </label>
                <select
                  value={symbol1}
                  onChange={(e) => setSymbol1(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {availableSymbols.map((s) => (
                    <option key={s} value={s}>
                      {s.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Symbol 2
                </label>
                <select
                  value={symbol2}
                  onChange={(e) => setSymbol2(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {availableSymbols.map((s) => (
                    <option key={s} value={s}>
                      {s.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Timeframe
                </label>
                <select
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {timeframes.map((tf) => (
                    <option key={tf} value={tf}>
                      {tf}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Window Size
                </label>
                <input
                  type="number"
                  value={window}
                  onChange={(e) =>
                    setWindow(
                      Math.max(
                        10,
                        Math.min(500, parseInt(e.target.value) || 50)
                      )
                    )
                  }
                  min="10"
                  max="500"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </DashboardCard>
        </div>

        {/* Key Metrics */}
        {pairsAnalytics && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <DashboardCard
              title="Hedge Ratio"
              value={pairsAnalytics.hedge_ratio?.toFixed(4) || "—"}
              subtitle={`1 ${symbol1.toUpperCase()} ≈ ${pairsAnalytics.hedge_ratio?.toFixed(
                4
              )} ${symbol2.toUpperCase()}`}
              icon="⚖️"
              color="blue"
            />

            <DashboardCard
              title="Correlation"
              value={pairsAnalytics.correlation?.toFixed(3) || "—"}
              subtitle={getCorrelationStatus(pairsAnalytics.correlation).text}
              icon={getCorrelationStatus(pairsAnalytics.correlation).emoji}
              color={getCorrelationStatus(pairsAnalytics.correlation).color}
            />

            <DashboardCard
              title="Spread Z-Score"
              value={pairsAnalytics.spread_z_score?.toFixed(2) || "—"}
              subtitle={getZScoreStatus(pairsAnalytics.spread_z_score).text}
              status={getZScoreStatus(pairsAnalytics.spread_z_score).status}
              icon="📊"
              color={getZScoreStatus(pairsAnalytics.spread_z_score).color}
            />

            <DashboardCard
              title="Cointegration"
              value={pairsAnalytics.is_cointegrated ? "Yes" : "No"}
              subtitle={
                pairsAnalytics.is_cointegrated
                  ? "Tradable Pair"
                  : "Not Suitable"
              }
              status={pairsAnalytics.is_cointegrated ? "success" : "error"}
              icon={pairsAnalytics.is_cointegrated ? "✅" : "❌"}
              color={pairsAnalytics.is_cointegrated ? "green" : "red"}
            />
          </div>
        )}

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <ChartContainer
            title="Rolling Correlation Analysis"
            action="View details"
          >
            {rollingCorrelation.length > 0 ? (
              <Plot
                data={correlationPlotData}
                layout={correlationLayout}
                config={{ responsive: true, displayModeBar: true }}
                style={{ width: "100%", height: "400px" }}
                useResizeHandler={true}
              />
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-500 bg-gray-50 rounded-lg">
                <div className="text-center">
                  <div className="text-4xl mb-2">📊</div>
                  <p>No correlation data available</p>
                </div>
              </div>
            )}
          </ChartContainer>

          <ChartContainer title="Regression Analysis" action="Compare methods">
            {robustRegression ? (
              <Plot
                data={regressionPlotData}
                layout={regressionLayout}
                config={{ responsive: true, displayModeBar: true }}
                style={{ width: "100%", height: "400px" }}
                useResizeHandler={true}
              />
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-500 bg-gray-50 rounded-lg">
                <div className="text-center">
                  <div className="text-4xl mb-2">📈</div>
                  <p>No regression data available</p>
                </div>
              </div>
            )}
          </ChartContainer>
        </div>

        {/* Detailed Analytics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Cointegration Test Details */}
          {pairsAnalytics?.adf_test && (
            <DashboardCard title="Cointegration Test Details" color="purple">
              <div className="space-y-4 mt-4">
                <div className="flex justify-between items-center p-3 bg-white border border-gray-200 rounded-lg">
                  <span className="text-sm font-medium text-gray-700">
                    Test Statistic
                  </span>
                  <span className="font-mono font-bold text-gray-900">
                    {pairsAnalytics.adf_test.statistic?.toFixed(4)}
                  </span>
                </div>

                <div className="flex justify-between items-center p-3 bg-white border border-gray-200 rounded-lg">
                  <span className="text-sm font-medium text-gray-700">
                    P-Value
                  </span>
                  <span className="font-mono font-bold text-gray-900">
                    {pairsAnalytics.adf_test.p_value?.toFixed(4)}
                  </span>
                </div>

                <div
                  className={`p-4 rounded-lg border ${
                    pairsAnalytics.is_cointegrated
                      ? "bg-green-50 border-green-200"
                      : "bg-red-50 border-red-200"
                  }`}
                >
                  <div className="flex items-center">
                    <span
                      className={`text-lg mr-2 ${
                        pairsAnalytics.is_cointegrated
                          ? "text-green-600"
                          : "text-red-600"
                      }`}
                    >
                      {pairsAnalytics.is_cointegrated ? "✅" : "❌"}
                    </span>
                    <div>
                      <p
                        className={`font-semibold ${
                          pairsAnalytics.is_cointegrated
                            ? "text-green-800"
                            : "text-red-800"
                        }`}
                      >
                        {pairsAnalytics.is_cointegrated
                          ? "Cointegrated"
                          : "Not Cointegrated"}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">
                        {pairsAnalytics.is_cointegrated
                          ? "Mean-reverting spread detected - suitable for pairs trading"
                          : "No mean reversion - risky for statistical arbitrage"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </DashboardCard>
          )}

          {/* Regression Comparison */}
          {robustRegression && (
            <DashboardCard title="Regression Comparison" color="orange">
              <div className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                    <p className="text-sm font-medium text-red-700 mb-1">
                      OLS Slope
                    </p>
                    <p className="text-2xl font-bold text-gray-900">
                      {robustRegression.ols_hedge_ratio?.toFixed(4)}
                    </p>
                  </div>
                  <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                    <p className="text-sm font-medium text-green-700 mb-1">
                      Robust Slope
                    </p>
                    <p className="text-2xl font-bold text-gray-900">
                      {robustRegression.robust_slope?.toFixed(4)}
                    </p>
                  </div>
                </div>

                <div
                  className={`p-4 rounded-lg border ${
                    Math.abs(
                      (robustRegression.robust_slope || 0) -
                        (robustRegression.ols_hedge_ratio || 0)
                    ) > 0.01
                      ? "bg-yellow-50 border-yellow-200"
                      : "bg-gray-50 border-gray-200"
                  }`}
                >
                  <div className="flex items-center">
                    <span className="text-lg mr-2">
                      {Math.abs(
                        (robustRegression.robust_slope || 0) -
                          (robustRegression.ols_hedge_ratio || 0)
                      ) > 0.01
                        ? "⚠️"
                        : "✅"}
                    </span>
                    <div>
                      <p className="font-semibold text-gray-900">
                        Difference:{" "}
                        {Math.abs(
                          (robustRegression.robust_slope || 0) -
                            (robustRegression.ols_hedge_ratio || 0)
                        ).toFixed(4)}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">
                        {Math.abs(
                          (robustRegression.robust_slope || 0) -
                            (robustRegression.ols_hedge_ratio || 0)
                        ) > 0.01
                          ? "Significant difference detected - potential outliers"
                          : "Clean data with minimal difference"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </DashboardCard>
          )}
        </div>

        {/* Footer */}
        <div className="text-center text-gray-500 text-sm py-4 border-t border-gray-200">
          <p>
            Pairs Trading Analytics Dashboard • Real-time Data •{" "}
            {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  );
};

export default PairsTrading;
