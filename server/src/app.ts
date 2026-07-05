import express from 'express';
import cors from 'cors';
import { createRoomRouter } from './routes/roomRoutes';
import { RoomService } from './services/RoomService';
import { DocumentService } from './services/DocumentService';

const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

/**
 * Creates the Express application with middleware and routes mounted.
 * Kept separate from the HTTP server so it can be tested independently.
 */
export function createApp(
  roomService: RoomService,
  docService: DocumentService,
): express.Application {
  const app = express();

  app.use(cors({ origin: CORS_ORIGIN }));
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/rooms', createRoomRouter(roomService, docService));

  return app;
}
