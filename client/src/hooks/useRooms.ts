import { useState, useEffect, useCallback } from 'react';
// `import type` here for the same reason as RoomList.tsx — Room is a
// TypeScript interface with nothing behind it at runtime, and Vite's
// per-file dev transpilation can mis-treat a plain import as a real
// value import in that case.
import type { Room } from '../types';

const SERVER_URL    = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';
const POLL_INTERVAL = 5_000; // ms

/**
 * Fetches and periodically refreshes the list of open rooms from the server.
 * Uses simple polling rather than a push channel — appropriate for a lobby
 * where near-real-time (5 s lag) is perfectly acceptable.
 */
export function useRooms() {
  const [rooms,   setRooms]   = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/rooms`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { rooms: Room[] };
      setRooms(data.rooms);
      setError(null);
    } catch {
      setError('Could not reach the server. Is it running?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRooms();
    const interval = setInterval(() => void fetchRooms(), POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchRooms]);

  /**
   * Permanently deletes a room. The server refuses if it currently has
   * active users (409), which surface as a returned error string
   * rather than throwing, so the caller can show it inline if needed.
   */
  const deleteRoom = useCallback(async (roomId: string): Promise<string | null> => {
    try {
      const res = await fetch(`${SERVER_URL}/api/rooms/${encodeURIComponent(roomId)}`, {
        method: 'DELETE',
      });
      const data = await res.json() as { error?: string };

      if (!res.ok) return data.error ?? `HTTP ${res.status}`;

      await fetchRooms(); // Refresh list immediately rather than waiting for next poll
      return null;
    } catch {
      return 'Could not reach the server.';
    }
  }, [fetchRooms]);

  return { rooms, loading, error, refresh: fetchRooms, deleteRoom };
}
