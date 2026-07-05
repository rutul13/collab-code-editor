import { getRedisClient } from '../config/redis';

// Key namespaces
const NS_YJS  = 'yjs';   // yjs:<roomId>  → base64-encoded Yjs state
const NS_TEXT = 'text';  // text:<roomId> → plain text snapshot
const NS_LANG = 'lang';  // lang:<roomId> → editor language, set once at creation
const SET_HAS_CONTENT = 'rooms:with-content'; // Set of roomIds that have been edited

export class RedisRepository {
  private key(ns: string, roomId: string): string {
    return `${ns}:${roomId}`;
  }

  // ── Yjs state (binary, stored as base64) ─────────────────────────────────

  async getYjsState(roomId: string): Promise<Buffer | null> {
    const raw = await getRedisClient().get(this.key(NS_YJS, roomId));
    return raw ? Buffer.from(raw, 'base64') : null;
  }

  async setYjsState(roomId: string, state: Uint8Array): Promise<void> {
    const encoded = Buffer.from(state).toString('base64');
    await getRedisClient().set(this.key(NS_YJS, roomId), encoded);
  }

  // ── Plain-text snapshot ───────────────────────────────────────────────────

  async getTextSnapshot(roomId: string): Promise<string | null> {
    return getRedisClient().get(this.key(NS_TEXT, roomId));
  }

  async setTextSnapshot(roomId: string, text: string): Promise<void> {
    const client = getRedisClient();
    await client.set(this.key(NS_TEXT, roomId), text);

    // Track that this room now has content so the lobby can surface it
    if (text.trim().length > 0) {
      await client.sAdd(SET_HAS_CONTENT, roomId);
    }
  }

  // ── Language (set once at room creation, read on every join) ─────────────

  async getLanguage(roomId: string): Promise<string | null> {
    return getRedisClient().get(this.key(NS_LANG, roomId));
  }

  async setLanguage(roomId: string, language: string): Promise<void> {
    await getRedisClient().set(this.key(NS_LANG, roomId), language);
  }

  // ── Room membership ───────────────────────────────────────────────────────

  async getRoomsWithContent(): Promise<string[]> {
    return getRedisClient().sMembers(SET_HAS_CONTENT);
  }

  async removeRoomFromContentSet(roomId: string): Promise<void> {
    await getRedisClient().sRem(SET_HAS_CONTENT, roomId);
  }

  // ── Bulk cleanup ──────────────────────────────────────────────────────────

  async deleteRoom(roomId: string): Promise<void> {
    const client = getRedisClient();
    await Promise.all([
      client.del(this.key(NS_YJS, roomId)),
      client.del(this.key(NS_TEXT, roomId)),
      client.del(this.key(NS_LANG, roomId)),
      client.sRem(SET_HAS_CONTENT, roomId),
    ]);
  }
}
