import asyncio
import json
import logging
import redis.asyncio as aioredis
from analytics import AnalyticsEngine
from datetime import datetime
import numpy as np

logger = logging.getLogger(__name__)

class AnalyticsWorker:
    def __init__(self, redis_url: str):
        self.redis_url = redis_url
        self.redis_client = None
        self.engine = AnalyticsEngine()
        
    async def connect(self):
        self.redis_client = await aioredis.from_url(self.redis_url)
        
    async def disconnect(self):
        if self.redis_client:
            await self.redis_client.close()
    
    async def process_analytics(self):
        """Continuously process analytics"""
        symbols = ["btcusdt", "ethusdt", "bnbusdt"]
        
        while True:
            try:
                for symbol in symbols:
                    await self.compute_analytics(symbol, "1s", 20)
                    await self.compute_analytics(symbol, "1m", 20)
                    await self.compute_analytics(symbol, "5m", 20)
                    
                await asyncio.sleep(0.5)  # Update every 500ms for live z-scores
            except Exception as e:
                logger.error(f"Analytics processing error: {e}")
                await asyncio.sleep(5)
    
    async def compute_analytics(self, symbol: str, timeframe: str, window: int):
        """Compute analytics for a symbol"""
        try:
            # Fetch candles
            key = f"candles:{symbol}:{timeframe}"
            candles_data = await self.redis_client.lrange(key, 0, window - 1)
            
            if not candles_data:
                return
            
            candles = [json.loads(c) for c in candles_data]
            candles.reverse()
            
            if len(candles) < window:
                return
            
            prices = np.array([c["close"] for c in candles])
            volumes = np.array([c["volume"] for c in candles])
            
            # Calculate metrics
            z_score = self.engine.calculate_z_score(prices, window)
            volatility = self.engine.calculate_volatility(prices, window)
            adf_result = self.engine.adf_test(prices[-window:])
            mean_reversion = self.engine.calculate_mean_reversion_signals(prices, z_score)
            
            # Calculate mean and std dev
            mean_price = float(np.mean(prices[-window:]))
            std_dev = float(np.std(prices[-window:]))
            
            analytics = {
                "timestamp": datetime.now().isoformat(),
                "symbol": symbol,
                "timeframe": timeframe,
                "price": float(prices[-1]),
                "z_score": float(z_score),
                "volatility": float(volatility),
                "mean_price": mean_price,
                "std_dev": std_dev,
                "adf_pvalue": adf_result["p_value"],
                "mean_reversion": mean_reversion,
                "candles_count": len(candles),
                "avg_volume": float(np.mean(volumes))
            }
            
            # Store analytics
            analytics_key = f"analytics:{symbol}:{timeframe}"
            await self.redis_client.setex(
                analytics_key,
                300,
                json.dumps(analytics)
            )

            await self.redis_client.publish(
                "analytics_updates",
                json.dumps({
                    "type": "analytics_update",
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "analytics": analytics
                })
            )

            await self.redis_client.publish(
                "live_analytics",
                json.dumps({
                    "type": "live_zscore",
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "z_score": analytics["z_score"],
                    "timestamp": analytics["timestamp"]
                })
            )
            
            # Check for alerts
            await self.check_alerts(symbol, analytics)
            
        except Exception as e:
            logger.error(f"Error computing analytics for {symbol}: {e}")
    
    async def check_alerts(self, symbol: str, analytics: dict):
        """Check if any alerts are triggered"""
        try:
            async for key in self.redis_client.scan_iter(f"alert:*"):
                alert_data = await self.redis_client.get(key)
                if alert_data:
                    alert = json.loads(alert_data)
                    # Add the alert ID from the Redis key (decode bytes to string)
                    alert["id"] = key.decode('utf-8') if isinstance(key, bytes) else key
                    if alert.get("symbol") == symbol:
                        triggered = self.should_trigger_alert(alert, analytics)
                        if triggered:
                            await self.store_alert_trigger(alert, analytics)
        except Exception as e:
            logger.error(f"Error checking alerts: {e}")
    
    @staticmethod
    def should_trigger_alert(alert: dict, analytics: dict) -> bool:
        """Check if alert conditions are met"""
        condition = alert.get("condition", "")
        value = alert.get("value", 0)
        
        if "z_score" in condition:
            if ">" in condition:
                return analytics["z_score"] > value
            elif "<" in condition:
                return analytics["z_score"] < value
        
        if "price" in condition:
            if ">" in condition:
                return analytics["price"] > value
            elif "<" in condition:
                return analytics["price"] < value
        
        return False
    
    async def store_alert_trigger(self, alert: dict, analytics: dict):
        """Store triggered alert"""
        trigger = {
            "alert_id": alert.get("id"),
            "triggered_at": datetime.now().isoformat(),
            "analytics": analytics
        }
        # Normalize symbol to lowercase
        symbol = alert.get('symbol', '').lower()
        await self.redis_client.lpush(
            f"alert_triggers:{symbol}",
            json.dumps(trigger)
        )

async def start_worker():
    """Start the analytics worker"""
    redis_url = "redis://localhost:6379"
    worker = AnalyticsWorker(redis_url)
    await worker.connect()
    await worker.process_analytics()
