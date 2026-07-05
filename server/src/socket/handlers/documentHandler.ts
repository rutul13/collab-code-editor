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
   * The update is a Uint8Array (binary CRDT delta). I:
   *   1. Apply it to the server-side Yjs doc (keeps the server in sync)
   *   2. Broadcast it to every other client in the room
   *   3. Schedule a debounced SQLite flush via PersistenceService
   *
   * The sender does NOT receive the echo — Socket.IO's socket.to() excludes
   * the emitting socket, so the sender's local Yjs doc stays the authority
   * for their own edits.
   */
  socket.on('yjs-update', async (payload: { roomId: string; update: Buffer }) => {
    const { roomId, update } = payload ?? {};

    if (typeof roomId !== 'string' || !roomId || !Buffer.isBuffer(update)) return;

    const updateArray = new Uint8Array(update);

    await docService.applyUpdate(roomId, updateArray);
    socket.to(roomId).emit('yjs-update', updateArray);
    persistenceService.scheduleFlush(roomId);
  });
}
