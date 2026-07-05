import 'dotenv/config';
import http from 'http';
import { connectRedis } from './config/redis';
import { connectDatabase } from './config/database';
import { createApp } from './app';
import { createSocketServer } from './socket';
import { RedisRepository } from './repositories/RedisRepository';
import { DatabaseRepository } from './repositories/DatabaseRepository';
import { RoomService } from './services/RoomService';
import { DocumentService } from './services/DocumentService';
import { PersistenceService } from './services/PersistenceService';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

async function bootstrap(): Promise<void> {
  // ── 1. Data stores ────────────────────────────────────────────────────────
  await connectRedis();
  connectDatabase();

  // ── 2. Dependency graph ───────────────────────────────────────────────────
  //
  //  RedisRepository ──┐
  //                    ├─► DocumentService ─► PersistenceService
  //  DatabaseRepository┘         │
  //                    └─────────┴─► RoomService
  //
  const redisRepo       = new RedisRepository();
  const dbRepo          = new DatabaseRepository();
  const roomService     = new RoomService(redisRepo, dbRepo);
  const docService      = new DocumentService(redisRepo, dbRepo);
  const persistenceService = new PersistenceService(docService);

  // ── 3. HTTP + WebSocket servers ───────────────────────────────────────────
  const app        = createApp(roomService, docService);
  const httpServer = http.createServer(app);
  createSocketServer(httpServer, roomService, docService, persistenceService);

  httpServer.listen(PORT, () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`);
  });

  // ── 4. Graceful shutdown ──────────────────────────────────────────────────
  async function shutdown(signal: string): Promise<void> {
    console.log(`\n[Server] ${signal} — flushing pending writes...`);
    await persistenceService.flushAll();
    httpServer.close(() => process.exit(0));
  }

  process.on('SIGINT',  () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err: unknown) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
