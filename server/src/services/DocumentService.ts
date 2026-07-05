import * as Y from 'yjs';
import { RedisRepository } from '../repositories/RedisRepository';
import { DatabaseRepository } from '../repositories/DatabaseRepository';
import { DEFAULT_LANGUAGE } from '../models/types';

/**
 * This is the heart of the whole editor — it owns every Yjs document and
 * decides where a room's data actually lives at any given moment.
 *
 * There are three tiers, fastest to slowest:
 *   1. In-memory Map     — instant, but gone the second the process restarts
 *   2. Redis             — sub-millisecond, survives a server restart
 *   3. SQLite            — durable, but only written after a room goes idle
 *
 * Why three layers instead of just "always hit the database"? Because
 * writing to disk on every single keystroke across every open room would
 * hammer I/O for no real benefit — nobody needs sub-second durability on
 * a code editor. Redis gives near-instant reads/writes for the active
 * session, and SQLite is the safety net that survives even if Redis
 * itself gets restarted or evicted. PersistenceService is what decides
 * *when* the SQLite write actually happens (see that file for the
 * debounce logic — it's arguably the more interesting piece).
 *
 * Language works the same way: it's decided once, at room creation, and
 * from that point on it's just metadata that rides along next to the
 * document. Nothing in here changes a room's language after the fact —
 * that was a deliberate simplification, not an oversight. Letting people
 * change language mid-session felt like a feature nobody would actually
 * use, and it would have meant re-tokenizing existing content, dealing
 * with mixed syntax highlighting mid-edit, etc. Not worth the complexity
 * for what's fundamentally a demo project.
 */
export class DocumentService {
  // Only holds a Yjs doc for rooms that currently have someone in them.
  // Everything else lives in Redis/SQLite until somebody joins again.
  private docs = new Map<string, Y.Doc>();
  
  /**
   * Fixes a real race condition I hit during testing: two `join-room`
   * calls for the same brand-new room landing close enough together
   * (this happens routinely in dev thanks to React 18 StrictMode
   * intentionally double-invoking effects) would each independently
   * decide "this room doesn't exist yet" and each create their OWN
   * separate Y.Doc — two unrelated CRDT documents both claiming to be
   * the same room. The symptom was a duplicated welcome-message line in
   * the editor, and — much worse — silent data loss, since edits whose
   * CRDT position referenced the "losing" document's content could end
   * up structurally orphaned on the server and never persist.
   *
   * This map holds the in-flight creation Promise for any room currently
   * being hydrated. A second concurrent call for the same room finds the
   * Promise here and awaits/returns THAT result instead of starting a
   * second, independent creation. Classic singleflight pattern.
   */
  private creationLocks = new Map<string, Promise<Y.Doc>>();

  constructor(
    private readonly redisRepo: RedisRepository,
    private readonly dbRepo: DatabaseRepository,
  ) {}

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Gets (or creates) the live Yjs doc for a room. This is the function
   * every other method in here funnels through, so it's worth reading
   * closely if you're trying to understand the whole cache hierarchy.
   *
   * @param requestedLanguage Only matters if nobody has ever created this
   *   room before. If the room already exists — anywhere, in Redis or
   *   SQLite — its original language wins and this argument is silently
   *   ignored. I went back and forth on whether that should be an error
   *   instead of a silent no-op, but decided a client trying to "set" a
   *   language on an existing room is a pretty harmless mistake, not
   *   something worth surfacing as a failure.
   */
  async getOrCreateDoc(roomId: string, requestedLanguage?: string): Promise<Y.Doc> {
    // Already fully created and sitting in memory — fast path.
    const existing = this.docs.get(roomId);
    if (existing) return existing;
 
    // Someone else is mid-creation for this exact room right now —
    // piggyback on their result instead of racing them. This is the
    // actual fix; see the big comment on `creationLocks` above for why
    // it's needed.
    const inFlight = this.creationLocks.get(roomId);
    if (inFlight) return inFlight;
 
    const creationPromise = this._hydrateDoc(roomId, requestedLanguage);
    this.creationLocks.set(roomId, creationPromise);
 
    try {
      return await creationPromise;
    } finally {
      // Clear the lock once creation settles either way, so a genuinely
      // later attempt (e.g. this same room, long after this one exited)
      // isn't stuck waiting on an already-resolved promise forever.
      this.creationLocks.delete(roomId);
    }
  }

  /**
   * Applies one incremental CRDT update (a Yjs "delta", basically — a
   * small binary diff, not the whole document) and writes the result
   * straight to Redis. Note this does NOT touch SQLite — see
   * PersistenceService for why that's handled separately with a delay.
   */
  async applyUpdate(roomId: string, update: Uint8Array): Promise<void> {
    const doc = await this.getOrCreateDoc(roomId);
    Y.applyUpdate(doc, update);
    await this._persistToRedis(roomId, doc);
  }

  /** Full document snapshot, sent to a client the moment it joins a room. */
  async getFullState(roomId: string, requestedLanguage?: string): Promise<Uint8Array> {
    const doc = await this.getOrCreateDoc(roomId, requestedLanguage);
    return Y.encodeStateAsUpdate(doc);
  }

  /**
   * Redis first, SQLite as a fallback, hardcoded default as a last resort.
   * Called way more often than I'd like (every join, every SQLite flush) —
   * if this project ever needed to scale past "a few people test using it,"
   * I'd cache this in-memory alongside the Yjs doc itself instead of
   * hitting Redis every time. Left it this way for now because it's
   * simple and correct, and premature optimization felt like the wrong
   * move and overkill for a project this size.
   */
  async getLanguage(roomId: string): Promise<string> {
    const cached = await this.redisRepo.getLanguage(roomId);
    if (cached) return cached;

    const snapshot = this.dbRepo.findByRoomId(roomId);
    if (snapshot?.language) {
      await this.redisRepo.setLanguage(roomId, snapshot.language);
      return snapshot.language;
    }

    return DEFAULT_LANGUAGE;
  }

