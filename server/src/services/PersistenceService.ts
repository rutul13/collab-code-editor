import { DocumentService } from './DocumentService';

// How long a room has to sit quietly before its content gets written to
// SQLite. 30s felt like a reasonable middle ground when I was testing —
// short enough that a crash doesn't lose much, long enough that a normal
// typing burst doesn't trigger a disk write every couple of seconds.
// Genuinely just picked from feel, not from any real benchmarking. 
// Might change later.
const IDLE_TIMEOUT_MS = parseInt(process.env.IDLE_TIMEOUT_MS ?? '30000', 10);

/**
 * This exists to solve one specific problem: SQLite writes are cheap
 * individually, but "cheap individually" times "one per keystroke, times
 * every active room" adds up fast, and there's just no reason for a code
 * editor to have sub-second disk durability. Redis already has the latest
 * state at all times (see DocumentService), so SQLite's job is just to
 * be the thing that survives a container restart or a Redis flush.
 *
 * How it works: every edit resets a per-room timer. If 30 seconds of
 * silence pass, the timer fires and the room gets flushed to SQLite.
 * Keep typing past that window and the timer just keeps getting pushed
 * back — nothing gets written until you actually stop.
 *
 * Approaches I considered instead, and why I didn't go with them:
 *
 * - Flush on every single update. Simplest possible approach, but means
 *   a disk write per keystroke across every room. Would've been fine
 *   for a demo with one or two rooms open, but felt like the wrong
 *   default to build in from the start.
 *
 * - Flush on a fixed interval regardless of activity (e.g. "always write
 *   every 10s"). Easier to reason about than a debounce, but it flushes
 *   even when nothing changed, and — this is the part that actually
 *   ruled it out — you can still lose up to 10s of edits if the process
 *   dies right before the next tick. The idle-based approach at least
 *   guarantees a flush happens the moment things go quiet, not on some
 *   arbitrary clock.
 *
 * - A message queue / write-behind cache (something like Redis Streams
 *   or an actual job queue). This is closer to what I'd reach for if
 *   this were a real product with real traffic. Didn't build it here —
 *   would've been a lot of infrastructure for a project this size, and
 *   the debounce timer gets you 90% of the benefit for a fraction of
 *   the complexity.
 */
export class PersistenceService {
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly docService: DocumentService) {}

  /** Call this every time a room gets an update. Resets its idle clock. */
  scheduleFlush(roomId: string): void {
    const existing = this.timers.get(roomId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      await this.docService.flushToDB(roomId);
      this.timers.delete(roomId);
      // TODO: if this write throws, right now it just... doesn't retry.
      // The room's data isn't lost (Redis still has it, and the next
      // edit will reset the timer and try again eventually), but a
      // failed flush is currently silent. Would want at minimum a
      // logged warning here, and ideally a retry with backoff, before
      // I'd trust this with something more important than a side project.
    }, IDLE_TIMEOUT_MS);

    this.timers.set(roomId, timer);
  }

  /**
   * Drains every pending timer immediately instead of waiting for them
   * to naturally expire. Hooked up to SIGINT/SIGTERM in index.ts so a
   * `pm2 restart` or a Ctrl+C doesn't silently drop whatever was about
   * to be flushed.
   */
  async flushAll(): Promise<void> {
    const pending = Array.from(this.timers.keys());

    await Promise.all(
      pending.map(async (roomId) => {
        clearTimeout(this.timers.get(roomId)!);
        this.timers.delete(roomId);
        await this.docService.flushToDB(roomId);
      }),
    );

    if (pending.length > 0) {
      console.log(`[Persistence] Flushed ${pending.length} room(s) on shutdown.`);
    }
  }
}
