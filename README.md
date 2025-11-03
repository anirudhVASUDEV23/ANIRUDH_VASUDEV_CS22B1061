# Market Intelligence Platform

A full-stack experimental market intelligence playground that ingests real-time Binance trades, stores canonical candles in Redis, computes quantitative analytics continuously, and streams everything to a React/Vite interface for exploration, alerting, and backtesting.

# Demo Videos

## Website Demo

[Watch Video](https://drive.google.com/file/d/1YKo4yxv-2dmmjl1cgO7M4IAdG_TRnnyL/view)

## Redis DB Demo

[Watch Video](https://drive.google.com/file/d/1H2a1RyMVS5ErGETshxxst5inZOpQMIJz/view?usp=sharing)

## ADVNCED FEATURES DEMO

[Watch Video](https://drive.google.com/file/d/1A0LmDHCBv2AZExIFw_w7NmRK58pMdi0w/view?usp=sharing)

## Architecture

![System architecture](docs/architecture.svg)

_Edit the architecture source in `docs/architecture.drawio`; export updates to `docs/architecture.svg` before committing._

### Data & Control Flow

- **Ingestion service** streams Binance ticks and resamples them into canonical 1s/1m/5m candles kept in Redis lists.
- **Analytics worker** converts the latest candles into z-scores, volatility, mean reversion flags, MACD, and alert triggers; results are cached in Redis and published over pub/sub.
- **FastAPI backend** exposes REST endpoints plus a WebSocket channel that fans out live candle and analytics updates.
- **React frontend** renders dashboards (Live, Analytics Lab, Alerts, Backtester) and listens for push updates to avoid polling.

## Features

- High-frequency ingestion (1s granularity) with auto-resampling to longer intervals.
- Rolling analytics (z-score, volatility, ADF stationarity, MACD) with Redis caching.
- **Pairs Trading Analytics**: Hedge ratio via OLS, robust regression (Theil-Sen), rolling correlation, and cointegration testing.
- Alert engine that stores rules in Redis and broadcasts trigger events to the UI.
- React dashboards for live charting (Plotly), analytics exploration, pairs trading, custom alerts, and simple backtests.

## Quick Start

### Prerequisites

- **Python** 3.10+ (SciPy/StatsModels compatibility)
- **Redis** 7.x reachable at `redis://localhost:6379`
- **Git** (optional, for cloning)

### Start Redis

Choose one of the following options:

```powershell
# Option A: Docker (recommended for Windows/macOS/Linux)
docker run --name gem-redis -p 6379:6379 redis/redis-stack-server:7.2.0

# Option B: Local installation (Windows example)
# After installing Redis from https://redis.io/docs/install/
redis-server --port 6379
```

### Backend Setup & Single-Command Run

```powershell
cd c:\Users\Anirudh\Downloads\gem
python -m venv .venv
.\.venv\Scripts\activate
pip install --upgrade pip
pip install fastapi uvicorn[standard] redis websockets pandas numpy scipy scikit-learn statsmodels python-dotenv
python backend\run.py
```

`backend/run.py` spins up the Binance ingestion loop, analytics worker, and FastAPI server in one process. Default bind is `http://localhost:8000` with WebSocket at `/ws/data`.

Environment overrides live in `backend/config.py`. Create `backend/.env` (copy `backend/.env.example`) if you want to override `REDIS_URL`, `API_HOST`, or `API_PORT`.

### Frontend Setup

Open a second terminal:

```powershell
cd c:\Users\Anirudh\Downloads\gem\frontend
npm install
npm run dev -- --host
```

The Vite dev server defaults to `http://localhost:5173`. It proxies API calls directly to the backend host configured in the React code (`src/context/SocketContext.jsx`).

### Useful Commands

- `python backend\test_ws.py` &mdash; lightweight sanity check for the WebSocket broadcast channel.
- `npm run lint` inside `frontend/` &mdash; enforce ESLint rules for React components.

## Key Endpoints

- `GET /api/symbols` &mdash; supported trading pairs.
- `GET /api/price/{symbol}?timeframe=1s&limit=1000` &mdash; historical candles.
- `GET /api/analytics/{symbol}` &mdash; latest analytics snapshot.
- `GET /api/correlation?symbols=btcusdt,ethusdt` &mdash; cross-symbol correlation matrix.
- `GET /api/pairs-analytics?symbol1=btcusdt&symbol2=ethusdt` &mdash; hedge ratio, correlation, spread z-score, and cointegration test.
- `GET /api/rolling-correlation?symbol1=btcusdt&symbol2=ethusdt` &mdash; time series of rolling correlation.
- `GET /api/robust-regression?symbol1=btcusdt&symbol2=ethusdt` &mdash; OLS vs Theil-Sen robust regression comparison.
- `POST /api/alerts` &mdash; create alert rules (stored with 7-day TTL).
- `GET /api/alert-triggers/{symbol}` &mdash; retrieve triggered alerts for UI toasts.
- WebSocket `/ws/data` &mdash; push stream for candles and analytics updates.

## Analytics Methodology

- **Resampling**: Binance tick data is aggregated into 1-second buckets, then rolled up to 1-min and 5-min candles.
- **Z-Score**: Standard score over the latest N closes (default `window=20`).
- **Volatility**: Rolling standard deviation of returns.
- **ADF Test**: Augmented Dickey-Fuller test (statsmodels) for mean reversion detection.
- **MACD**: Standard 12/26 EMA with 9-period signal line.
- **Hedge Ratio**: OLS regression coefficient between two price series (for pairs trading).
- **Robust Regression**: Theil-Sen median-based estimator resistant to outliers, with confidence intervals.
- **Rolling Correlation**: Time-windowed Pearson correlation for tracking relationship dynamics.
- **Cointegration**: ADF test on the spread to verify mean-reverting behavior in pairs.
- **Alerts**: Rules stored in Redis evaluate z-score or price thresholds and push triggers via pub/sub.

## Design Considerations

**Trade-offs**

- Single Redis instance keeps architecture simple but centralizes state; higher throughput or HA scenarios would need Redis Cluster or alternate storage.
- `backend/run.py` launches ingestion, analytics, and API in one process for easy demos, sacrificing process isolation and independent scaling.
- Plotly delivers rich interactive charts with minimal wiring, at the cost of larger bundle size compared to lighter-weight charting libraries.
- Running analytics continuously reduces latency for the UI, while increasing Redis write load and CPU usage for the worker loop.

**Extensibility**

- Symbol universe, resample intervals, and analytic windows live in `backend/config.py` or the analytics engine, making it straightforward to add new timeframes or instruments.
- The React pages use modular contexts and cards/components, enabling additional dashboards without reworking the data plumbing.
- Alerts are persisted as JSON objects in Redis, so new condition types can be introduced by extending `AnalyticsWorker.should_trigger_alert` and the frontend form schema.
- FastAPI routers and background tasks can be split into dedicated modules if the service grows; current structure keeps concerns isolated for future expansion.

**Redundancies & Resilience**

- Redis pub/sub broadcasts are fire-and-forget; reconnect logic on both ingestion and frontend sides is essential to recover from transient network issues.
- Binance WebSocket reconnects on failure with a backoff loop, but there is no secondary market data source; production deployments should include a fallback exchange or cached candles.
- Alert triggers are kept in Redis lists with capped length to avoid unbounded growth; consider periodic archiving to cold storage for long-term auditability.
- Since all services currently share one host, containerization or orchestration (Docker Compose, Kubernetes) would provide better fault isolation and restart management.

**Logging & Observability**

- Python services use the standard `logging` module (configured in `backend/main.py`, `data_ingestion.py`, and `worker.py`) with INFO-level defaults for operational visibility.
- Explicit log statements mark WebSocket lifecycle events, Redis connectivity, candle creation, and analytics computations to aid troubleshooting.
- Extend logging via environment-controlled log levels (`LOG_LEVEL` in `config.py`) and consider structured log sinks (JSON, OpenTelemetry) when moving beyond local development.
- Frontend relies on toast notifications and browser devtools today; adding network status indicators and centralized error boundaries would improve runtime diagnostics.

## Folder Layout

- `backend/` &mdash; FastAPI app, ingestion loop, analytics worker, configuration.
- `frontend/` &mdash; React/Vite interface with Plotly charts and real-time widgets.
- `docs/architecture.drawio` &mdash; editable diagram source.
- `docs/architecture.svg` &mdash; exported static diagram embedded above.

## AI Usage Disclosure

ChatGPT (GitHub Copilot Coding Agent) assisted with documentation wording and diagram scaffolding. All output was reviewed and integrated manually before inclusion.

## Next Steps

- Enable authentication for production deployments.
- Package backend into Docker Compose with Redis to simplify onboarding.
- Add unit tests around analytics engine functions and alert evaluation edge cases.
