import { useEffect, useRef } from 'react';
import { useStore, wsRef as sharedWsRef } from './store';

const WS_URL = '${import.meta.env.VITE_API_URL?.replace(/^http/,"ws") ?? "ws://localhost:4000"}/ws';
const RECONNECT_DELAY_MS = 1500;
const FALLBACK_AFTER_FAILED_ATTEMPTS = 2;
const POLL_INTERVAL_MS = 3000;

/**
 * Owns the live-data lifecycle for the active watchlist:
 *  - opens a WebSocket scoped to (userId, watchlistId)
 *  - retries with backoff on drop
 *  - after a couple of failed attempts, degrades to REST polling so the grid
 *    never just goes silent — "stale but visibly trying" beats "looks live but isn't"
 *  - switches back to the socket transparently once it reconnects
 *
 * sharedWsRef is a module-level ref exported from the store so that store actions
 * (e.g. addSymbol) can reach the live socket without going through React state.
 */
export function useMarketSocket() {
  const activeWatchlistId = useStore((s) => s.activeWatchlistId);
  const userId = useStore((s) => s.userId);
  const applySnapshot = useStore((s) => s.applySnapshot);
  const applyTick = useStore((s) => s.applyTick);
  const setConnStatus = useStore((s) => s.setConnStatus);
  const fetchLiveOnce = useStore((s) => s.fetchLiveOnce);

  const attemptsRef = useRef(0);
  const pollRef = useRef<number | null>(null);
  const localWsRef = useRef<WebSocket | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!activeWatchlistId) return;
    stoppedRef.current = false;
    attemptsRef.current = 0;
    setConnStatus('connecting');

    function stopPolling() {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }

    function startPolling() {
      if (pollRef.current) return;
      setConnStatus('polling-fallback');
      fetchLiveOnce();
      pollRef.current = window.setInterval(fetchLiveOnce, POLL_INTERVAL_MS);
    }

    function connect() {
      if (stoppedRef.current) return;
      const ws = new WebSocket(`${WS_URL}?userId=${userId}&watchlistId=${activeWatchlistId}`);
      localWsRef.current = ws;

      ws.onopen = () => {
        attemptsRef.current = 0;
        stopPolling();
        setConnStatus('live');
        sharedWsRef.current = ws; // expose to store so addSymbol can reach the live socket
      };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'snapshot') applySnapshot(msg.packets);
        else if (msg.type === 'tick') applyTick(msg.packet);
      };

      ws.onclose = () => {
        if (sharedWsRef.current === ws) sharedWsRef.current = null;
        if (stoppedRef.current) return;
        attemptsRef.current += 1;
        if (attemptsRef.current >= FALLBACK_AFTER_FAILED_ATTEMPTS) startPolling();
        else setConnStatus('connecting');
        setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      stoppedRef.current = true;
      stopPolling();
      localWsRef.current?.close();
      sharedWsRef.current = null;
    };
  }, [activeWatchlistId, userId, applySnapshot, applyTick, setConnStatus, fetchLiveOnce]);
}
