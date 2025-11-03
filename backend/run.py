import asyncio
import logging
import sys
import uvicorn
from main import app
from data_ingestion import start_ingestion
from worker import start_worker
from config import get_settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def run_services():
    """Run all services concurrently in the same event loop"""
    settings = get_settings()
    
    logger.info("Starting Quant Analytics Services")
    
    # All async services run in the same event loop for proper concurrency
    
    # Create tasks for background services
    ingestion_task = asyncio.create_task(start_ingestion())
    worker_task = asyncio.create_task(start_worker())
    
    # Configure and start the Uvicorn server
    logger.info(f"Starting API server on {settings.API_HOST}:{settings.API_PORT}")
    config = uvicorn.Config(
        app, 
        host=settings.API_HOST, 
        port=settings.API_PORT, 
        log_level="info",
        ws="wsproto",  # Use wsproto instead of websockets - more lenient with headers
        ws_max_size=16777216  # 16MB max message size
    )
    server = uvicorn.Server(config)
    
    # Run all services concurrently
    try:
        await asyncio.gather(
            server.serve(),
            ingestion_task,
            worker_task
        )
    except asyncio.CancelledError:
        logger.info("Shutting down services...")
        raise

if __name__ == "__main__":
    try:
        asyncio.run(run_services())
    except KeyboardInterrupt:
        logger.info("Shutdown requested")
        sys.exit(0)
