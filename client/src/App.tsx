import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Lobby }      from './pages/Lobby';
import { EditorPage } from './pages/EditorPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"             element={<Lobby />}      />
        <Route path="/room/:roomId" element={<EditorPage />} />
        {/* Catch-all → redirect to lobby */}
        <Route path="*"             element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
