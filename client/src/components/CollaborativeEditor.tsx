import type { OnMount } from '@monaco-editor/react';
import Editor from '@monaco-editor/react';
import { useCollaboration } from '../hooks/useCollaboration';

interface Props {
  roomId: string;
  /** Only used if this room doesn't exist yet — ignored otherwise. */
  requestedLanguage?: string;
}

/**
 * Renders Monaco Editor with real-time CRDT-backed collaboration.
 * All sync logic lives in useCollaboration — this component is purely
 * responsible for layout and wiring the editor's onMount callback.
 */
export function CollaborativeEditor({ roomId, requestedLanguage }: Props) {
  const { bindEditor, userCount, isSynced, language } = useCollaboration(roomId, requestedLanguage);

  // Considered wiring up basic keyword completion for Python/Java,
  // decided it wasn't worth the added surface area for what this demonstrates

  const handleMount: OnMount = (editor) => {
    bindEditor(editor);
  };

  return (
    // `100%` here, not `100vw` — 100vw measures the full viewport width
    // *including* whatever space a vertical scrollbar is occupying, so
    // the moment any scrollbar appears anywhere on the page, an element
    // sized to 100vw ends up wider than the space actually available
    // next to it, and I got a second, horizontal scrollbar as a direct
    // result. `100%` sizes to the parent's actual content box instead,
    // which never has this problem.
    <div style={{ height: '100vh', width: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* ── Status bar ──────────────────────────────────────────────────── */}
      <div style={statusBarStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontWeight: 600, letterSpacing: '0.02em' }}>{roomId}</span>
          <span style={separatorStyle}>·</span>
          <span style={langTagStyle}>{language}</span>
          <span style={separatorStyle}>·</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                backgroundColor: userCount > 0 ? '#4caf50' : '#888',
              }}
            />
            {userCount} user{userCount !== 1 ? 's' : ''} online
          </span>
        </div>
        {!isSynced && (
          <span style={{ opacity: 0.6, fontSize: '12px' }}>⟳ Syncing…</span>
        )}
      </div>

      {/* ── Monaco Editor ─────────────────────────────────────────────── */}
      <div style={{ flex: 1 }}>
        <Editor
          height="100%"
          width="100%"
          theme="vs-dark"
          language={language}
          onMount={handleMount}
          options={{
            minimap: { enabled: false },
            fontSize: 15,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            renderLineHighlight: 'line',
          }}
        />
      </div>
    </div>
  );
}

const statusBarStyle: React.CSSProperties = {
  height: '32px',
  backgroundColor: '#007acc',
  color: 'white',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 14px',
  fontSize: '13px',
  fontFamily: 'system-ui, sans-serif',
  flexShrink: 0,
};

const separatorStyle: React.CSSProperties = {
  opacity: 0.5,
};

const langTagStyle: React.CSSProperties = {
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  opacity: 0.85,
};
