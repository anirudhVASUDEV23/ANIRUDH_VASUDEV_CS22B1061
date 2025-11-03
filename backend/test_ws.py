#!/usr/bin/env python3
"""Test WebSocket connection to backend"""
import asyncio
import websockets

async def test_websocket():
    uri = "ws://localhost:8000/ws/data"
    print(f"Connecting to {uri}...")
    
    try:
        async with websockets.connect(uri) as websocket:
            print("✅ Connected successfully!")
            
            # Receive initial message
            message = await websocket.recv()
            print(f"📨 Received: {message}")
            
            # Keep connection alive for a few seconds
            await asyncio.sleep(3)
            print("✅ Connection stable")
            
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_websocket())
