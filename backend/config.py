import os
from functools import lru_cache

class Settings:
    """Application settings from environment variables"""
    
    # Redis
    REDIS_URL: str = os.getenv(
        "REDIS_URL",
        "redis://localhost:6379"
    )
    
    # Binance WebSocket
    BINANCE_WS_URL: str = "wss://stream.binance.com:9443/ws"
    BINANCE_SYMBOLS: list = ["btcusdt@trade", "ethusdt@trade", "bnbusdt@trade"]
    
    # API
    API_HOST: str = os.getenv("API_HOST", "localhost")
    API_PORT: int = int(os.getenv("API_PORT", "8000"))
    
    # Logging
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    
    # Analytics
    DEFAULT_WINDOW: int = 20
    MAX_CANDLES_STORED: int = 5000
    ALERT_RETENTION_DAYS: int = 7

@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance"""
    return Settings()
