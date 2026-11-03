-- the widget catalogue
create table widgets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  updated_at timestamptz
);

-- append-only audit trail
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references widgets(id) on delete cascade,
  note text
);

-- touch updated_at on every write
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_widgets_updated
  before update on widgets
  for each row execute function set_updated_at();
