import { Socket } from 'socket.io';
import { RoomService } from '../../services/RoomService';
import { DocumentService } from '../../services/DocumentService';

interface JoinRoomPayload {
  roomId: string;
  language?: string;
}

/**
 * holdover from before language selection existed — back then join-room
 * Accepts a plain string OR an object shape. The string branch is a
 * just took a bare roomId. Kept it working rather than ripping it out,
 * mostly so I wouldn't have to worry about breaking anything if some
 * old cached client bundle, or a manual test with curl/Postman, sent
 * the old shape. Costs nothing to support both.
 */
function parseJoinPayload(payload: unknown): JoinRoomPayload | null {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    return trimmed ? { roomId: trimmed } : null;
  }

  if (payload && typeof payload === 'object' && 'roomId' in payload) {
    const { roomId, language } = payload as { roomId: unknown; language?: unknown };
    if (typeof roomId !== 'string' || !roomId.trim()) return null;
    return {
      roomId: roomId.trim(),
      language: typeof language === 'string' ? language : undefined,
    };
  }

  return null;
}

/**
 * Wires up the two events that make a "room" mean anything: joining one
 * and leaving one. This is the entry point for basically every user
 * interaction that isn't a raw text edit (those go through
 * documentHandler.ts instead).
 */
export function registerRoomHandler(
  socket: Socket,
  roomService: RoomService,
  docService: DocumentService,
): void {
  socket.on('join-room', async (payload: unknown) => {
    const parsed = parseJoinPayload(payload);
    if (!parsed) return; // silently ignore garbage input rather than crashing the socket
    const { roomId, language } = parsed;

    // socket.join() is a Socket.IO built-in — it's what makes
    // `socket.to(roomId).emit(...)` later actually reach this client.
    await socket.join(roomId);
    roomService.join(roomId, socket.id);

    const count = roomService.getActiveUserCount(roomId);

    // Everyone in the room needs the new headcount, including the person
    // who just joined (hence emitting to both `socket.to(roomId)` AND
    // `socket` directly — easy to forget the second one and end up with
    // the joiner seeing a stale count until someone else joins or leaves).
    socket.to(roomId).emit('user-count', count);
    socket.emit('user-count', count);

    // getFullState is what actually creates the room if it doesn't exist
    // yet — see DocumentService.getOrCreateDoc. requestedLanguage only
    // takes effect the very first time a room is created; it's a no-op
    // for anything that already exists.
    const fullState        = await docService.getFullState(roomId, language);
    const resolvedLanguage = await docService.getLanguage(roomId);
    socket.emit('yjs-init', { state: fullState, language: resolvedLanguage });

    console.log(
      `[Socket] ${socket.id} joined "${roomId}" (${resolvedLanguage}). Users online: ${count}`,
    );
  });

  socket.on('leave-room', (roomId: unknown) => {
    if (typeof roomId !== 'string' || !roomId) return;

    // This is the fix for a bug that took me a while to track down: the
    // client's socket connection is a singleton that lives for the whole
    // app session (see socketService.ts on the client), so it never
    // actually *disconnects* just because someone navigates back to the
    // lobby. Without this explicit leave-room event, the server had no
    // way of knowing someone left, and active-user counts would just
    // never go back down until a full page refresh.
    socket.leave(roomId);
    const roomIsEmpty = roomService.leave(roomId, socket.id);
    socket.to(roomId).emit('user-count', roomService.getActiveUserCount(roomId));

    if (roomIsEmpty) {
      // Defer the actual eviction by one event-loop tick and re-check.
      // Guards against a rare timing case: a `join-room` for this exact
      // room, on this exact socket, still resolving its async work when
      // this `leave-room` happens to get processed first (this is
      // exactly the shape of thing React 18 StrictMode's dev-mode
      // double-invoke can trigger — join, leave, join again, all fired
      // back-to-back on the same socket). Without this, I could end up destroying
      // a doc that a near-simultaneous rejoin is about to need. Costs
      // nothing extra when the room really is empty.
      setImmediate(() => {
        if (roomService.getActiveUserCount(roomId) === 0) {
          docService.evictDoc(roomId);
        }
      });
    }

    console.log(
      `[Socket] ${socket.id} left "${roomId}". Users online: ${roomService.getActiveUserCount(roomId)}`,
    );
  });

  // Added this temporarily to benchmark round-trip latency for my resume
  // (see /benchmark/latency-bench.js in the repo). It just echoes
  // whatever it receives straight back to the sender — completely inert
  // otherwise, doesn't touch any room state. Left it in since it's
  // harmless, but a real production app probably shouldn't ship a raw
  // echo endpoint — would gate this behind an env flag if this were
  // ever going somewhere more serious than a portfolio project.
  socket.on('bench-ping', (payload: unknown) => {
    socket.emit('bench-pong', payload);
  });
}
