import { useParams, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { CollaborativeEditor } from '../components/CollaborativeEditor';

interface LocationState {
  language?: string;
}

export function EditorPage() {
  const { roomId }  = useParams<{ roomId: string }>();
  const navigate    = useNavigate();
  const location    = useLocation();

  if (!roomId) return <Navigate to="/" replace />;

  const decoded  = decodeURIComponent(roomId);
  // Only present if the user just picked a language in the lobby form.
  // Undefined if they joined an existing room or pasted a direct URL —
  // the server resolves the real language in either case.
  const { language } = (location.state as LocationState) ?? {};

  return (
    <div style={{ position: 'relative' }}>
      {/* Back to lobby */}
      <button
        onClick={() => navigate('/')}
        title="Back to lobby"
        style={{
          position: 'absolute',
          top: '4px',
          right: '10px',
          zIndex: 10,
          padding: '3px 10px',
          backgroundColor: 'transparent',
          color: 'rgba(255,255,255,0.6)',
          border: '1px solid rgba(255,255,255,0.25)',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '12px',
        }}
      >
        ← Lobby
      </button>
      <CollaborativeEditor roomId={decoded} requestedLanguage={language} />
    </div>
  );
}
