import { Routes, Route, Link } from "react-router-dom";
import ProjectList from "./pages/ProjectList";
import ProjectDetail from "./pages/ProjectDetail";

export default function App() {
  return (
    <div className="app">
      <div className="header">
        <h1>
          <Link to="/" style={{ color: "inherit" }}>Recorder</Link>
        </h1>
        <span className="muted">Projects · Recordings · Notes · Summaries</span>
      </div>
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="/p/:projectId" element={<ProjectDetail />} />
      </Routes>
    </div>
  );
}
