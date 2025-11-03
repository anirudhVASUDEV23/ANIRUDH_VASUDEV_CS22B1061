import asyncio
import json
import logging
import redis.asyncio as aioredis
from datetime import datetime
import websockets
from redis.exceptions import ResponseError

logger = logging.getLogger(__name__)

class DataIngestionPipeline:
    def __init__(self, redis_url: str):
        self.redis_url = redis_url
        self.redis_client = None
        self.binance_ws_url = "wss://stream.binance.com:9443/ws"
        self.symbols = ["btcusdt@trade", "ethusdt@trade", "bnbusdt@trade"]
        
    async def connect_redis(self):
        self.redis_client = await aioredis.from_url(self.redis_url)
        logger.info("Redis connected for ingestion")
        
    async def disconnect_redis(self):
        if self.redis_client:
            await self.redis_client.close()
    
    async def ingest_binance_data(self):
        """Connect to Binance WebSocket and ingest tick data"""
        stream = "/".join(self.symbols)
        ws_url = f"{self.binance_ws_url}/{stream}"
        
        try:
            async with websockets.connect(ws_url) as websocket:
                logger.info(f"Connected to Binance: {ws_url}")
                while True:
                    message = await websocket.recv()
                    await self.process_tick(json.loads(message))
        except Exception as e:
            logger.error(f"Binance connection error: {e}")
            await asyncio.sleep(5)
            await self.ingest_binance_data()
    
    async def process_tick(self, tick_data: dict):
        """Process tick - only store to Redis Streams, don't buffer in memory"""
        try:
            symbol = tick_data.get("s", "").lower()
            price = float(tick_data.get("p", 0))
            quantity = float(tick_data.get("q", 0))
            timestamp = int(tick_data.get("T", 0)) / 1000
            
            tick = {
                "timestamp": timestamp,
                "price": price,
                "quantity": quantity,
                "symbol": symbol
            }
            
            # Store raw tick in Redis Stream (not list)
            stream_key = f"ticks:{symbol}"
            await self.redis_client.xadd(
                stream_key,
                {"data": json.dumps(tick)}
            )
            
            # Keep stream manageable with max length
            await self.redis_client.xtrim(stream_key, maxlen=10000)
            
        except Exception as e:
            logger.error(f"Error processing tick: {e}")
    
    async def resample_1s_candles(self):
        """New: Resample ticks into 1-second candles every second"""
        symbols = ["btcusdt", "ethusdt", "bnbusdt"]
        
        while True:
            try:
                for symbol in symbols:
                    await self._create_1s_candle(symbol)
                await asyncio.sleep(1)
            except Exception as e:
                logger.error(f"Error resampling 1s candles: {e}")
                await asyncio.sleep(1)
    
    async def _create_1s_candle(self, symbol: str):
        """Create a 1-second candle from ticks"""
        try:
            stream_key = f"ticks:{symbol}"
            last_id_key = f"last_tick_id:{symbol}"

            # Get all new ticks since last processing
            last_id = await self.redis_client.get(last_id_key)
            if isinstance(last_id, bytes):
                last_id = last_id.decode()

            min_id = "-" if not last_id else f"({last_id}"

            # Read new ticks from stream
            logger.debug("Fetching ticks for %s starting from %s", symbol, min_id)
            try:
                ticks_data = await self.redis_client.xrange(
                    stream_key,
                    min=min_id,
                    count=1000
                )
            except ResponseError as exc:
                message = str(exc).lower()
                if "invalid stream id" in message:
                    logger.warning(
                        "Stream ID %s for %s trimmed; resetting cursor",
                        last_id,
                        symbol
                    )
                    await self.redis_client.delete(last_id_key)
                    logger.debug("Retrying xrange for %s from stream head", symbol)
                    ticks_data = await self.redis_client.xrange(
                        stream_key,
                        min="-",
                        count=1000
                    )
                else:
                    logger.error(
                        "Unexpected Redis ResponseError while reading %s: %s",
                        symbol,
                        exc
                    )
                    raise
            
            if not ticks_data:
                logger.debug("No new ticks for %s", symbol)
                return
            
            # Parse ticks
            ticks = []
            for tick_id, tick_dict in ticks_data:
                try:
                    tick = json.loads(tick_dict.get(b"data", b"{}").decode())
                    ticks.append(tick)
                except Exception as parse_error:
                    logger.error(
                        "Failed to parse tick %s for %s: %s",
                        tick_id,
                        symbol,
                        parse_error
                    )
                    continue
            
            if not ticks:
                logger.debug("Ticks batch for %s empty after parsing", symbol)
                return
            
            # Update last processed ID
            last_id = ticks_data[-1][0]
            if isinstance(last_id, bytes):
                last_id = last_id.decode()
            await self.redis_client.set(last_id_key, last_id)
            logger.debug(
                "Processed %d ticks for %s; last_id=%s",
                len(ticks),
                symbol,
                last_id
            )
            
            # Create OHLC candle
            prices = [t["price"] for t in ticks]
            volumes = [t["quantity"] for t in ticks]
            
            current_time = datetime.fromtimestamp(ticks[-1]["timestamp"])
            bucket = int(current_time.timestamp())
            
            candle = {
                "timestamp": bucket,
                "open": prices[0],
                "high": max(prices),
                "low": min(prices),
                "close": prices[-1],
                "volume": sum(volumes)
            }
            
            # Store in Redis list
            key = f"candles:{symbol}:1s"
            await self.redis_client.lpush(key, json.dumps(candle))
            await self.redis_client.ltrim(key, 0, 4999)

            await self.redis_client.publish(
                "candle_updates",
                json.dumps({
                    "type": "candle_update",
                    "symbol": symbol,
                    "timeframe": "1s",
                    "candle": candle
                })
            )
            
        except Exception as e:
            logger.exception("Error creating 1s candle for %s", symbol)
    
    async def resample_1m_candles(self):
        """New: Resample 1s candles into 1m candles every minute"""
        symbols = ["btcusdt", "ethusdt", "bnbusdt"]
        
        while True:
            try:
                # Wait until next minute boundary
                now = datetime.now()
                seconds_until_next_minute = 60 - now.second
                await asyncio.sleep(seconds_until_next_minute)
                
                for symbol in symbols:
                    await self._create_1m_candle(symbol)
            except Exception as e:
                logger.error(f"Error resampling 1m candles: {e}")
                await asyncio.sleep(10)
    
    async def _create_1m_candle(self, symbol: str):
        """Create a 1-minute candle from last 60 1s candles"""
        try:
            # Get last 60 1-second candles
            key = f"candles:{symbol}:1s"
            candles_data = await self.redis_client.lrange(key, 0, 59)
            
            if len(candles_data) < 60:
                return
            
            candles = [json.loads(c) for c in candles_data]
            candles.reverse()
            
            prices = [c["close"] for c in candles]
            
            current_time = datetime.fromtimestamp(candles[-1]["timestamp"])
            bucket = (int(current_time.timestamp()) // 60) * 60
            
            candle_1m = {
                "timestamp": bucket,
                "open": candles[0]["open"],
                "high": max([c["high"] for c in candles]),
                "low": min([c["low"] for c in candles]),
                "close": candles[-1]["close"],
                "volume": sum([c["volume"] for c in candles])
            }
            
            # Store 1m candle
            key_1m = f"candles:{symbol}:1m"
            await self.redis_client.lpush(key_1m, json.dumps(candle_1m))
            await self.redis_client.ltrim(key_1m, 0, 4999)

            await self.redis_client.publish(
                "candle_updates",
                json.dumps({
                    "type": "candle_update",
                    "symbol": symbol,
                    "timeframe": "1m",
                    "candle": candle_1m
                })
            )
            
        except Exception as e:
            logger.error(f"Error creating 1m candle for {symbol}: {e}")
    
    async def resample_5m_candles(self):
        """New: Resample 1m candles into 5m candles every 5 minutes"""
        symbols = ["btcusdt", "ethusdt", "bnbusdt"]
        
        while True:
            try:
                # Wait until next 5-minute boundary
                now = datetime.now()
                minutes_in_hour = now.minute
                minutes_until_next_5m = 5 - (minutes_in_hour % 5)
                seconds_until_next_5m = minutes_until_next_5m * 60 - now.second
                await asyncio.sleep(max(1, seconds_until_next_5m))
                
                for symbol in symbols:
                    await self._create_5m_candle(symbol)
            except Exception as e:
                logger.error(f"Error resampling 5m candles: {e}")
                await asyncio.sleep(10)
    
    async def _create_5m_candle(self, symbol: str):
        """Create a 5-minute candle from last 5 1m candles"""
        try:
            # Get last 5 1-minute candles
            key = f"candles:{symbol}:1m"
            candles_data = await self.redis_client.lrange(key, 0, 4)
            
            if len(candles_data) < 5:
                return
            
            candles = [json.loads(c) for c in candles_data]
            candles.reverse()
            
            current_time = datetime.fromtimestamp(candles[-1]["timestamp"])
            bucket = (int(current_time.timestamp()) // 300) * 300
            
            candle_5m = {
                "timestamp": bucket,
                "open": candles[0]["open"],
                "high": max([c["high"] for c in candles]),
                "low": min([c["low"] for c in candles]),
                "close": candles[-1]["close"],
                "volume": sum([c["volume"] for c in candles])
            }
            
            # Store 5m candle
            key_5m = f"candles:{symbol}:5m"
            await self.redis_client.lpush(key_5m, json.dumps(candle_5m))
            await self.redis_client.ltrim(key_5m, 0, 4999)

            await self.redis_client.publish(
                "candle_updates",
                json.dumps({
                    "type": "candle_update",
                    "symbol": symbol,
                    "timeframe": "5m",
                    "candle": candle_5m
                })
            )
            
        except Exception as e:
            logger.error(f"Error creating 5m candle for {symbol}: {e}")

async def start_ingestion():
    """Start the data ingestion pipeline with all resampling tasks"""
    redis_url = "redis://localhost:6379"
    pipeline = DataIngestionPipeline(redis_url)
    await pipeline.connect_redis()
    
    await asyncio.gather(
        pipeline.ingest_binance_data(),
        pipeline.resample_1s_candles(),
        pipeline.resample_1m_candles(),
        pipeline.resample_5m_candles()
    )
