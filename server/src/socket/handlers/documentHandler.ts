import { Socket } from 'socket.io';
import { DocumentService } from '../../services/DocumentService';
import { PersistenceService } from '../../services/PersistenceService';

export function registerDocumentHandler(
  socket: Socket,
  docService: DocumentService,
  persistenceService: PersistenceService,
): void {
  /**
   * Receives an incremental Yjs update from one client.
   *
   * The update is a Yjs binary delta, but it travels as a base64 STRING,
   * not as a raw Buffer/Uint8Array. That's deliberate, and it's the fix for
   * a nasty bug: Socket.IO serializes a binary payload as two separate
   * WebSocket frames — a JSON placeholder frame plus a trailing binary
   * frame — and stitches them back together on the far side. Behind a proxy
   * that runs permessage-deflate compression (Cloudflare does), those frame
   * pairs would occasionally get reordered or mis-matched, handing the
   * receiver a corrupted delta. Applied to a CRDT, a corrupted delta shows
   * up as teleported/duplicated characters and dropped newlines — which is
   * exactly the desync I was chasing. Sending a plain base64 string means
   * one ordinary text frame with nothing to mis-stitch. Costs ~33% payload
   * size, which for tiny keystroke deltas is negligible.
   *
   * Once decoded:
   *   1. Apply it to the server-side Yjs doc (keeps the server in sync)
   *   2. Broadcast it to every other client in the room
   *   3. Schedule a debounced SQLite flush via PersistenceService
   *
   * The sender does NOT receive the echo — Socket.IO's socket.to() excludes
   * the emitting socket, so the sender's local Yjs doc stays the authority
   * for their own edits.
   */
  socket.on('yjs-update', async (payload: { roomId: string; update: string }) => {
    const { roomId, update } = payload ?? {};

    if (typeof roomId !== 'string' || !roomId || typeof update !== 'string') return;

    const updateArray = new Uint8Array(Buffer.from(update, 'base64'));

    await docService.applyUpdate(roomId, updateArray);
    // Re-broadcast the exact same base64 string — no re-encoding needed.
    socket.to(roomId).emit('yjs-update', update);
    persistenceService.scheduleFlush(roomId);
  });
}
