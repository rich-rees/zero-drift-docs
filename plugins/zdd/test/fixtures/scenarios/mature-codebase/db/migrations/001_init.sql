create table vehicles (id uuid primary key, plate text, last_seen timestamptz, archived boolean default false);
create table drivers (id uuid primary key, name text);
