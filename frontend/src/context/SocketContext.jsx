import { createContext, useContext, useEffect, useMemo, useState } from "react";
import useWebSocket from "react-use-websocket";

const resolveSocketUrl = () => {
  // Use Vite proxy - connect to same origin as the page
  if (typeof window === "undefined") {
    console.warn("SocketContext: window undefined, skipping WS init");
    return null;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host; // This will be localhost:5173

  return `${protocol}//${host}/ws/data`;
};

const SocketContext = createContext({
  lastMessage: null,
  rawMessage: null,
  sendJsonMessage: () => {},
  readyState: null,
});

export const SocketProvider = ({ children }) => {
  const socketUrl = useMemo(() => resolveSocketUrl(), []);

  const { lastMessage, sendJsonMessage, readyState } = useWebSocket(socketUrl, {
    share: true,
    shouldReconnect: () => true,
    reconnectAttempts: 10,
    reconnectInterval: 3000,
    retryOnError: true,
  });

  const [lastJsonMessage, setLastJsonMessage] = useState(null);

  useEffect(() => {
    if (!lastMessage) return;

    try {
      const parsed = JSON.parse(lastMessage.data);
      setLastJsonMessage(parsed);
    } catch (error) {
      console.warn(
        "SocketContext: Unable to parse websocket message",
        error,
        lastMessage.data
      );
    }
  }, [lastMessage]);

  const value = useMemo(
    () => ({
      lastMessage: lastJsonMessage,
      rawMessage: lastMessage,
      sendJsonMessage,
      readyState,
    }),
    [lastJsonMessage, lastMessage, sendJsonMessage, readyState]
  );

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useSocket = () => useContext(SocketContext);
