create table jobs (id uuid primary key, status text, deliver_by timestamptz);
create table audit_events (id bigserial primary key, job_id uuid, kind text);
create table outbound_messages (id bigserial primary key);
create table reports (day date, total int);
