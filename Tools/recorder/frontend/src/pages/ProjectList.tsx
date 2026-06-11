import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Project } from "../lib/api";

export default function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState("");

  const load = () => api.listProjects().then(setProjects).catch((e) => setErr(String(e)));
  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.createProject(name.trim(), desc.trim());
      setName(""); setDesc("");
      load();
    } catch (e) { setErr(String(e)); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this project and everything in it?")) return;
    await api.deleteProject(id);
    load();
  };

  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>New project</h3>
        <form onSubmit={create}>
          <div className="row" style={{ marginBottom: 8 }}>
            <input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="row" style={{ marginBottom: 8 }}>
            <input placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <button className="primary" type="submit">Create</button>
        </form>
      </div>

      {err && <div className="card" style={{ borderColor: "var(--danger)" }}>{err}</div>}

      <div className="list">
        {projects.length === 0 && <div className="muted">No projects yet.</div>}
        {projects.map((p) => (
          <Link key={p.id} to={`/p/${p.id}`} className="proj-card">
            <div>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div className="muted">{p.description || "—"}</div>
            </div>
            <div className="row">
              <span className="muted">{new Date(p.created_at).toLocaleDateString()}</span>
              <button className="danger" onClick={(e) => { e.preventDefault(); remove(p.id); }}>Delete</button>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
