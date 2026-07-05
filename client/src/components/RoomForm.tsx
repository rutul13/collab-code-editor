import { useState } from 'react';
import { LANGUAGE_OPTIONS } from '../types';

interface Props {
  onJoin: (roomId: string, language: string) => void;
}

export function RoomForm({ onJoin }: Props) {
  const [name, setName]         = useState('');
  const [language, setLanguage] = useState('plaintext');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) {
      onJoin(trimmed, language);
      setName('');
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Room name…"
          style={{
            flex: 1,
            padding: '9px 12px',
            fontSize: '14px',
            backgroundColor: '#3c3c3c',
            border: '1px solid #555',
            borderRadius: '4px',
            color: '#e0e0e0',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={!name.trim()}
          style={{
            padding: '9px 18px',
            backgroundColor: name.trim() ? '#0e639c' : '#2a2a2a',
            color: name.trim() ? 'white' : '#666',
            border: 'none',
            borderRadius: '4px',
            fontSize: '14px',
            cursor: name.trim() ? 'pointer' : 'default',
            whiteSpace: 'nowrap',
            transition: 'background-color 0.15s',
          }}
        >
          Create / Join
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <label htmlFor="language-select" style={langLabelStyle}>
          Language (only applies if creating a new room):
        </label>
        <select
          id="language-select"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          style={selectStyle}
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </form>
  );
}

const langLabelStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#777',
  whiteSpace: 'nowrap',
};

const selectStyle: React.CSSProperties = {
  padding: '5px 8px',
  fontSize: '12px',
  backgroundColor: '#3c3c3c',
  border: '1px solid #555',
  borderRadius: '4px',
  color: '#e0e0e0',
  outline: 'none',
};
