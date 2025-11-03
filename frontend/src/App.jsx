import { Routes, Route } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import NavBar from "./components/NavBar.jsx";
import LiveDashboard from "./pages/LiveDashboard.jsx";
import AnalyticsLab from "./pages/AnalyticsLab.jsx";
import Backtester from "./pages/Backtester.jsx";
import DataAlerts from "./pages/DataAlerts.jsx";
import "./App.css";

const App = () => {
  return (
    <div className="app-shell">
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: "#1e293b",
            color: "#e2e8f0",
            border: "1px solid #334155",
          },
          success: {
            iconTheme: {
              primary: "#10b981",
              secondary: "#fff",
            },
          },
          error: {
            iconTheme: {
              primary: "#ef4444",
              secondary: "#fff",
            },
          },
        }}
      />
      <NavBar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<LiveDashboard />} />
          <Route path="/analytics" element={<AnalyticsLab />} />
          <Route path="/backtest" element={<Backtester />} />
          <Route path="/data" element={<DataAlerts />} />
          <Route path="*" element={<LiveDashboard />} />
        </Routes>
      </main>
    </div>
  );
};

export default App;
