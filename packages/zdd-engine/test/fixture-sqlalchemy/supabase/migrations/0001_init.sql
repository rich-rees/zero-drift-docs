-- Jobs moved from a publisher to a destination.
create table jobs (
  id uuid primary key,
  status text not null,
  created_at timestamptz not null default now()
);
-- What happened to a job, written in the same transaction as the change.
create table public.job_events (
  id uuid primary key,
  job_id uuid not null references jobs(id)
);
-- Offers made against jobs.
create table offers (
  id uuid primary key,
  job_id uuid not null references jobs(id)
);
