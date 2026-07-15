import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { MonacoBinding } from 'y-monaco';
import type * as monaco from 'monaco-editor';
import { socketService } from '../services/socketService';

/**
 * This one's my favorite piece of the whole project, and also the part
 * that took the longest to actually implement while understanding everything.
 *
 * Yjs fires an 'update' event every time the doc changes, full stop —
 * it doesn't care if that change came from a user typing locally or from a
 * network message that just arrived from someone else. Left unchecked,
 * that means: person A types → update fires → that gets broadcast to the
 * server → server relays it to person B → person B applies it →
 * person B's update fires too → and now person B's code is trying to
 * send person A's own edit right back to the server. Nothing breaks
 * immediately, but you get a pointless echo loop and wasted bandwidth,
 * and it gets worse the more people are in a room.
 *
 * The fix is this origin tag. Y.applyUpdate() takes an optional third
 * argument, `origin`, that just gets attached to the update event as
 * metadata — Yjs doesn't do anything with it itself, it's purely for
 * consumers like us to use however we want. So: when I apply an update
 * that came from the network, I tag it with this REMOTE_ORIGIN symbol.
 * When the update listener fires, I check that tag — if it's
 * REMOTE_ORIGIN, I know this update didn't originate locally, so I
 * skip re-broadcasting it. Anything without that tag must have come
 * from an actual local keystroke, so that's the only thing I send out.
 *
 * Used a Symbol specifically (not a string like 'remote') so there's
 * zero chance of an accidental collision with some other part of the
 * code also tagging updates with an origin for a different reason.
 */
const REMOTE_ORIGIN = Symbol('remote-sync');

/**
 * Owns the entire collaboration lifecycle for whatever room the user is
 * currently in: spins up a Yjs doc, wires it to the socket, and tears
 * everything down cleanly on unmount. `bindEditor` is the bridge to
 * Monaco — call it from the editor's onMount callback.
 *
 * IMPORTANT ordering note (this was the source of a genuinely nasty bug):
 * the Monaco editor mounting and the server's `yjs-init` reply are two
 * completely independent async events with no guaranteed order. Monaco
 * mounts on React's render schedule; yjs-init arrives on a network
 * round-trip. If I construct the MonacoBinding while the Yjs doc is empty
 * and THEN apply the init state a moment later (or vice-versa), the
 * binding and the doc briefly disagree about the document's contents, and
 * MonacoBinding "reconciles" that disagreement by emitting its own Yjs
 * ops — which then get broadcast to everyone else and corrupt the shared
 * document (characters teleporting, edits duplicating, backspaces not
 * syncing). On localhost the round-trip is ~0ms so the race window is
 * microscopic and it basically never fires; behind a real network (a
 * proxy/CDN adding 30-80ms) the window is wide enough that it fires all
 * the time. That's why it only showed up once the app was deployed.
 *
 * The fix: never construct the binding until BOTH (a) the editor has
 * mounted and (b) yjs-init has been applied. Whichever lands second is
 * the one that actually triggers the bind. See `tryBind` below.
 *
 * @param requestedLanguage Passed straight through to the server on
 *   join — only has any effect if this room doesn't exist yet.
 */