  /**
   * The actual SQLite write. PersistenceService calls this once a room's
   * been quiet for a while — this method itself doesn't know or care
   * about timing, it just does the write when told to.
   */
  async flushToDB(roomId: string): Promise<void> {
    const doc = this.docs.get(roomId);
    if (!doc) {
      // Nobody's actively in this room right now (it got evicted from
      // memory already), but Redis might still have the last known
      // state if the idle timer fired right as the last person left.
      // Rebuild a throwaway doc just long enough to persist it, then
      // toss it — no reason to keep it in memory for a room nobody's in.
      const state = await this.redisRepo.getYjsState(roomId);
      if (!state) return;
      const tempDoc = new Y.Doc();
      Y.applyUpdate(tempDoc, new Uint8Array(state));
      await this._saveSnapshot(roomId, tempDoc);
      tempDoc.destroy();
      return;
    }
    await this._saveSnapshot(roomId, doc);
  }

  /**
   * Frees the in-memory Yjs doc once everyone's left a room. Redis still
   * has the state, so the next person to join rehydrates from there —
   * this is purely about not letting empty rooms quietly eat RAM forever.
   */
  evictDoc(roomId: string): void {
    const doc = this.docs.get(roomId);
    if (doc) {
      doc.destroy();
      this.docs.delete(roomId);
    }
  }

  /**
   * Wipes a room everywhere — memory, Redis, SQLite. Gone for good.
   * The route calling this is responsible for checking nobody's in the
   * room first (see RoomService.getActiveUserCount) — this method trusts
   * the caller and doesn't re-check, mostly to keep it a pure "just do
   * the delete" function rather than mixing in a permission check here.
   */
  async deleteRoomData(roomId: string): Promise<void> {
    this.evictDoc(roomId);
    await this.redisRepo.deleteRoom(roomId);
    this.dbRepo.deleteRoom(roomId);
    console.log(`[DocumentService] Deleted all data for room "${roomId}".`);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * The actual doc-creation/hydration logic, pulled into its own method
   * so getOrCreateDoc can wrap it in the singleflight lock above without
   * the locking logic and the hydration logic being tangled together.
   */
  private async _hydrateDoc(roomId: string, requestedLanguage?: string): Promise<Y.Doc> {
    const doc = new Y.Doc();
 
    const cachedState = await this.redisRepo.getYjsState(roomId);
    if (cachedState) {
      Y.applyUpdate(doc, new Uint8Array(cachedState));
      this.docs.set(roomId, doc);
      return doc;
    }
 
    const snapshot = this.dbRepo.findByRoomId(roomId);
    if (snapshot?.yjsState) {
      Y.applyUpdate(doc, new Uint8Array(snapshot.yjsState));
      await this.redisRepo.setLanguage(roomId, snapshot.language);
    } else {
      const language = requestedLanguage ?? DEFAULT_LANGUAGE;
      await this.redisRepo.setLanguage(roomId, language);
      doc.getText('content').insert(0, this._welcomeMessage(roomId, language));
    }
 
    await this._persistToRedis(roomId, doc);
    this.docs.set(roomId, doc);
    return doc;
  }

  private async _persistToRedis(roomId: string, doc: Y.Doc): Promise<void> {
    const state   = Y.encodeStateAsUpdate(doc);
    const content = doc.getText('content').toString();
    // console.log('[debug]', roomId, content.length, 'chars'); // noisy, left disabled on purpose
    await Promise.all([
      this.redisRepo.setYjsState(roomId, state),
      this.redisRepo.setTextSnapshot(roomId, content),
    ]);
  }

  private async _saveSnapshot(roomId: string, doc: Y.Doc): Promise<void> {
    const content  = doc.getText('content').toString();
    const yjsState = Buffer.from(Y.encodeStateAsUpdate(doc));
    const language = await this.getLanguage(roomId);
    this.dbRepo.save({ roomId, content, yjsState, language, updatedAt: Date.now() });
    console.log(`[DocumentService] Flushed "${roomId}" → SQLite (${content.length} chars, ${language}).`);
  }

  /**
   * Comment style depends on the language so a brand-new room doesn't look
   * broken the second you open it (a `//` comment in a Python file is just
   * a syntax error waiting to confuse someone). Small touch, but it bugged
   * me the one time I tested a Python room and saw JS-style comments in it.
   */
  private _welcomeMessage(roomId: string, language: string): string {
    switch (language) {
      case 'python':
        return `# Welcome to room: ${roomId}\n`;
      case 'plaintext':
        return `Welcome to room: ${roomId}\n`;
      default: // javascript, typescript, java
        return `// Welcome to room: ${roomId}\n`;
    }
  }
}

/**
 * Ideas I considered but didn't build:
 *
 * - Per-room size cap. Right now someone could paste in a huge file and
 *   there's nothing stopping Redis/SQLite from just... storing it. Fine
 *   for a demo, would want a hard limit (probably reject the paste
 *   client-side) before this touched real users.
 *
 * - Undo/redo across sessions. Yjs ships an UndoManager that could sit
 *   right on top of the Y.Doc in here — didn't wire it up, but it'd slot
 *   in cleanly since the doc is already the single source of truth.
 *
 * - Version history / time travel. Yjs snapshots could support a
 *   "rewind to 10 minutes ago" feature. Interesting, but felt like scope
 *   creep for what this project was trying to demonstrate.
 */
