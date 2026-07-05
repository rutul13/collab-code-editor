/** A room entry returned by GET /api/rooms */
export interface Room {
  id: string;
  activeUsers: number;
  hasContent: boolean;
  language: string;
  updatedAt: number;
}

/** Options shown in the language selector when creating a new room. */
export const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'plaintext',  label: 'Plain Text' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python',     label: 'Python 3' },
  { value: 'java',       label: 'Java' },
];
