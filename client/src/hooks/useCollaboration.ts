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
 * Monaco — call it from the editor's onMount callback and from that
 * point on, typing in Monaco IS editing the Yjs doc (that's what
 * MonacoBinding does under the hood).
 *
 * @param requestedLanguage Passed straight through to the server on
 *   join — only has any effect if this room doesn't exist yet.
 */
export function useCollaboration(roomId: string, requestedLanguage?: string) {
  const ydocRef    = useRef<Y.Doc | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const [userCount, setUserCount] = useState(1);
  const [isSynced,  setIsSynced]  = useState(false);
  const [language,  setLanguage]  = useState('plaintext');

  useEffect(() => {
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

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
    const offInit = socketService.onYjsInit((state, resolvedLanguage) => {
      Y.applyUpdate(ydoc, state, REMOTE_ORIGIN);
      setLanguage(resolvedLanguage);
      setIsSynced(true);
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
   * Hands the Yjs text type over to Monaco. This is genuinely almost the
   * entire integration — MonacoBinding does the heavy lifting of keeping
   * the editor's model and the Yjs doc in sync in both directions.
   * Call this from Monaco's onMount.
   */
  function bindEditor(editor: monaco.editor.IStandaloneCodeEditor): void {
    const ydoc  = ydocRef.current;
    const model = editor.getModel();
    if (!ydoc || !model) return;

    // React StrictMode calls effects twice in dev, which can leave a
    // stale binding around from the "throwaway" first mount — destroying
    // any existing binding before creating a new one keeps that safe.
    bindingRef.current?.destroy();

    const ytext = ydoc.getText('content');
    bindingRef.current = new MonacoBinding(ytext, model, new Set([editor]));
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
