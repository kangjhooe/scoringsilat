import { BACKEND_URL } from "@/lib/api";

export function wsUrlFor(path) {
  // Convert backend URL to ws/wss
  const base = BACKEND_URL.replace(/^http/, "ws");
  return `${base}/api${path}`;
}

export function openMatchSocket(matchId, onMessage) {
  const url = wsUrlFor(`/ws/match/${matchId}`);
  return openWS(url, onMessage);
}

export function openArenaSocket(arenaId, onMessage) {
  const url = wsUrlFor(`/ws/arena/${arenaId}`);
  return openWS(url, onMessage);
}

export function openPublicMatchSocket(matchId, onMessage) {
  const url = wsUrlFor(`/ws/public/match/${matchId}`);
  return openWS(url, onMessage);
}

function openWS(url, onMessage) {
  let ws;
  let closed = false;
  let reconnectDelay = 1000;
  let pingInterval;

  const connect = () => {
    ws = new WebSocket(url);
    ws.onopen = () => {
      reconnectDelay = 1000;
      pingInterval = setInterval(() => {
        try { ws.send("ping"); } catch (e) { /* noop */ }
      }, 25000);
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        onMessage?.(msg);
      } catch (err) { /* noop */ }
    };
    ws.onclose = () => {
      clearInterval(pingInterval);
      if (!closed) setTimeout(connect, reconnectDelay = Math.min(reconnectDelay * 1.5, 8000));
    };
    ws.onerror = () => {
      try { ws.close(); } catch (e) { /* noop */ }
    };
  };

  connect();

  return {
    close: () => {
      closed = true;
      clearInterval(pingInterval);
      try { ws.close(); } catch (e) { /* noop */ }
    },
  };
}
