import http from 'http';
import { Server } from 'socket.io';
import { RoomService } from '../services/RoomService';
import { DocumentService } from '../services/DocumentService';
import { PersistenceService } from '../services/PersistenceService';
import { registerRoomHandler } from './handlers/roomHandler';
import { registerDocumentHandler } from './handlers/documentHandler';
import { registerConnectionHandler } from './handlers/connectionHandler';

const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

/**
 * Creates and configures the Socket.IO server.
 * Each new connection gets its own set of typed event handlers,
 * all sharing the same singleton service instances.
 */
export function createSocketServer(
  httpServer: http.Server,
  roomService: RoomService,
  docService: DocumentService,
  persistenceService: PersistenceService,
): Server {
  const io = new Server(httpServer, {
    cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    registerRoomHandler(socket, roomService, docService);
    registerDocumentHandler(socket, docService, persistenceService);
    registerConnectionHandler(socket, roomService, docService);
  });

  return io;
}
