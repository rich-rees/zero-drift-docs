-- Jobs posted by organisations.
create table jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null
);
-- Offers made against jobs.
create table offers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade
);
