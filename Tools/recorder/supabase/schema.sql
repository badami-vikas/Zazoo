-- Recorder Tool — Supabase schema
-- Run in the Supabase SQL editor (or via `psql`) on a fresh project.
-- Also create a private Storage bucket named `recordings` in the Supabase dashboard.

create extension if not exists "pgcrypto";

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text default '',
  created_at timestamptz not null default now()
);

create table if not exists recordings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  source_type text not null check (source_type in ('mic','upload','paste')),
  audio_storage_path text,
  transcript text,
  duration_seconds int,
  status text not null default 'pending' check (status in ('pending','transcribing','done','error')),
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists recordings_project_id_idx on recordings(project_id);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists notes_project_id_idx on notes(project_id);

create table if not exists summaries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  summary text not null,
  next_steps jsonb not null default '[]'::jsonb,
  scope text not null default 'project',
  llm_provider text,
  llm_model text,
  created_at timestamptz not null default now()
);
create index if not exists summaries_project_id_idx on summaries(project_id);
