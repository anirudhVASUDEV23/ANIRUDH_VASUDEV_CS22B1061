from fastapi import FastAPI, WebSocket, HTTPException, UploadFile, File, Query, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager, suppress
import asyncio
import json
import redis.asyncio as aioredis
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set
import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
from scipy import stats
from statsmodels.tsa.stattools import adfuller
from analytics import AnalyticsEngine

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Redis client
redis_client = None
redis_pubsub = None
broadcast_task = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client, broadcast_task
    redis_client = await aioredis.from_url("redis://localhost:6379")
    logger.info("Redis connected")
    broadcast_task = asyncio.create_task(redis_listener())

    try:
        yield
    finally:
        if broadcast_task:
            broadcast_task.cancel()
            with suppress(asyncio.CancelledError):
                await broadcast_task
            broadcast_task = None

        if redis_client:
            await redis_client.close()
            redis_client = None

app = FastAPI(lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket clients
active_connections: Set[WebSocket] = set()

async def broadcast_message(message: str) -> None:
    if not active_connections:
        return

    stale_connections = []
    for connection in list(active_connections):
        try:
            await connection.send_text(message)
        except Exception as exc:  # noqa: BLE001 - log and drop stale sockets
            logger.warning(f"WebSocket broadcast failed: {exc}")
            stale_connections.append(connection)

    for connection in stale_connections:
        active_connections.discard(connection)

async def redis_listener() -> None:
    global redis_pubsub
    redis_pubsub = redis_client.pubsub()
    await redis_pubsub.subscribe("candle_updates", "analytics_updates", "live_analytics")

    try:
        while True:
            message = await redis_pubsub.get_message(
                ignore_subscribe_messages=True,
                timeout=1.0
            )

            if message:
                data = message.get("data")
                if isinstance(data, bytes):
                    data = data.decode()
                if data:
                    await broadcast_message(data)

            await asyncio.sleep(0.01)
    except asyncio.CancelledError:  # graceful shutdown
        pass
    finally:
        if redis_pubsub:
            await redis_pubsub.close()
            redis_pubsub = None

@app.get("/test-ws")
async def test_ws():
    """Test endpoint to confirm server is running"""
    return {"websocket_endpoint": "/ws/data", "status": "server is running"}

@app.websocket("/ws/data")
async def websocket_endpoint(websocket: WebSocket):
    try:
        logger.info("🔌 WebSocket: Before accept")
        await websocket.accept()
        logger.info("✅ WebSocket: Accepted successfully")
        
        active_connections.add(websocket)
        
        # Send initial message
        await websocket.send_text(json.dumps({
            "type": "connection",
            "status": "connected"
        }))
        
        # Keep connection alive
        while True:
            await asyncio.sleep(1)
            
    except Exception as e:
        logger.exception(f"❌ WebSocket error: {e}")
    finally:
        active_connections.discard(websocket)

@app.get("/api/symbols")
async def get_symbols():
    """Get available trading symbols"""
    try:
        symbols_json = await redis_client.get("symbols_list")
        if symbols_json:
            return {"symbols": json.loads(symbols_json)}
        return {"symbols": ["BTCUSDT", "ETHUSDT", "BNBUSDT"]}
    except Exception as e:
        logger.error(f"Error fetching symbols: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/price/{symbol}")
async def get_price(
    symbol: str,
    timeframe: str = "1m",
    limit: int = Query(100, le=5000)
):
    """Get price data for a symbol with limit control"""
    try:
        key = f"candles:{symbol.lower()}:{timeframe}"
        candles_data = await redis_client.lrange(key, 0, limit - 1)
        
        if not candles_data:
            return {"prices": [], "timestamps": [], "candles": []}
        
        candles = [json.loads(c) for c in candles_data]
        candles.reverse()
        
        prices = [c["close"] for c in candles]
        timestamps = [c["timestamp"] for c in candles]
        
        return {
            "prices": prices,
            "timestamps": timestamps,
            "candles": candles,
            "count": len(candles)
        }
    except Exception as e:
        logger.error(f"Error fetching price: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/analytics/{symbol}")
async def get_analytics(
    symbol: str,
    timeframe: str = "1m",
    window: int = Query(20, ge=5, le=200)
):
    """Get comprehensive analytics for a symbol"""
    try:
        key = f"analytics:{symbol.lower()}:{timeframe}"
        data = await redis_client.get(key)
        
        if data:
            analytics = json.loads(data)
        else:
            # Compute on-demand if not cached
            candles_key = f"candles:{symbol.lower()}:{timeframe}"
            candles_data = await redis_client.lrange(candles_key, 0, window - 1)
            
            if not candles_data:
                return {
                    "z_score": 0,
                    "spread": 0,
                    "volatility": 0,
                    "adf_pvalue": None,
                    "correlation": {},
                    "hedge_ratio": 0,
                    "liquidity_score": 0,
                    "macd": {"macd": 0, "signal": 0, "histogram": 0}
                }
            
            candles = [json.loads(c) for c in candles_data]
            prices = np.array([c["close"] for c in candles])
            volumes = np.array([c["volume"] for c in candles])
            
            engine = AnalyticsEngine()
            z_score = engine.calculate_z_score(prices, window)
            volatility = engine.calculate_volatility(prices, window)
            adf_result = engine.adf_test(prices[-window:])
            liquidity = engine.calculate_liquidity_score(volumes, window)
            macd = engine.calculate_macd(prices)
            
            analytics = {
                "z_score": float(z_score),
                "volatility": float(volatility),
                "adf_pvalue": adf_result["p_value"],
                "is_stationary": adf_result["is_stationary"],
                "liquidity_score": float(liquidity),
                "macd": macd
            }
        
        return analytics
    except Exception as e:
        logger.error(f"Error fetching analytics: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/correlation")
async def get_correlation(
    symbols: str = Query("BTCUSDT,ETHUSDT"),
    timeframe: str = "1m",
    limit: int = Query(100, le=1000)
):
    """Get correlation between multiple symbols"""
    try:
        symbol_list = [s.strip().lower() for s in symbols.split(",")]
        price_series = {}
        
        for symbol in symbol_list:
            key = f"candles:{symbol}:{timeframe}"
            candles_data = await redis_client.lrange(key, 0, limit - 1)
            
            if candles_data:
                candles = [json.loads(c) for c in candles_data]
                prices = np.array([c["close"] for c in candles])
                price_series[symbol] = prices
        
        engine = AnalyticsEngine()
        corr_matrix = engine.calculate_correlation_matrix(price_series)
        
        return {"correlation": corr_matrix}
    except Exception as e:
        logger.error(f"Error calculating correlation: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stats-timeseries/{symbol}")
async def get_stats_timeseries(
    symbol: str,
    timeframe: str = "1m",
    limit: int = Query(50, le=500),
    window: int = Query(20, ge=5, le=200)
):
    """Get rolling analytics snapshots over time"""
    try:
        key = f"candles:{symbol.lower()}:{timeframe}"
        candles_data = await redis_client.lrange(key, 0, limit - 1)
        
        if not candles_data:
            return {"stats": []}
        
        candles = [json.loads(c) for c in candles_data]
        candles.reverse()
        
        engine = AnalyticsEngine()
        stats = []
        
        for i, candle in enumerate(candles):
            prices = np.array([c["close"] for c in candles[:i+1]])
            volumes = np.array([c["volume"] for c in candles[:i+1]])

            if len(prices) < window:
                continue

            z_score = engine.calculate_z_score(prices, window)
            volatility = engine.calculate_volatility(prices, window)
            macd = engine.calculate_macd(prices)
            
            stats.append({
                "timestamp": candle["timestamp"],
                "price": candle["close"],
                "z_score": float(z_score),
                "volatility": float(volatility),
                "volume": candle["volume"],
                "macd": macd
            })
        
        return {"stats": stats}
    except Exception as e:
        logger.error(f"Error fetching stats timeseries: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/alerts")
async def create_alert(alert: Dict):
    """Create a custom alert"""
    try:
        alert_id = f"alert:{datetime.now().timestamp()}"
        # Ensure symbol is lowercase
        if "symbol" in alert:
            alert["symbol"] = alert["symbol"].lower()
        await redis_client.setex(alert_id, 86400 * 7, json.dumps(alert))
        logger.info(f"Created alert {alert_id}: {alert}")
        return {"alert_id": alert_id, "status": "created"}
    except Exception as e:
        logger.error(f"Error creating alert: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/alerts/{symbol}")
async def get_alerts(symbol: str):
    """Get alerts for a symbol"""
    try:
        alerts = []
        async for key in redis_client.scan_iter("alert:*"):
            alert_data = await redis_client.get(key)
            if alert_data:
                alert = json.loads(alert_data)
                if alert.get("symbol") == symbol:
                    ttl = await redis_client.ttl(key)
                    alert["ttl"] = ttl
                    alert["id"] = key
                    alerts.append(alert)
        return {"alerts": alerts}
    except Exception as e:
        logger.error(f"Error fetching alerts: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/alert-triggers/{symbol}")
async def get_alert_triggers(symbol: str, limit: int = 50):
    """Get triggered alerts for a symbol"""
    try:
        # Normalize symbol to lowercase
        symbol_lower = symbol.lower()
        triggers_key = f"alert_triggers:{symbol_lower}"
        
        print(f"[DEBUG] Fetching triggers for key: {triggers_key}")
        triggers_data = await redis_client.lrange(triggers_key, 0, limit - 1)
        print(f"[DEBUG] Found {len(triggers_data)} triggers in Redis")
        
        triggers = []
        for trigger_json in triggers_data:
            try:
                triggers.append(json.loads(trigger_json))
            except json.JSONDecodeError as je:
                print(f"[DEBUG] JSON decode error: {je}")
                continue
        
        print(f"[DEBUG] Returning {len(triggers)} parsed triggers")
        return triggers
    except Exception as e:
        print(f"[DEBUG] Error in get_alert_triggers: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/alerts/{alert_id}")
async def delete_alert(alert_id: str):
    """Delete an alert and all its triggered alerts"""
    try:
        # First, get the alert to find its symbol
        alert_data = await redis_client.get(alert_id)
        
        # Delete the alert rule
        deleted = await redis_client.delete(alert_id)
        
        # If alert existed, clean up triggered alerts
        if alert_data:
            alert = json.loads(alert_data)
            symbol = alert.get("symbol", "").lower()
            
            if symbol:
                # Get all triggered alerts for this symbol
                triggers_key = f"alert_triggers:{symbol}"
                triggers_data = await redis_client.lrange(triggers_key, 0, -1)
                
                # Filter out triggers that match this alert_id
                remaining_triggers = []
                for trigger_json in triggers_data:
                    try:
                        trigger = json.loads(trigger_json)
                        if trigger.get("alert_id") != alert_id:
                            remaining_triggers.append(trigger_json)
                    except json.JSONDecodeError:
                        continue
                
                # Replace the list with filtered triggers
                await redis_client.delete(triggers_key)
                if remaining_triggers:
                    await redis_client.rpush(triggers_key, *remaining_triggers)
                
                logger.info(f"Deleted alert {alert_id} and cleaned up {len(triggers_data) - len(remaining_triggers)} triggered alerts")
        
        return {"deleted": bool(deleted), "alert_id": alert_id}
    except Exception as e:
        logger.error(f"Error deleting alert: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/upload-ohlc")
async def upload_ohlc(file: UploadFile = File(...)):
    """Upload OHLC data"""
    try:
        contents = await file.read()
        df = pd.read_csv(pd.io.common.StringIO(contents.decode("utf8")))
        
        # Store in Redis
        key = f"ohlc_data:{file.filename}"
        await redis_client.setex(
            key, 
            86400 * 30, 
            df.to_json()
        )
        return {"status": "uploaded", "rows": len(df)}
    except Exception as e:
        logger.error(f"Error uploading OHLC: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/export/{symbol}")
async def export_data(
    symbol: str,
    timeframe: str = "1m",
    include_analytics: bool = True
):
    """Export processed data with optional analytics as CSV"""
    try:
        key = f"candles:{symbol.lower()}:{timeframe}"
        candles_data = await redis_client.lrange(key, 0, -1)
        
        if not candles_data:
            return {"error": "No data found"}
        
        candles = [json.loads(c) for c in candles_data]
        df = pd.DataFrame(candles)
        
        if include_analytics:
            engine = AnalyticsEngine()
            prices = df["close"].values
            df["z_score"] = [engine.calculate_z_score(prices[:i+1], 20) for i in range(len(prices))]
            df["volatility"] = [engine.calculate_volatility(prices[:i+1], 20) for i in range(len(prices))]
        
        csv_data = df.to_csv(index=False)
        return {"csv": csv_data, "rows": len(df)}
    except Exception as e:
        logger.error(f"Error exporting data: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/backtest-signals/{symbol}")
async def get_backtest_signals(
    symbol: str,
    timeframe: str = "1m",
    z_threshold: float = Query(2.0, ge=0.5, le=5.0)
):
    """Get mean reversion backtest signals"""
    try:
        key = f"candles:{symbol.lower()}:{timeframe}"
        candles_data = await redis_client.lrange(key, 0, -1)
        
        if not candles_data:
            return {"signals": []}
        
        candles = [json.loads(c) for c in candles_data]
        candles.reverse()
        prices = np.array([c["close"] for c in candles])
        
        engine = AnalyticsEngine()
        signals = []
        
        for i in range(20, len(prices)):
            z_score = engine.calculate_z_score(prices[:i+1], 20)
            signal = engine.calculate_mean_reversion_signals(prices[:i+1], z_score)
            
            if signal["entry"] or signal["exit"]:
                signals.append({
                    "timestamp": candles[i]["timestamp"],
                    "price": candles[i]["close"],
                    "z_score": z_score,
                    "type": "entry" if signal["entry"] else "exit"
                })
        
        return {"signals": signals}
    except Exception as e:
        logger.error(f"Error fetching backtest signals: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}
