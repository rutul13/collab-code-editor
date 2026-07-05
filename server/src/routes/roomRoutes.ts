import { Router, Request, Response } from 'express';
import { RoomService } from '../services/RoomService';
import { DocumentService } from '../services/DocumentService';

/**
 * GET  /api/rooms       — list open rooms for the lobby
 * DELETE /api/rooms/:id — permanently delete a room's data
 */
export function createRoomRouter(
  roomService: RoomService,
  docService: DocumentService,
): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const rooms = await roomService.getOpenRooms();
      res.json({ rooms });
    } catch (err) {
      console.error('[API] Error fetching rooms:', err);
      res.status(500).json({ error: 'Failed to fetch rooms.' });
    }
  });

  /**
   * Refuses to delete a room that currently has active users —
   * prevents accidentally wiping a document someone is mid-edit on.
   */
  router.delete('/:roomId', async (req: Request, res: Response) => {
    const { roomId } = req.params;

    if (!roomId) {
      res.status(400).json({ error: 'roomId is required.' });
      return;
    }

    const activeUsers = roomService.getActiveUserCount(roomId);
    if (activeUsers > 0) {
      res.status(409).json({
        error: `Cannot delete "${roomId}" — ${activeUsers} user(s) currently active.`,
      });
      return;
    }

    try {
      await docService.deleteRoomData(roomId);
      res.json({ success: true, roomId });
    } catch (err) {
      console.error('[API] Error deleting room:', err);
      res.status(500).json({ error: 'Failed to delete room.' });
    }
  });

  return router;
}
