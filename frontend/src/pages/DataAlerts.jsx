import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
const SYMBOLS = ["btcusdt", "ethusdt", "bnbusdt"];

const DataAlerts = () => {
  const [statsRows, setStatsRows] = useState([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [triggeredAlerts, setTriggeredAlerts] = useState([]);
  const [selectedSymbol, setSelectedSymbol] = useState("btcusdt");
  const [alertForm, setAlertForm] = useState({
    symbol: "btcusdt",
    condition: "z_score >",
    value: 2,
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const gridRef = useRef(null);

  const columnDefs = useMemo(
    () => [
      {
        headerName: "Timestamp",
        field: "timestamp",
        valueFormatter: (params) =>
          new Date(params.value * 1000).toLocaleString(),
      },
      { headerName: "Price", field: "price", filter: "agNumberColumnFilter" },
      {
        headerName: "Z-Score",
        field: "z_score",
        filter: "agNumberColumnFilter",
      },
      {
        headerName: "Volatility",
        field: "volatility",
        filter: "agNumberColumnFilter",
      },
      { headerName: "Volume", field: "volume", filter: "agNumberColumnFilter" },
    ],
    []
  );

  const defaultColDef = useMemo(
    () => ({
      sortable: true,
      filter: true,
      resizable: true,
      flex: 1,
      minWidth: 120,
    }),
    []
  );

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const response = await axios.get(
        `${API_BASE}/api/stats-timeseries/btcusdt?timeframe=1m&limit=100`
      );
      setStatsRows(response.data?.stats ?? []);
    } catch (error) {
      console.error("Failed to load stats table", error);
      setStatsRows([]);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const exportCsv = () => {
    if (gridRef.current) {
      gridRef.current.api.exportDataAsCsv();
    }
  };

  const handleAlertChange = (event) => {
    const { name, value } = event.target;
    setAlertForm((prev) => ({
      ...prev,
      [name]: name === "value" ? Number(value) : value,
    }));
  };

  const fetchAlerts = useCallback(async () => {
    try {
      const symbol = selectedSymbol.toLowerCase();
      const response = await axios.get(`${API_BASE}/api/alerts/${symbol}`);
      setAlerts(response.data?.alerts ?? []);
    } catch (error) {
      console.error("Failed to fetch alerts", error);
      setAlerts([]);
    }
  }, [selectedSymbol]);

  const fetchTriggeredAlerts = useCallback(async () => {
    try {
      const symbol = selectedSymbol.toLowerCase();
      console.log("Fetching triggers for:", symbol);
      const response = await axios.get(
        `${API_BASE}/api/alert-triggers/${symbol}?limit=50`
      );
      console.log("Triggers response:", response.data);
      // Backend returns array directly, not wrapped in object
      setTriggeredAlerts(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error("Failed to fetch triggered alerts", error);
      setTriggeredAlerts([]);
    }
  }, [selectedSymbol]);

  // Auto-fetch alerts and triggers when symbol changes
  useEffect(() => {
    fetchAlerts();
    fetchTriggeredAlerts();
  }, [fetchAlerts, fetchTriggeredAlerts]);

  // Refresh triggers every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchTriggeredAlerts();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchTriggeredAlerts]);

  const createAlert = async () => {
    const loadingToast = toast.loading("Creating alert...");
    try {
      await axios.post(`${API_BASE}/api/alerts`, {
        ...alertForm,
        symbol: alertForm.symbol.toLowerCase(),
      });
      toast.success("Alert created successfully!", { id: loadingToast });
      fetchAlerts();
    } catch (error) {
      console.error("Alert creation failed", error);
      toast.error("Failed to create alert", { id: loadingToast });
    }
  };

  const deleteAlert = async (alertId) => {
    const loadingToast = toast.loading("Deleting alert...");
    try {
      await axios.delete(`${API_BASE}/api/alerts/${alertId}`);
      toast.success("Alert deleted successfully!", { id: loadingToast });
      fetchAlerts();
    } catch (error) {
      console.error("Alert deletion failed", error);
      toast.error("Failed to delete alert", { id: loadingToast });
    }
  };

  const handleFileChange = (event) => {
    setSelectedFile(event.target.files?.[0] ?? null);
  };

  const uploadFile = async () => {
    if (!selectedFile) {
      toast.error("Please select a CSV file first");
      return;
    }
    const formData = new FormData();
    formData.append("file", selectedFile);
    const loadingToast = toast.loading("Uploading file...");
    try {
      await axios.post(`${API_BASE}/api/upload-ohlc`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("File uploaded successfully!", { id: loadingToast });
      setSelectedFile(null);
    } catch (error) {
      console.error("Upload failed", error);
      toast.error("Upload failed, verify the CSV format", { id: loadingToast });
    }
  };

  const exportSymbolData = async (symbol, timeframe = "1m", limit = 500) => {
    const loadingToast = toast.loading(
      `Exporting ${symbol.toUpperCase()} data...`
    );
    try {
      const response = await axios.get(
        `${API_BASE}/api/stats-timeseries/${symbol}?timeframe=${timeframe}&limit=${limit}&window=20`
      );
      const stats = response.data?.stats || [];

      if (stats.length === 0) {
        toast.error("No data available to export", { id: loadingToast });
        return;
      }

      // Convert to CSV format
      const headers = [
        "timestamp",
        "datetime",
        "price",
        "z_score",
        "volatility",
        "volume",
        "macd",
      ];
      const csvRows = [headers.join(",")];

      stats.forEach((row) => {
        const values = [
          row.timestamp,
          new Date(row.timestamp * 1000).toISOString(),
          row.price,
          row.z_score,
          row.volatility,
          row.volume,
          row.macd || "",
        ];
        csvRows.push(values.join(","));
      });

      const csvContent = csvRows.join("\n");
      const blob = new Blob([csvContent], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${symbol}_${timeframe}_${
        new Date().toISOString().split("T")[0]
      }.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(`Exported ${stats.length} records!`, { id: loadingToast });
    } catch (error) {
      console.error("Export failed", error);
      toast.error("Failed to export data", { id: loadingToast });
    }
  };

  const exportAllSymbols = async () => {
    const loadingToast = toast.loading("Exporting all symbols...");
    try {
      for (const symbol of SYMBOLS) {
        await exportSymbolData(symbol, "1m", 500);
        // Small delay between exports
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      toast.success("All symbols exported!", { id: loadingToast });
    } catch (error) {
      console.error("Bulk export failed", error);
      toast.error("Failed to export all symbols", { id: loadingToast });
    }
  };

  return (
    <section className="page">
      <header className="page__header">
        <h1>Data & Alerts</h1>
        <p className="page__subtitle">
          Monitor triggered alerts, configure alert rules, and manage datasets.
        </p>
      </header>

      {/* Export Data Section */}
      <section className="panel">
        <h2>Export Market Data</h2>
        <p style={{ color: "#94a3b8", marginBottom: "1rem" }}>
          Export historical price data and analytics in CSV format for offline
          analysis.
        </p>
        <div
          style={{
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {SYMBOLS.map((symbol) => (
            <button
              key={`export-${symbol}`}
              onClick={() => exportSymbolData(symbol, "1m", 500)}
              style={{
                padding: "0.75rem 1.5rem",
                background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: "600",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <span>📊</span>
              <span>Export {symbol.toUpperCase()}</span>
            </button>
          ))}
          <button
            onClick={exportAllSymbols}
            style={{
              padding: "0.75rem 1.5rem",
              background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: "600",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <span>📦</span>
            <span>Export All Symbols</span>
          </button>
        </div>
        <p
          style={{
            color: "#64748b",
            fontSize: "0.875rem",
            marginTop: "0.75rem",
          }}
        >
          💡 Exports last 500 data points at 1-minute timeframe with price,
          z-score, volatility, volume, and MACD.
        </p>
      </section>

      {/* Triggered Alerts */}
      <section className="panel">
        <div
          className="panel__header"
          style={{ flexWrap: "wrap", gap: "1rem" }}
        >
          <h2>Recent Triggered Alerts</h2>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span style={{ color: "#94a3b8", fontSize: "0.875rem" }}>
              Symbol:
            </span>
            {SYMBOLS.map((symbol) => (
              <button
                key={symbol}
                onClick={() => setSelectedSymbol(symbol)}
                style={{
                  padding: "0.5rem 1rem",
                  background: selectedSymbol === symbol ? "#38bdf8" : "#1e293b",
                  color: selectedSymbol === symbol ? "#0f172a" : "#e2e8f0",
                  border: `2px solid ${
                    selectedSymbol === symbol ? "#38bdf8" : "#334155"
                  }`,
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "600",
                  fontSize: "0.875rem",
                  transition: "all 0.2s",
                }}
              >
                {symbol.toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              onClick={fetchTriggeredAlerts}
              style={{ marginLeft: "0.5rem" }}
            >
              Refresh
            </button>
          </div>
        </div>
        {triggeredAlerts.length > 0 ? (
          <div style={{ maxHeight: "400px", overflowY: "auto" }}>
            {triggeredAlerts.map((trigger, index) => {
              const analytics = trigger.analytics || {};
              const triggeredAt = new Date(trigger.triggered_at);
              const isRecent = Date.now() - triggeredAt.getTime() < 60000; // Last minute

              return (
                <div
                  key={index}
                  style={{
                    background: isRecent ? "#1e293b" : "#0f172a",
                    border: `1px solid ${isRecent ? "#ef4444" : "#334155"}`,
                    borderRadius: "8px",
                    padding: "1rem",
                    marginBottom: "0.75rem",
                    animation: isRecent ? "pulse 2s ease-in-out" : "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "0.5rem",
                    }}
                  >
                    <div>
                      <span
                        style={{
                          background: isRecent ? "#ef4444" : "#f59e0b",
                          color: "#fff",
                          padding: "0.25rem 0.75rem",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                          fontWeight: "600",
                          marginRight: "0.5rem",
                        }}
                      >
                        TRIGGERED
                      </span>
                      <span style={{ color: "#94a3b8", fontSize: "0.875rem" }}>
                        {triggeredAt.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(150px, 1fr))",
                      gap: "0.75rem",
                      marginTop: "0.75rem",
                    }}
                  >
                    <div>
                      <div style={{ color: "#64748b", fontSize: "0.75rem" }}>
                        Price
                      </div>
                      <div style={{ color: "#e2e8f0", fontWeight: "600" }}>
                        ${analytics.price?.toFixed(2) || "N/A"}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontSize: "0.75rem" }}>
                        Z-Score
                      </div>
                      <div
                        style={{
                          color:
                            Math.abs(analytics.z_score || 0) > 2
                              ? "#ef4444"
                              : "#f59e0b",
                          fontWeight: "600",
                        }}
                      >
                        {analytics.z_score?.toFixed(3) || "N/A"}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontSize: "0.75rem" }}>
                        Volatility
                      </div>
                      <div style={{ color: "#e2e8f0", fontWeight: "600" }}>
                        {analytics.volatility?.toFixed(4) || "N/A"}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontSize: "0.75rem" }}>
                        Timeframe
                      </div>
                      <div style={{ color: "#e2e8f0", fontWeight: "600" }}>
                        {analytics.timeframe?.toUpperCase() || "N/A"}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p style={{ color: "#64748b", textAlign: "center", padding: "2rem" }}>
            No triggered alerts found for {selectedSymbol.toUpperCase()}
          </p>
        )}
      </section>

      {/* Create Alert */}
      <section className="panel">
        <h2>Create New Alert Rule</h2>
        <form
          className="form form--inline"
          onSubmit={(event) => event.preventDefault()}
          style={{ gap: "1rem" }}
        >
          <select
            name="symbol"
            value={alertForm.symbol}
            onChange={handleAlertChange}
            style={{
              padding: "0.75rem",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "4px",
              color: "#e2e8f0",
            }}
          >
            {SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s.toUpperCase()}
              </option>
            ))}
          </select>
          <select
            name="condition"
            value={alertForm.condition}
            onChange={handleAlertChange}
            style={{
              padding: "0.75rem",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "4px",
              color: "#e2e8f0",
            }}
          >
            <option value="z_score >">Z-Score &gt;</option>
            <option value="z_score <">Z-Score &lt;</option>
            <option value="price >">Price &gt;</option>
            <option value="price <">Price &lt;</option>
          </select>
          <input
            type="number"
            name="value"
            step="0.1"
            value={alertForm.value}
            onChange={handleAlertChange}
            placeholder="Value"
            style={{
              padding: "0.75rem",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "4px",
              color: "#e2e8f0",
            }}
          />
          <button
            type="button"
            onClick={createAlert}
            style={{
              background: "#10b981",
              color: "#fff",
              border: "none",
              padding: "0.75rem 1.5rem",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "600",
            }}
          >
            Create Alert
          </button>
        </form>
      </section>

      {/* Active Alert Rules */}
      <section className="panel">
        <div
          className="panel__header"
          style={{ flexWrap: "wrap", gap: "1rem" }}
        >
          <h2>Active Alert Rules</h2>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span style={{ color: "#94a3b8", fontSize: "0.875rem" }}>
              Symbol:
            </span>
            {SYMBOLS.map((symbol) => (
              <button
                key={`alert-${symbol}`}
                onClick={() => setSelectedSymbol(symbol)}
                style={{
                  padding: "0.5rem 1rem",
                  background: selectedSymbol === symbol ? "#38bdf8" : "#1e293b",
                  color: selectedSymbol === symbol ? "#0f172a" : "#e2e8f0",
                  border: `2px solid ${
                    selectedSymbol === symbol ? "#38bdf8" : "#334155"
                  }`,
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "600",
                  fontSize: "0.875rem",
                  transition: "all 0.2s",
                }}
              >
                {symbol.toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              onClick={fetchAlerts}
              style={{ marginLeft: "0.5rem" }}
            >
              Refresh
            </button>
          </div>
        </div>
        {alerts.length > 0 ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: "1rem",
            }}
          >
            {alerts.map((alert, index) => (
              <div
                key={`${alert.symbol}-${index}`}
                style={{
                  background:
                    "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
                  border: "1px solid #334155",
                  borderRadius: "8px",
                  padding: "1rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.75rem",
                  }}
                >
                  <span
                    style={{
                      background: "#10b981",
                      color: "#fff",
                      padding: "0.25rem 0.5rem",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                      fontWeight: "600",
                    }}
                  >
                    ACTIVE
                  </span>
                  <button
                    onClick={() => deleteAlert(alert.id)}
                    style={{
                      background: "#ef4444",
                      color: "#fff",
                      border: "none",
                      padding: "0.25rem 0.75rem",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                    }}
                  >
                    Delete
                  </button>
                </div>
                <div style={{ color: "#e2e8f0", marginBottom: "0.5rem" }}>
                  <strong>{alert.symbol?.toUpperCase()}</strong>
                </div>
                <div style={{ color: "#cbd5e1", fontSize: "0.875rem" }}>
                  {alert.condition} {alert.value}
                </div>
                {alert.ttl && (
                  <div
                    style={{
                      color: "#64748b",
                      fontSize: "0.75rem",
                      marginTop: "0.5rem",
                    }}
                  >
                    Expires in: {Math.floor(alert.ttl / 3600)}h{" "}
                    {Math.floor((alert.ttl % 3600) / 60)}m
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: "#64748b", textAlign: "center", padding: "2rem" }}>
            No active alert rules for {selectedSymbol.toUpperCase()}
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Upload Historical Data (OHLC)</h2>
        <p style={{ color: "#94a3b8", marginBottom: "1rem" }}>
          Upload historical candlestick data in CSV format to use with the{" "}
          <a
            href="/backtest"
            style={{ color: "#38bdf8", textDecoration: "underline" }}
          >
            Backtester
          </a>
          . CSV should contain: timestamp, open, high, low, close, volume
          columns.
        </p>
        <div className="form form--inline">
          <input type="file" accept=".csv" onChange={handleFileChange} />
          <button type="button" onClick={uploadFile}>
            Upload
          </button>
        </div>
        {uploadStatus ? <p className="panel__status">{uploadStatus}</p> : null}
        <p
          style={{
            color: "#64748b",
            fontSize: "0.875rem",
            marginTop: "0.75rem",
          }}
        >
          💡 Uploaded data will be stored and can be used for backtesting
          mean-reversion strategies.
        </p>
      </section>
    </section>
  );
};

export default DataAlerts;
