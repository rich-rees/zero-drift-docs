-- The nightly digest, run by pg_cron.
create function public.send_digest() returns void language sql as $$ select 1 $$;
select cron.schedule('nightly-digest', '0 3 * * *', $$select public.send_digest()$$);
