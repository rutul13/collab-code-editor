// NOTE: `Room` is a TypeScript interface — it doesn't exist at runtime.
// Vite's dev server transpiles files one at a time (no full type-checking
// pass), so a plain `import { Room }` sometimes survives into the compiled
// output looking like a real value import, and the browser chokes with
// "does not provide an export named 'Room'". `import type` tells the
// bundler up front "this is erased at compile time, don't look for it
// at runtime" — avoids the whole class of bug.
import type { Room } from '../types';

interface Props {
  rooms: Room[];
  onJoin: (roomId: string) => void;
  onDelete: (roomId: string) => void;
}

export function RoomList({ rooms, onJoin, onDelete }: Props) {
  if (rooms.length === 0) {
    return (
      <p style={{ color: '#666', fontSize: '14px', textAlign: 'center', padding: '24px 0' }}>
        No open rooms yet — create one below.
      </p>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      <p style={labelStyle}>Open Rooms</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {rooms.map((room) => {
          const isEmpty = room.activeUsers === 0;

          const handleDeleteClick = () => {
            // Guard clause — the button shouldn't even render when the room
            // has active users, but this protects against stale UI state.
            if (!isEmpty) return;

            const confirmed = window.confirm(
              `Delete room "${room.id}" forever?\n\n` +
              `This permanently erases all of its contents and cannot be undone. ` +
              `If you want to keep any of the code in this room, copy it somewhere ` +
              `safe before deleting.`,
            );
            if (confirmed) onDelete(room.id);
          };

          return (
            <li key={room.id} style={rowStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* Live indicator */}
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: room.activeUsers > 0 ? '#4caf50' : '#555',
                    flexShrink: 0,
                  }}
                />
                <div>
                  <span style={{ color: '#e0e0e0', fontWeight: 500, fontSize: '14px' }}>
                    {room.id}
                  </span>
                  {room.language && (
                    <span style={langBadgeStyle}>{room.language}</span>
                  )}
                  <span style={{ color: '#888', fontSize: '12px', marginLeft: '10px' }}>
                    {room.activeUsers > 0
                      ? `${room.activeUsers} user${room.activeUsers !== 1 ? 's' : ''} active`
                      : 'No active users'}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                <button onClick={() => onJoin(room.id)} style={joinBtnStyle}>
                  Join
                </button>

                {isEmpty ? (
                  <button onClick={handleDeleteClick} style={deleteBtnStyle}>
                    Delete
                  </button>
                ) : (
                  <span style={lockedLabelStyle} title="Rooms with active users can't be deleted">
                    🔒 in use
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: '#666',
  marginBottom: '10px',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  backgroundColor: '#252526',
  borderRadius: '6px',
  border: '1px solid #3a3a3a',
};

const joinBtnStyle: React.CSSProperties = {
  padding: '5px 14px',
  backgroundColor: '#0e639c',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '13px',
  flexShrink: 0,
};

const deleteBtnStyle: React.CSSProperties = {
  padding: '5px 14px',
  backgroundColor: 'transparent',
  color: '#f48771',
  border: '1px solid #6e3a33',
  borderRadius: '4px',
  fontSize: '13px',
  cursor: 'pointer',
  flexShrink: 0,
};

const lockedLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#666',
  flexShrink: 0,
  whiteSpace: 'nowrap',
};

const langBadgeStyle: React.CSSProperties = {
  fontSize: '10px',
  color: '#9d9d9d',
  backgroundColor: '#333',
  border: '1px solid #444',
  borderRadius: '3px',
  padding: '1px 6px',
  marginLeft: '8px',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};
