import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RoomList } from '../components/RoomList';
import { RoomForm } from '../components/RoomForm';
import { useRooms } from '../hooks/useRooms';

export function Lobby() {
  const navigate      = useNavigate();
  const { rooms, loading, error, deleteRoom } = useRooms();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleJoin = (roomId: string, language?: string) => {
    navigate(`/room/${encodeURIComponent(roomId)}`, { state: { language } });
  };

  const handleDelete = async (roomId: string) => {
    setDeleteError(null);
    const errorMsg = await deleteRoom(roomId);
    if (errorMsg) setDeleteError(errorMsg);
  };

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        {/* Header */}
        <h1 style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: 600, color: '#e0e0e0' }}>
          Collaborative Code Editor
        </h1>
        <p style={{ margin: '0 0 28px', fontSize: '13px', color: '#666' }}>
          Real-time editing powered by CRDTs · changes persist automatically
        </p>

        {/* Room list */}
        {loading ? (
          <p style={{ color: '#666', fontSize: '14px', textAlign: 'center', padding: '16px 0' }}>
            Loading rooms…
          </p>
        ) : error ? (
          <p style={{ color: '#f48771', fontSize: '13px', marginBottom: '16px' }}>{error}</p>
        ) : (
          <>
            {deleteError && (
              <p style={{ color: '#f48771', fontSize: '12px', marginBottom: '10px' }}>
                {deleteError}
              </p>
            )}
            <RoomList rooms={rooms} onJoin={handleJoin} onDelete={handleDelete} />
          </>
        )}

        {/* Divider */}
        <div style={dividerStyle} />

        {/* Create / join by name */}
        <p style={labelStyle}>Create or join by name</p>
        <RoomForm onJoin={handleJoin} />
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  minHeight: '100vh',
  backgroundColor: '#1e1e1e',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px 16px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '520px',
};

const dividerStyle: React.CSSProperties = {
  borderTop: '1px solid #333',
  margin: '24px 0 20px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: '#666',
  marginBottom: '10px',
};
