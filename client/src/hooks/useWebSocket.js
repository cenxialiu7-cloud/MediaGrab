import { getSession, resetSession, apiFetch } from "../api";
import { useEffect, useState } from "react";
export function useWebSocket() {
  const [tasks, setTasks] = useState([]),
    [connected, setConnected] = useState(false);
  useEffect(() => {
    let disposed = false,
      ws,
      timer;
    async function connect() {
      try {
        await getSession();
        if (disposed) return;
        ws = new WebSocket(
          `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
        );
        ws.onopen = () => {
          if (disposed) return;
          setConnected(true);
          apiFetch("/api/download/tasks")
            .then((r) => r.json())
            .then((v) => {
              if (!disposed && Array.isArray(v)) setTasks(v);
            })
            .catch(() => {});
        };
        ws.onmessage = (e) => {
          if (disposed) return;
          try {
            const { type, data } = JSON.parse(e.data);
            setTasks((prev) =>
              type === "task:removed"
                ? prev.filter((t) => t.id !== data.id)
                : type === "task:created"
                  ? [data, ...prev.filter((t) => t.id !== data.id)]
                  : type === "task:updated"
                    ? prev.some((t) => t.id === data.id)
                      ? prev.map((t) =>
                          t.id === data.id ? { ...t, ...data } : t,
                        )
                      : [data, ...prev]
                    : prev,
            );
          } catch {}
        };
        ws.onclose = () => {
          if (!disposed) {
            setConnected(false);
            resetSession();
            timer = setTimeout(connect, 2000);
          }
        };
        ws.onerror = () => ws.close();
      } catch {
        if (!disposed) timer = setTimeout(connect, 2000);
      }
    }
    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, []);
  return { tasks, setTasks, connected };
}
