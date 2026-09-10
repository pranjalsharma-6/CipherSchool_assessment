import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { api } from './api/client';
import type { Health } from './api/types';
import { ProblemsPage } from './pages/ProblemsPage';
import { ProblemPage } from './pages/ProblemPage';
import { AttemptPage } from './pages/AttemptPage';
import { HistoryPage } from './pages/HistoryPage';
import { Badge } from './components/primitives';

export function App() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <Link className="brand" to="/">
          <span className="brand-mark">◇</span>
          DesignDojo
        </Link>
        <nav className="nav">
          <NavLink to="/" end>
            Problems
          </NavLink>
          <NavLink to="/history">Progress</NavLink>
        </nav>
        <div className="topbar-right">
          {health && (
            <>
              {/* The reviewer is named in the UI so a simulated review is never
                  mistaken for a real one. */}
              <Badge kind={health.reviewer.simulated ? 'warn' : 'accent'}>
                {health.reviewer.modelId === null
                  ? 'rules only'
                  : health.reviewer.simulated
                    ? 'offline reviewer'
                    : health.reviewer.modelId}
              </Badge>
              <span className="small faint mono">{health.storage}</span>
            </>
          )}
        </div>
      </header>

      <Routes>
        <Route path="/" element={<ProblemsPage />} />
        <Route path="/problems/:slug" element={<ProblemPage />} />
        <Route path="/attempts/:id" element={<AttemptPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route
          path="*"
          element={
            <div className="page page-narrow">
              <div className="empty">
                That page does not exist. <Link to="/">Back to problems</Link>
              </div>
            </div>
          }
        />
      </Routes>
    </div>
  );
}
