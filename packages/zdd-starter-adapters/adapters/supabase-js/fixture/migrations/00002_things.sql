-- widgets become things (ADR-0002)
alter table widgets rename to things;
alter table audit_log rename column widget_id to thing_id;

-- save a thing and log the change
create or replace function save_thing(p_id uuid, p_title text)
returns void language plpgsql as $$
begin
  update things set title = p_title where id = p_id;
  insert into audit_log (thing_id, note) values (p_id, 'saved');
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', false, 5242880, ARRAY['image/png', 'image/jpeg'])
on conflict (id) do nothing;