export function useCollaboration(roomId: string, requestedLanguage?: string) {
  const ydocRef    = useRef<Y.Doc | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);

  // The two things that must both be ready before I can safely bind.
  const editorRef  = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const initDoneRef = useRef(false);

  const [userCount, setUserCount] = useState(1);
  const [isSynced,  setIsSynced]  = useState(false);
  const [language,  setLanguage]  = useState('plaintext');

  useEffect(() => {
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    initDoneRef.current = false;

    // Outgoing — anything typed locally gets broadcast, anything tagged
    // REMOTE_ORIGIN (see the big comment above) gets skipped.
    const onLocalUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE_ORIGIN) {
        socketService.sendYjsUpdate(roomId, update);
      }
    };
    ydoc.on('update', onLocalUpdate);

    // The server answers a join with the full document state plus
    // whatever language the room actually got created with (which might
    // not be what I requested, if the room already existed — see the
    // big block comment on the server's DocumentService for why).
    //
    // Crucially: I mark init as done and THEN try to bind. If the editor
    // already mounted while I were waiting for this, tryBind() will now
    // succeed. If it hasn't mounted yet, bindEditor() will call tryBind()
    // when it does.
    const offInit = socketService.onYjsInit((state, resolvedLanguage) => {
      Y.applyUpdate(ydoc, state, REMOTE_ORIGIN);
      initDoneRef.current = true;
      setLanguage(resolvedLanguage);
      setIsSynced(true);
      tryBind();
    });

    // Every subsequent edit from anyone else in the room arrives here.
    const offUpdate = socketService.onYjsUpdate((update) => {
      Y.applyUpdate(ydoc, update, REMOTE_ORIGIN);
    });

    const offCount = socketService.onUserCount(setUserCount);

    socketService.joinRoom(roomId, requestedLanguage);

    return () => {
      // The socket itself is a long-lived singleton (see socketService.ts)
      // — it does NOT disconnect just because this component unmounts,
      // which means the server has no way of knowing a user left unless I
      // tell it explicitly. This one line is the fix for a bug where
      // active-user counts never went back down after someone navigated
      // back to the lobby.
      socketService.leaveRoom(roomId);

      offInit();
      offUpdate();
      offCount();
      ydoc.off('update', onLocalUpdate);
      bindingRef.current?.destroy();
      bindingRef.current = null;
      editorRef.current = null;
      initDoneRef.current = false;
      ydoc.destroy();
      ydocRef.current = null;
    };
    // requestedLanguage deliberately left out of the dependency array —
    // it's only relevant for the very first join, and I don't want a
    // re-render with a different value tearing down and recreating the
    // whole collaboration session for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  /**
   * Constructs the MonacoBinding, but ONLY once both prerequisites are
   * met: the editor is mounted AND the initial doc state has been applied.
   * Called from two places — bindEditor() (when the editor mounts) and the
   * onYjsInit handler (when init lands) — so whichever happens second is
   * the one that actually wires things up. Idempotent: the initDone /
   * editor / existing-binding guards mean calling it early or twice is a
   * harmless no-op.
   */
  function tryBind(): void {
    if (bindingRef.current) return;          // already bound
    if (!initDoneRef.current) return;        // init hasn't landed yet
    const editor = editorRef.current;
    const ydoc   = ydocRef.current;
    if (!editor || !ydoc) return;            // editor hasn't mounted yet
    const model = editor.getModel();
    if (!model) return;

    const ytext = ydoc.getText('content');
    bindingRef.current = new MonacoBinding(ytext, model, new Set([editor]));
  }

  /**
   * Called from Monaco's onMount. We DON'T bind here directly anymore —
   * I just record the editor and defer to tryBind(), which will only
   * actually construct the binding once yjs-init has also completed.
   * See the big ordering note on the hook above for why this matters.
   */
  function bindEditor(editor: monaco.editor.IStandaloneCodeEditor): void {
    editorRef.current = editor;
    tryBind();
  }

  return { bindEditor, userCount, isSynced, language };
}

/**
 * Didn't get to, but would be reasonably easy to bolt on:
 *
 * - Cursor/selection presence (seeing where other people's cursors are).
 *   Yjs actually ships this out of the box via y-protocols/awareness —
 *   it's a separate small protocol layered on top of the same doc.
 *   Would be a nice addition, just didn't prioritize it for this pass.
 *
 * - Why CRDTs instead of Operational Transformation (the more
 *   "traditional" approach for this kind of editor, and what Google Docs
 *   is generally understood to use some form of): OT needs a central
 *   server to serialize and transform every operation against every
 *   other in-flight operation, which gets genuinely gnarly once you have
 *   more than a couple of concurrent editors — you end up needing careful
 *   operation ordering and transform functions for every op type. CRDTs
 *   sidestep all of that: the data structure itself guarantees that
 *   applying the same updates in any order converges to the same result,
 *   so there's no central arbiter needed at all. Yjs specifically was an
 *   easy pick since it already has a maintained Monaco binding.
 */