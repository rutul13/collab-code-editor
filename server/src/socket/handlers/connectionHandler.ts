import { Socket } from 'socket.io';
import { RoomService } from '../../services/RoomService';
import { DocumentService } from '../../services/DocumentService';

export function registerConnectionHandler(
  socket: Socket,
  roomService: RoomService,
  docService: DocumentService,
): void {
  socket.on('disconnect', () => {
    const roomId = roomService.getRoomForSocket(socket.id);
    if (!roomId) return;

    const roomIsNowEmpty = roomService.leave(roomId, socket.id);

    // Keep remaining clients informed of the new headcount
    socket.to(roomId).emit('user-count', roomService.getActiveUserCount(roomId));

    if (roomIsNowEmpty) {
      // Free the in-memory Yjs doc — it will be re-hydrated from Redis on next join
      docService.evictDoc(roomId);
    }

    console.log(
      `[Socket] ${socket.id} left "${roomId}". Users online: ${roomService.getActiveUserCount(roomId)}`,
    );
  });
}
