import { useEffect, useRef, useState, useCallback } from 'react';

export function useWebSocket() {
  const wsRef = useRef(null);
  const [tasks, setTasks] = useState([]);
  const [connected, setConnected] = useState(false);
  const reconnectTimer = useRef(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 2000);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch {}
    };
  }, []);

  const handleMessage = useCallback((msg) => {
    const { type, data } = msg;

    setTasks(prev => {
      switch (type) {
        case 'task:created':
          if (prev.find(t => t.id === data.id)) return prev;
          return [data, ...prev];

        case 'task:updated':
          return prev.map(t => t.id === data.id ? { ...t, ...data } : t);

        case 'task:removed':
          return prev.filter(t => t.id !== data.id);

        default:
          return prev;
      }
    });
  }, []);

  useEffect(() => {
    connect();
    fetch('/api/download/tasks')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setTasks(data); })
      .catch(() => {});

    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { tasks, setTasks, connected };
}
