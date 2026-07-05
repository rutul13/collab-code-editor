/** Supported editor languages. Stored as-is; Monaco uses the same ids. */
export type EditorLanguage = 'javascript' | 'typescript' | 'python' | 'java' | 'plaintext';

export const SUPPORTED_LANGUAGES: EditorLanguage[] = [
  'javascript',
  'typescript',
  'python',
  'java',
  'plaintext',
];

export const DEFAULT_LANGUAGE: EditorLanguage = 'plaintext';

/** A room visible in the lobby. */
export interface Room {
  id: string;
  activeUsers: number;
  hasContent: boolean;
  language: string;
  updatedAt: number;
}

/** A document snapshot persisted to SQLite. */
export interface DocumentSnapshot {
  roomId: string;
  content: string;         // Plain-text representation (for readability / search)
  yjsState: Buffer | null; // Full encoded Yjs state (source of truth for CRDT)
  language: string;
  updatedAt: number;
}

/** Metadata row returned when listing all persisted rooms. */
export interface RoomMeta {
  roomId: string;
  language: string;
  updatedAt: number;
}
