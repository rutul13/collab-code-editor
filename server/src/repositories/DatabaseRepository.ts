import { getDatabase } from '../config/database';
import { DocumentSnapshot, RoomMeta } from '../models/types';

export class DatabaseRepository {
  /**
   * Upserts a document snapshot.
   * Uses SQLite's ON CONFLICT clause for an atomic read-modify-write.
   *
   * Note: language is only ever set meaningfully on the FIRST insert.
   * Subsequent updates re-send the same value (it doesn't change after
   * room creation), so the ON CONFLICT clause re-writing it is harmless.
   */
  save(snapshot: DocumentSnapshot): void {
    getDatabase()
      .prepare(
        `INSERT INTO documents (room_id, content, yjs_state, language, updated_at)
         VALUES (@roomId, @content, @yjsState, @language, @updatedAt)
         ON CONFLICT(room_id) DO UPDATE SET
           content    = excluded.content,
           yjs_state  = excluded.yjs_state,
           language   = excluded.language,
           updated_at = excluded.updated_at`,
      )
      .run({
        roomId:    snapshot.roomId,
        content:   snapshot.content,
        yjsState:  snapshot.yjsState,
        language:  snapshot.language,
        updatedAt: snapshot.updatedAt,
      });
  }

  /** Returns the full snapshot for a room, or null if not found. */
  findByRoomId(roomId: string): DocumentSnapshot | null {
    const row = getDatabase()
      .prepare(
        'SELECT room_id, content, yjs_state, language, updated_at FROM documents WHERE room_id = ?',
      )
      .get(roomId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return {
      roomId:    row['room_id'] as string,
      content:   row['content'] as string,
      yjsState:  row['yjs_state'] ? Buffer.from(row['yjs_state'] as Buffer) : null,
      language:  (row['language'] as string) ?? 'plaintext',
      updatedAt: row['updated_at'] as number,
    };
  }

  /** Returns id + language + updatedAt for every room with non-empty content. */
  findAllRoomsWithMeta(): RoomMeta[] {
    const rows = getDatabase()
      .prepare("SELECT room_id, language, updated_at FROM documents WHERE content != ''")
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      roomId:    r['room_id'] as string,
      language:  (r['language'] as string) ?? 'plaintext',
      updatedAt: r['updated_at'] as number,
    }));
  }

  deleteRoom(roomId: string): void {
    getDatabase().prepare('DELETE FROM documents WHERE room_id = ?').run(roomId);
  }
}
