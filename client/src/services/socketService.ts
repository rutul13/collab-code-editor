import { io, Socket } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

/**
 * A thin wrapper around Socket.IO so nothing else in the app has to know
 * raw event name strings like 'yjs-update' or 'join-room' — everything
 * goes through named methods instead. Mostly this is just so a typo in
 * an event name shows up as a TypeScript error instead of a silently
 * broken feature at runtime.
 *
 * Exported as a single shared instance on purpose, not something you
 * instantiate per-component. Learned this one the hard way in an
 * earlier version of this file — without the singleton, every time
 * useCollaboration's effect re-ran (which happens on every room change,
 * and in dev, twice per mount thanks to StrictMode) it was spinning up
 * a brand new socket connection, and the old one was just... still
 * sitting there connected, quietly leaking. One socket, reused
 * everywhere, fixes that completely.
 */
class SocketService {
  private readonly socket: Socket;

  constructor() {
    this.socket = io(SERVER_URL, {
      transports: ['websocket'],
      autoConnect: true,
    });

    this.socket.on('connect', () =>
      console.log('[Socket] Connected:', this.socket.id),
    );
    this.socket.on('disconnect', (reason) =>
      console.warn('[Socket] Disconnected:', reason),
    );
  }

  // ── Emitters ──────────────────────────────────────────────────────────────

  /**
   * @param language Only matters the first time this room is ever
   *   created — the server ignores it for a room that already exists.
   */
  joinRoom(roomId: string, language?: string): void {
    this.socket.emit('join-room', { roomId, language });
  }

  /**
   * Has to be called explicitly on the way out — the underlying socket
   * connection doesn't close just because user navigate away from a room
   * (it's the singleton described above), so the server has no other way
   * of knowing that the user's gone.
   */
  leaveRoom(roomId: string): void {
    this.socket.emit('leave-room', roomId);
  }

  sendYjsUpdate(roomId: string, update: Uint8Array): void {
    // Encode to base64 so this rides as a single text frame — avoids
    // Socket.IO's binary placeholder-frame splitting, which Cloudflare's
    // compression was intermittently corrupting. See documentHandler.ts.
    let binary = '';
    for (let i = 0; i < update.length; i++) binary += String.fromCharCode(update[i]);
    const encoded = btoa(binary);
    this.socket.emit('yjs-update', { roomId, update: encoded });
  }

  // ── Listeners ─────────────────────────────────────────────────────────────
  // Each of these returns an "unsubscribe" function — meant to be called
  // directly as the cleanup function inside a useEffect. Small pattern,
  // but it means the calling code never has to remember the exact
  // handler reference it needs to pass to .off() later.

  /** Fires once per join, with the full doc state and its resolved language. */
  onYjsInit(cb: (state: Uint8Array, language: string) => void): () => void {
    const handler = (payload: { state: string; language: string }) => {
      // Decode the base64 string back into the Yjs byte array.
      const bytes = Uint8Array.from(atob(payload.state), (c) => c.charCodeAt(0));
      cb(bytes, payload.language);
    };
    this.socket.on('yjs-init', handler);
    return () => this.socket.off('yjs-init', handler);
  }

  onYjsUpdate(cb: (update: Uint8Array) => void): () => void {
    const handler = (data: string) =>
      cb(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
    this.socket.on('yjs-update', handler);
    return () => this.socket.off('yjs-update', handler);
  }

  onUserCount(cb: (count: number) => void): () => void {
    this.socket.on('user-count', cb);
    return () => this.socket.off('user-count', cb);
  }
}

export const socketService = new SocketService();
