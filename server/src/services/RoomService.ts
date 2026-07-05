import { Room } from '../models/types';
import { RedisRepository } from '../repositories/RedisRepository';
import { DatabaseRepository } from '../repositories/DatabaseRepository';

/**
 * Two jobs live here: tracking who's currently connected to which room
 * (pure in-memory bookkeeping, resets on server restart — and that's
 * fine, since "who's online right now" isn't something that should
 * survive a restart anyway), and building the room list the lobby polls.
 *
 * The lobby list is honestly the messiest part of this codebase. A room
 * can show up from three different places — someone's actively connected
 * (in-memory), it has content cached in Redis, or it has a saved row in
 * SQLite — and none of those three is a complete picture on its own.
 * getOpenRooms() merges all three into one list. It works, but if I were
 * starting over I'd probably want one authoritative "this room exists"
 * store instead of reconciling three sources every single poll. Didn't
 * refactor it because it works correctly as-is and I didn't want to
 * touch working code without a concrete reason to.
 */
export class RoomService {
  // roomId → set of connected socket ids. This is the ONLY place "who's
  // online" lives — deliberately not persisted anywhere, since a stale
  // "user is online" record surviving a crash would be worse than just
  // starting fresh.
  private activeConnections = new Map<string, Set<string>>();

  constructor(
    private readonly redisRepo: RedisRepository,
    private readonly dbRepo: DatabaseRepository,
  ) {}

  // ── Connection tracking ───────────────────────────────────────────────────

  join(roomId: string, socketId: string): void {
    if (!this.activeConnections.has(roomId)) {
      this.activeConnections.set(roomId, new Set());
    }
    this.activeConnections.get(roomId)!.add(socketId);
  }

  /** Returns true if that was the last person in the room. */
  leave(roomId: string, socketId: string): boolean {
    const room = this.activeConnections.get(roomId);
    if (!room) return false;
    room.delete(socketId);
    if (room.size === 0) {
      this.activeConnections.delete(roomId);
      return true;
    }
    return false;
  }

  getActiveUserCount(roomId: string): number {
    return this.activeConnections.get(roomId)?.size ?? 0;
  }

  /**
   * Reverse lookup — given a socket, which room were they in? Needed for
   * the disconnect handler, since a raw socket disconnect event only
   * gives you the socket id, not which room it was sitting in.
   */
  getRoomForSocket(socketId: string): string | null {
    for (const [roomId, sockets] of this.activeConnections) {
      if (sockets.has(socketId)) return roomId;
    }
    return null;
  }

  // ── Lobby ─────────────────────────────────────────────────────────────────

  /**
   * Builds the "open rooms" list. A room counts as open if someone's
   * actively in it right now, OR it's been edited before (has saved
   * content somewhere) — an empty room nobody's ever touched just
   * doesn't show up, on purpose, so the lobby doesn't fill up with
   * ghost rooms from people typing a room name and immediately closing
   * the tab.
   */
  async getOpenRooms(): Promise<Room[]> {
    const roomMap = new Map<string, Room>();

    // Pass 1 — who's connected right now. Most reliable source for
    // activeUsers since it's live, not cached.
    for (const [roomId, sockets] of this.activeConnections) {
      roomMap.set(roomId, {
        id: roomId,
        activeUsers: sockets.size,
        hasContent: false,
        language: 'plaintext', // just a placeholder — real value gets filled in below
        updatedAt: Date.now(),
      });
    }

    // Pass 2 — Redis's "has this room ever had real content" set. Catches
    // rooms that are empty right now (nobody online) but were edited at
    // some point in the current Redis session.
    const cachedRooms = await this.redisRepo.getRoomsWithContent();
    for (const roomId of cachedRooms) {
      const entry = roomMap.get(roomId);
      if (entry) {
        entry.hasContent = true;
      } else {
        roomMap.set(roomId, {
          id: roomId,
          activeUsers: 0,
          hasContent: true,
          language: 'plaintext',
          updatedAt: Date.now(),
        });
      }
    }

    // Pass 3 — SQLite. This is the one source that survives a full Redis
    // restart, so it also gets to be the authority on `updatedAt` and
    // `language` whenever it has an entry.
    const dbMeta = this.dbRepo.findAllRoomsWithMeta();
    for (const { roomId, language, updatedAt } of dbMeta) {
      const entry = roomMap.get(roomId);
      if (entry) {
        entry.hasContent = true;
        entry.updatedAt  = updatedAt;
        entry.language   = language;
      } else {
        roomMap.set(roomId, {
          id: roomId,
          activeUsers: 0,
          hasContent: true,
          language,
          updatedAt,
        });
      }
    }

    const filtered = Array.from(roomMap.values())
      .filter((r) => r.activeUsers > 0 || r.hasContent);

    // A brand-new room (created seconds ago, nobody's typed anything yet)
    // won't show up in dbMeta at all, so its language is still sitting
    // at the 'plaintext' placeholder from pass 1/2 even if it was
    // actually created as, say, a Python room. This last pass catches
    // those by asking Redis directly. I used an explicit "was this room
    // actually found in dbMeta" check rather than just testing
    // `language === 'plaintext'`, since the latter would misfire for
    // any room that's legitimately plaintext — a subtle bug I caught
    // while testing, not something I got right on the first pass.
    await Promise.all(
      filtered.map(async (room) => {
        const alreadyResolvedFromDb = dbMeta.some((m) => m.roomId === room.id);
        if (!alreadyResolvedFromDb) {
          const redisLang = await this.redisRepo.getLanguage(room.id);
          if (redisLang) room.language = redisLang;
        }
      }),
    );

    // TODO: this fires a Redis round-trip per unresolved room, per poll,
    // per connected client (the lobby polls every 5s — see useRooms.ts
    // on the client). Completely fine at "a handful of people using this,"
    // would need rethinking if this ever had real concurrent traffic.

    return filtered.sort((a, b) => {
      if (b.activeUsers !== a.activeUsers) return b.activeUsers - a.activeUsers;
      return b.updatedAt - a.updatedAt;
    });
  }
}
