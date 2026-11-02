// Tokenizer + replay engine unit tests (inline fixtures).
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import * as sqlReplay from "../src/adapters/supabase/sql-replay.mjs";

const { tokenizeSql, replayMigrations, sortMigrations, commentsToDescription } = sqlReplay;

test("tokenizer: semicolons inside dollar-quoted bodies do not split", () => {
  const sql = `create function f() returns void language plpgsql as $$\nbegin\n delete from x; update y set z=1;\nend;\n$$;\nselect 1;`;
  const stmts = tokenizeSql(sql);
  assert.equal(stmts.length, 2);
  assert.match(stmts[0].sql, /update y set z=1;/);
});

test("tokenizer: string literals with '' escapes and comments", () => {
  const sql = `-- leading note\ninsert into t values ('a;b', 'it''s');\n/* block; comment */\nselect 1;`;
  const stmts = tokenizeSql(sql);
  assert.equal(stmts.length, 2);
  assert.deepEqual(stmts[0].leadingComments, [" leading note"]);
  assert.match(stmts[0].sql, /'it''s'/);
});

test("tokenizer: tagged dollar quotes", () => {
  const stmts = tokenizeSql(`create function g() as $body$ x; y $body$;`);
  assert.equal(stmts.length, 1);
  assert.match(stmts[0].sql, /\$body\$ x; y \$body\$/);
});

test("commentsToDescription drops banners and path echoes", () => {
  assert.equal(
    commentsToDescription([" ============", " supabase/migrations/00001_x.sql", " real prose", " ============"]),
    "real prose",
  );
});

const SERIES = [
  {
    name: "00001_base.sql",
    text: `
-- the parent table
create table parents (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('a','b')),
  born_at timestamp with time zone
);
create table children (
  id uuid primary key,
  parent_id uuid not null references parents(id) on delete cascade,
  doomed text
);
create table victims ( id uuid primary key );
create or replace function save_stuff(p_id uuid, p_nodes jsonb)
returns void language plpgsql as $$ begin delete from children where parent_id = p_id; end; $$;
`,
  },
  {
    name: "00002_mutate.sql",
    text: `
alter table parents rename to guardians;
alter table children rename column parent_id to guardian_id;
alter table children add column if not exists nickname text default 'x';
alter table children drop column doomed;
drop table victims;
drop function if exists save_stuff(uuid, jsonb);
create or replace function save_stuff(p_id uuid, p_nodes jsonb, p_extra jsonb default null)
returns void language plpgsql as $$ begin delete from children where guardian_id = p_id; end; $$;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pics', 'pics', true, 1024, ARRAY['image/png','image/jpeg'])
on conflict (id) do nothing;
`,
  },
];

test("replay: renames, drops, adds, FK sweep, function last-wins, bucket facts", () => {
  const { tables, functions, buckets, skipped } = replayMigrations(SERIES);

  assert.deepEqual([...tables.keys()].sort(), ["children", "guardians"]);
  const g = tables.get("guardians");
  assert.deepEqual(g.renamedFrom, ["parents"]);
  assert.equal(g.columns.find((c) => c.name === "born_at").type, "timestamp with time zone");

  const c = tables.get("children");
  const fk = c.columns.find((col) => col.name === "guardian_id");
  // Rename swept the FK reference from parents(id) to guardians(id).
  assert.equal(fk.references, "guardians(id)");
  assert.ok(c.columns.some((col) => col.name === "nickname"));
  assert.ok(!c.columns.some((col) => col.name === "doomed"));

  const f = functions.get("save_stuff");
  assert.match(f.signature, /p_extra jsonb default null/);
  // The explicit DROP before the recreate resets provenance: the current
  // definition comes wholly from 00002. (CREATE OR REPLACE without a drop
  // accumulates — covered below.)
  assert.deepEqual(f.resources, ["00002_mutate.sql"]);

  const b = buckets.get("pics");
  assert.equal(b.facts.public, true);
  assert.equal(b.facts.fileSizeLimit, 1024);
  assert.deepEqual(b.facts.allowedMimeTypes, ["image/png", "image/jpeg"]);

  assert.deepEqual(skipped, []);
});

test("replay: CREATE OR REPLACE without a drop accumulates resources", () => {
  const { functions } = replayMigrations([
    { name: "1.sql", text: "create or replace function f() returns void language sql as $$ select 1 $$;" },
    { name: "2.sql", text: "create or replace function f(x int) returns void language sql as $$ select x $$;" },
  ]);
  const f = functions.get("f");
  assert.deepEqual(f.resources, ["1.sql", "2.sql"]);
  assert.match(f.signature, /x int/); // last definition wins
});

test("replay: dropped-then-recreated table survives as the new shape", () => {
  const { tables } = replayMigrations([
    { name: "1.sql", text: "create table t (a int);" },
    { name: "2.sql", text: "drop table t; create table t (b text);" },
  ]);
  assert.deepEqual(tables.get("t").columns.map((c) => c.name), ["b"]);
});

test("sortMigrations: numeric prefix first, timestamp file lands last", () => {
  const names = ["00010_b.sql", "00002_a.sql", "20260412000003_z.sql", "00009_r.sql"];
  assert.deepEqual(sortMigrations(names), ["00002_a.sql", "00009_r.sql", "00010_b.sql", "20260412000003_z.sql"]);
});

test("replay: CREATE TRIGGER attaches functions to tables through renames and drops", () => {
  const { triggers } = replayMigrations([
    {
      name: "1.sql",
      text: `
create table video_assets (id uuid primary key, updated_at timestamptz);
create table doomed_t (id uuid primary key);
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger trg_video_assets_updated
  before update
  on video_assets
  for each row
  execute function set_updated_at();
create trigger trg_doomed before insert or update on doomed_t
  for each row execute procedure set_updated_at();
`,
    },
    {
      name: "2.sql",
      text: `
alter table video_assets rename to media_assets;
drop table doomed_t;
`,
    },
  ]);
  // The doomed table took its trigger with it; the rename swept the survivor.
  assert.equal(triggers.length, 1);
  assert.deepEqual(triggers[0], {
    name: "trg_video_assets_updated",
    timing: "before",
    events: ["update"],
    table: "media_assets",
    fn: "set_updated_at",
  });
});

test("replay: DROP TRIGGER and DROP FUNCTION both detach triggers", () => {
  const base = `
create table t (id int);
create function f() returns trigger language plpgsql as $$ begin return new; end; $$;
create trigger tr before update on t for each row execute function f();
`;
  const dropped = replayMigrations([
    { name: "1.sql", text: base },
    { name: "2.sql", text: "drop trigger tr on t;" },
  ]);
  assert.equal(dropped.triggers.length, 0);
  const fnGone = replayMigrations([
    { name: "1.sql", text: base },
    { name: "2.sql", text: "drop function if exists f();" },
  ]);
  assert.equal(fnGone.triggers.length, 0);
});

test("replay: re-running the same CREATE TRIGGER replaces, not duplicates", () => {
  const stmt = "create table t (id int); create function f() returns trigger language sql as $$ select 1 $$; create trigger tr before update on t for each row execute function f();";
  const { triggers } = replayMigrations([
    { name: "1.sql", text: stmt },
    { name: "2.sql", text: "create or replace trigger tr after insert on t for each row execute function f();" },
  ]);
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].timing, "after");
  assert.deepEqual(triggers[0].events, ["insert"]);
});

test("replay tripwire: a change to a table the history never made is reported, and says so; DROP INDEX changes no table", () => {
  const { skipped } = replayMigrations([
    { name: "x.sql", text: "alter table nosuch add column a int; drop index idx_x; drop index if exists public.idx_y;" },
  ]);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].statement, /alter table nosuch/i);
  assert.equal(skipped[0].unseen, true);
});

test("replay: `things` and `public.things` are one table — an ALTER, RENAME, DROP or trigger in the other spelling still lands; the name stays as first written (2.1.1, the first adopter's member_topics / test_runs)", () => {
  const byName = (tables) => new Map([...tables.values()].map((t) => [t.name, t]));
  const qualifiedFirst = byName(replayMigrations([
    { name: "1.sql", text: "create table public.things (id uuid primary key);\ncreate table public.other (id uuid);" },
    { name: "2.sql", text: "alter table things add column name text;\nalter table only public.things add column size int;\nalter table things rename column name to label;" },
  ]).tables);
  assert.deepEqual([...qualifiedFirst.keys()].sort(), ["public.other", "public.things"]);
  assert.deepEqual(qualifiedFirst.get("public.things").columns.map((c) => c.name), ["id", "label", "size"]);
  assert.deepEqual(qualifiedFirst.get("public.things").resources, ["1.sql", "2.sql"]);

  const bareFirst = replayMigrations([
    { name: "1.sql", text: "create table member_topics (id uuid primary key);\ncreate table kids (id uuid, topic_id uuid references public.member_topics(id));\ncreate or replace function touch() returns trigger language plpgsql as $$ begin return new; end; $$;\ncreate trigger trg_touch before update on public.member_topics for each row execute function touch();" },
    { name: "2.sql", text: "alter table public.member_topics add column title text;\nalter table public.member_topics rename to topics;" },
  ]);
  const t = byName(bareFirst.tables);
  assert.deepEqual([...t.keys()].sort(), ["kids", "topics"]);
  assert.deepEqual(t.get("topics").columns.map((c) => c.name), ["id", "title"]);
  assert.deepEqual(t.get("topics").renamedFrom, ["member_topics"]);
  assert.equal(t.get("kids").columns.find((c) => c.name === "topic_id").references, "topics(id)", "the FK follows a rename spelled the other way");
  assert.deepEqual(bareFirst.triggers.map((x) => x.table), ["topics"], "the trigger follows it too");

  const dropped = replayMigrations([
    { name: "1.sql", text: "create table gone (id uuid);\ncreate or replace function f() returns trigger language plpgsql as $$ begin return new; end; $$;\ncreate trigger trg_f after insert on gone for each row execute function f();" },
    { name: "2.sql", text: "drop trigger trg_f on public.gone;\ndrop table public.gone;" },
  ]);
  assert.equal(dropped.tables.size, 0);
  assert.deepEqual(dropped.triggers, []);

  const otherSchema = byName(replayMigrations([{ name: "1.sql", text: "create table archive.things (id uuid);\ncreate table things (id uuid);\nalter table things add column x int;" }]).tables);
  assert.deepEqual([...otherSchema.keys()].sort(), ["archive.things", "things"], "a schema other than public is another table");
  assert.deepEqual(otherSchema.get("archive.things").columns.map((c) => c.name), ["id"]);
});

test("replay: CREATE TABLE IF NOT EXISTS under either spelling of an existing table is a no-op, as in Postgres — the first table, its name and its provenance stay (2.1.1 CR-001)", () => {
  for (const [first, second] of [["things", "public.things"], ["public.things", "things"], ["things", "things"]]) {
    const [t, ...rest] = [...replayMigrations([
      { name: "1.sql", text: `-- The real one.\ncreate table ${first} (id uuid, kept text);` },
      { name: "2.sql", text: `create table if not exists ${second} (id uuid, other text);` },
    ]).tables.values()];
    assert.equal(rest.length, 0);
    assert.equal(t.name, first, `${first} then ${second}`);
    assert.deepEqual(t.columns.map((c) => c.name), ["id", "kept"]);
    assert.equal(t.createdIn, "1.sql");
    assert.equal(t.description, "The real one.");
  }
});

test("replay: CREATE OR REPLACE TRIGGER replaces across `x` / `public.x` (2.1.1 CR-011)", () => {
  const { triggers } = replayMigrations([{ name: "1.sql", text: "create table things (id uuid);\ncreate or replace function f() returns trigger language plpgsql as $$ begin return new; end; $$;\ncreate trigger trg after insert on things for each row execute function f();\ncreate or replace trigger trg before update on public.things for each row execute function f();" }]);
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].timing, "before");
});

// ---- ZDD-11 slice 2 (decision 0048): each of these changed nothing and said nothing on 0.13.0 ----

const FN = (name) => `create or replace function ${name}() returns trigger language plpgsql as $$ begin return new; end; $$;`;

test("replay: ALTER FUNCTION … RENAME TO moves the record and its triggers, keeps where it came from", () => {
  const { functions, triggers, skipped } = replayMigrations([
    { name: "1.sql", text: `create table t (id int);\n${FN("touch")}\ncreate trigger tr before update on t for each row execute function touch();` },
    { name: "2.sql", text: "alter function touch() rename to stamp;" },
  ]);
  assert.deepEqual([...functions.keys()], ["stamp"]);
  const f = functions.get("stamp");
  assert.equal(f.name, "stamp");
  assert.deepEqual(f.renamedFrom, ["touch"]);
  assert.deepEqual(f.resources, ["1.sql", "2.sql"]);
  assert.deepEqual(triggers.map((x) => x.fn), ["stamp"]);
  assert.deepEqual(skipped, []);
});

test("replay: ALTER PROCEDURE … RENAME TO, a procedure being a record like a function; signature or no signature, either spelling", () => {
  const { functions } = replayMigrations([
    { name: "1.sql", text: "create procedure public.tidy(a int, b text) language sql as $$ select 1 $$;\ncreate function bare() returns void language sql as $$ select 1 $$;" },
    { name: "2.sql", text: "alter procedure tidy(int, text) rename to sweep;\nalter function public.bare rename to plain;" },
  ]);
  assert.deepEqual([...functions.keys()].sort(), ["plain", "public.sweep"], "a rename stays in the record's schema, spelled as the record spells it");
});

test("replay: a later CREATE OR REPLACE of a renamed function keeps its history", () => {
  const { functions } = replayMigrations([
    { name: "1.sql", text: "create function f() returns void language sql as $$ select 1 $$;\nalter function f() rename to g;" },
    { name: "2.sql", text: "create or replace function g() returns int language sql as $$ select 2 $$;" },
  ]);
  assert.deepEqual(functions.get("g").renamedFrom, ["f"]);
  assert.equal(functions.get("g").returns, "int");
});

test("replay: ALTER … SET SCHEMA moves a table and a function, and what points at them follows", () => {
  const { tables, functions, triggers } = replayMigrations([
    { name: "1.sql", text: `create table things (id uuid primary key);\ncreate table kids (id uuid, thing uuid references things(id));\n${FN("touch")}\ncreate trigger tr before update on things for each row execute function touch();` },
    { name: "2.sql", text: "alter table things set schema archive;\nalter function touch() set schema archive;" },
  ]);
  assert.deepEqual([...tables.keys()].sort(), ["archive.things", "kids"]);
  assert.equal(tables.get("archive.things").name, "archive.things");
  assert.deepEqual(tables.get("archive.things").renamedFrom, ["things"]);
  assert.equal(tables.get("kids").columns[1].references, "archive.things(id)");
  assert.deepEqual(triggers.map((x) => [x.table, x.fn]), [["archive.things", "archive.touch"]]);
  assert.deepEqual([...functions.keys()], ["archive.touch"]);
});

test("replay: a rename stays in a schema other than public", () => {
  const { tables } = replayMigrations([{ name: "1.sql", text: "create table archive.things (id int);\nalter table archive.things rename to stuff;" }]);
  assert.deepEqual([...tables.keys()], ["archive.stuff"]);
});

test("replay: ALTER TABLE takes IF EXISTS and ONLY in either order, and the `*` Postgres allows", () => {
  for (const head of ["if exists only", "only if exists", "only", "if exists", ""]) {
    const { tables } = replayMigrations([{ name: "1.sql", text: `create table a (x int);\nalter table ${head} a rename to b;` }]);
    assert.deepEqual([...tables.keys()], ["b"], `alter table ${head}`);
  }
  assert.deepEqual([...replayMigrations([{ name: "1.sql", text: "create table a (x int);\nalter table only a * add column y int;" }]).tables.get("a").columns.map((c) => c.name)], ["x", "y"]);
});

test("replay: a column rename follows into the foreign keys that reference it, in either spelling, and no further", () => {
  const { tables } = replayMigrations([
    { name: "1.sql", text: "create table parents (id uuid primary key, code text);\ncreate table kids (id uuid, parent uuid references public.parents(id), other uuid references parents(code));\ncreate table strangers (id uuid, x uuid references kids(id));" },
    { name: "2.sql", text: "alter table parents rename column id to parent_id;" },
  ]);
  const refs = (t) => tables.get(t).columns.filter((c) => c.references).map((c) => c.references);
  assert.deepEqual(refs("kids"), ["public.parents(parent_id)", "parents(code)"]);
  assert.deepEqual(refs("strangers"), ["kids(id)"]);
});

test("replay: ALTER TABLE … DROP with no COLUMN word drops the column; a constraint or key stays out of it", () => {
  const { tables } = replayMigrations([{ name: "1.sql", text: "create table t (a int, b int, c int);\nalter table t drop b, drop constraint c, drop if exists a;" }]);
  assert.deepEqual(tables.get("t").columns.map((x) => x.name), ["c"]);
});

test("replay: a table name with a space, and qualified quoted names, are the names Postgres would see", () => {
  const { tables } = replayMigrations([{ name: "1.sql", text: 'create table "public"."User" ("id" text not null, "First Name" text);\ncreate table "My Table" (id int);\ncreate table kids (u text references "public"."User"("id"));\nalter table "public"."User" add column "Age" int;\nalter table public."My Table" rename to "Your Table";' }]);
  assert.deepEqual([...tables.keys()].sort(), ["User", "Your Table", "kids"]);
  assert.deepEqual(tables.get("User").columns.map((c) => c.name), ["id", "First Name", "Age"]);
  assert.equal(tables.get("kids").columns[0].references, "public.User(id)");
});

// ---- The tripwire (decision 0048 point 6): what the replay did not apply says so ----

const SKIPPED = (text, first = "") => replayMigrations([{ name: "1.sql", text: first }, { name: "2.sql", text }]).skipped.map((s) => s.text);

test("tripwire: ALTER, RENAME or DROP on a table the history never made", () => {
  for (const sql of ["alter table ghost rename to spirit", "alter table if exists ghost add column a int", "alter table ghost enable row level security", "alter table public.ghost set schema archive", "drop table ghost", "drop table t, ghost", "drop trigger tr on ghost", "alter function ghost() rename to spirit", "alter procedure ghost set schema archive"]) {
    assert.deepEqual(SKIPPED(sql, "create table t (id int);"), [sql], sql);
  }
});

test("tripwire: a table an app touches and does not own raises nothing, nor does a guarded drop of what never was", () => {
  const owned = ["alter table storage.objects enable row level security", "alter table auth.users add column a int", "drop trigger on_signup on auth.users", "drop trigger if exists tr on ghost", "drop table if exists ghost", "drop table storage.old", "alter function auth.uid() rename to whoami", "alter table realtime.messages enable row level security", "alter function ghost() owner to admin", "alter function ghost() set search_path = public"];
  for (const sql of owned) assert.deepEqual(SKIPPED(sql), [], sql);
});

test("tripwire: an ALTER TABLE action outside the list is reported once, what was read of the statement still applies", () => {
  const { tables, skipped } = replayMigrations([{ name: "1.sql", text: "create table t (a int);\nalter table t add column b int, modify c int, change d e int;" }]);
  assert.deepEqual(tables.get("t").columns.map((c) => c.name), ["a", "b"]);
  assert.equal(skipped.length, 1);
});

test("tripwire: a change the model cannot place — a column that is not there, or one added twice", () => {
  const first = "create table t (a int);";
  for (const sql of ["alter table t rename column nope to x", "alter table t alter column nope type text", "alter table t drop column nope", "alter table t add column a int"]) {
    assert.deepEqual(SKIPPED(sql, first), [sql], sql);
  }
  for (const sql of ["alter table t drop column if exists nope", "alter table t add column if not exists a int"]) assert.deepEqual(SKIPPED(sql, first), [], sql);
});

test("tripwire: everything ALTER TABLE does that the model holds nothing of stays quiet, on Postgres's list", () => {
  const first = "create table t (a int, b int);";
  for (const action of ["add constraint c unique (a)", "add primary key (a)", "add unique (a)", "add check (a > 0)", "add foreign key (a) references t (a)", "drop constraint c", "drop constraint if exists c cascade", "rename constraint c to d", "validate constraint c", "enable row level security", "disable row level security", "force row level security", "no force row level security", "enable trigger all", "owner to admin", "replica identity full", "alter column a set default 1", "alter column a drop default", "alter a set not null", "alter column a drop not null", "alter column a add generated always as identity", "set (fillfactor = 70)", "attach partition t2 for values from (1) to (2)"]) {
    assert.deepEqual(SKIPPED(`alter table t ${action}`, first), [], action);
  }
});

test("tripwire: statements of other shapes that change what the model holds", () => {
  for (const sql of ["alter schema billing rename to money", "drop schema billing cascade", "drop owned by someone", "rename table a to b", "exec sp_rename 'a', 'b'", "sp_rename 'a', 'b'", "create unlogged table u (a int)", "create foreign table u (a int) server s", "drop type mood cascade", "create trigger t before insert on x for each row set new.a = 1", "alter foreign table f add column a int", "create table `t` (`a` int)", "create table [t] ([a] int)", "create table t ([a] int)", "create table t (`a` int)"]) {
    assert.deepEqual(SKIPPED(sql), [sql], sql);
  }
});

test("tripwire: what the model deliberately leaves out stays quiet", () => {
  for (const sql of ["drop index concurrently if exists i", "drop policy if exists \"p\" on t", "drop view v", "drop materialized view v", "drop type mood", "drop extension if exists x", "drop sequence s", "create temp table u (a int)", "create temporary table u (a int)", "create index i on t (a)", "alter index i rename to j", "alter type mood add value 'x'", "alter default privileges grant select on tables to r", "alter publication p add table t"]) {
    assert.deepEqual(SKIPPED(sql), [], sql);
  }
});

test("tripwire: a table made some other way is in the replay, and what the read lacks is said", () => {
  const { tables, skipped } = replayMigrations([{ name: "1.sql", text: "create table base (a int);\ncreate table copy as select * from base;\ncreate table part partition of base for values from (1) to (2);\ncreate table kin (like base including all, b int);\ncreate table heir (b int) inherits (base);" }]);
  assert.deepEqual([...tables.keys()], ["base", "copy", "part", "kin", "heir"]);
  assert.equal(skipped.length, 4);
});

test("tripwire: statements a batch separator holds together are not read as one", () => {
  const { tables, skipped } = replayMigrations([{ name: "1.sql", text: "create table a (id int)\nGO\ncreate table b (id int)\nGO\n" }]);
  assert.equal(tables.size, 0);
  assert.equal(skipped.length, 1);
});

test("a DO block: a rename, an add, a drop or dynamic SQL in one is reported, never followed", () => {
  const first = "create table t (a int);";
  const block = (body) => `do $$ begin if true then ${body}; end if; end $$`;
  for (const body of ["alter table t rename to u", "alter table t rename column a to b", "alter table t add column b int", "alter table t set schema archive", "alter table t modify a text", "alter function f() rename to g", "alter procedure f() rename to g", "drop table t", "drop function f()", "create function f() returns void as 'x'", "execute 'alter table t rename to u'", "execute format('alter table %I rename to u', 't')", "execute cmd", "perform 1; execute 'select 1'"]) {
    assert.deepEqual(SKIPPED(block(body), first), [block(body)], body);
  }
  const { tables } = replayMigrations([{ name: "1.sql", text: first + block("alter table t rename to u") }]);
  assert.deepEqual([...tables.keys()], ["t"]);
});

test("a DO block: what the model holds nothing of stays quiet, comments and strings in it included", () => {
  const first = "create table t (a int);";
  for (const sql of ["do $$ begin if not exists (select 1 from pg_constraint where conname = 'c') then alter table t add constraint c unique (a); end if; end $$", "do $body$ begin alter table ghost add constraint c check (a > 0); end $body$", "do $$ begin -- alter table t rename to u\n raise notice 'rename'; end $$", "do language plpgsql $$ begin grant execute on function f() to r; revoke execute on function f() from r; grant all privileges on function f() to r; end $$", "do $$ begin create index i on t (a); drop index j; end $$", "do $$ begin perform 1; end $$"]) {
    assert.deepEqual(SKIPPED(sql, first), [], sql);
  }
});

test("a DO block: a guarded CREATE TABLE is answered when a plain statement makes the table, and reported when none does", () => {
  const block = "do $$ begin if not exists (select 1) then create table public.vocab (id int); alter table public.vocab disable row level security; end if; end $$;";
  assert.deepEqual(replayMigrations([{ name: "1.sql", text: block }, { name: "2.sql", text: "create table if not exists vocab (id int, code text);" }]).skipped, []);
  const alone = replayMigrations([{ name: "1.sql", text: block }]);
  assert.equal(alone.skipped.length, 1);
  assert.match(alone.skipped[0].text, /create table public\.vocab/);
});

test("appliedMigrations: undo steps in files of their own are never replayed; versions sort as versions", () => {
  const { appliedMigrations: applied } = sqlReplay;
  assert.deepEqual(applied(["2_b.up.sql", "1_a.down.sql", "1_a.up.sql", "2_b.down.sql", "10_c.up.sql", "10_c.down.sql"]), ["1_a.up.sql", "2_b.up.sql", "10_c.up.sql"]);
  assert.deepEqual(applied(["V10__j.sql", "V9__i.sql", "V1.2__b.sql", "V1.1__a.sql", "V1_10__c.sql", "U9__i.sql", "R__views.sql"]), ["V1.1__a.sql", "V1.2__b.sql", "V1_10__c.sql", "V9__i.sql", "V10__j.sql", "R__views.sql"]);
});

test("the replay marks what a file made and took away again in itself, and nothing else", () => {
  const undone = (...texts) => replayMigrations(texts.map((text, i) => ({ name: `${i}.sql`, text }))).undone.length;
  assert.equal(undone("create table t (a int); drop table t;"), 1);
  assert.equal(undone("create table t (a int);", "alter table t add column b int; alter table t drop column b;"), 1);
  assert.equal(undone("create table t (a int);", "alter table t rename to u; alter table u rename to t;"), 1);
  assert.equal(undone("create table t (a int);", "alter table t rename column a to b; alter table t rename column b to a;"), 1);
  assert.equal(undone("drop table if exists t; create table t (a int);"), 0, "drop then create is a forward step");
  assert.equal(undone("create table t (a int);", "alter table t rename to u;", "alter table u rename to t;"), 0, "two migrations are two steps");
  assert.equal(undone("create table t (a int);", "drop table t;"), 0);
});

// ---- Campaign CR-241 on ----

test("CR-242: an unquoted name may hold $ or a letter past ASCII, and is never cut short", () => {
  const { tables, functions, triggers } = replayMigrations([{ name: "1.sql", text: "create table foo$bar (id int);\ncreate table café (id int, b int references foo$bar(id));\ncreate function fn$x() returns trigger language plpgsql as $$ begin return new; end; $$;\ncreate trigger t before update on foo$bar for each row execute function fn$x();" }]);
  assert.deepEqual([...tables.keys()].sort(), ["café", "foo$bar"]);
  assert.equal(tables.get("café").columns[1].references, "foo$bar(id)");
  assert.deepEqual([...functions.keys()], ["fn$x"]);
  assert.deepEqual(triggers.map((x) => [x.table, x.fn]), [["foo$bar", "fn$x"]]);
});

test("CR-243: a quoted name holding a dot is no qualified name: reported, never folded into one", () => {
  for (const sql of ['create table "a.b" (x int)', 'create table "public.x" (x int)', 'alter table "a.b" rename to c', 'drop table "a.b"', 'create function "a.b"() returns void language sql as $$ select 1 $$', 'alter function "a.b"() rename to c', 'drop function "a.b"()', 'create trigger t before update on "a.b" for each row execute function f()', 'drop trigger t on "a.b"']) {
    assert.deepEqual(SKIPPED(sql), [sql], sql);
  }
  const { tables } = replayMigrations([{ name: "1.sql", text: 'create table "a.b" (x int);\ncreate table a.b (y int);' }]);
  assert.deepEqual([...tables.values()].map((t) => t.columns[0].name), ["y"]);
  assert.deepEqual(replayMigrations([{ name: "1.sql", text: 'create table t ("a.b" int);' }]).tables.get("t").columns.map((c) => c.name), ["a.b"], "a column has no qualifier to confuse");
});

test("CR-244: a change to a column that is not there trips, whichever kind of change", () => {
  const first = "create table t (a int);";
  for (const action of ["alter column ghost set default 1", "alter column ghost drop default", "alter ghost set not null", "alter column ghost drop not null", "alter column ghost add generated always as identity"]) {
    assert.deepEqual(SKIPPED("alter table t " + action, first), ["alter table t " + action], action);
  }
});

test("CR-245: DDL in a string in a DO block is text, unless it is executed", () => {
  const first = "create table t (a int);";
  for (const sql of ["do $$ begin raise notice 'alter table t rename to u'; end $$", "do $$ declare q text := 'drop table t'; begin perform 1; end $$", "do $$ begin raise notice $m$create table x (a int)$m$; end $$", "do $$ begin raise notice 'to execute later'; end $$"]) {
    assert.deepEqual(SKIPPED(sql, first), [], sql);
  }
  for (const sql of ["do $$ begin execute 'alter table t rename to u'; end $$", "do $$ begin execute $q$alter table t rename to u$q$; end $$", "do 'begin alter table t rename to u; end'", "do language plpgsql 'begin alter table t rename to u; end'"]) {
    assert.deepEqual(SKIPPED(sql, first), [sql], sql);
  }
});

test("CR-246: a comment between two words keeps them two", () => {
  for (const text of ["alter/* why */table t rename to u;", "alter-- why\ntable t rename to u;", "alter table/**/t rename to u;"]) {
    assert.deepEqual([...replayMigrations([{ name: "1.sql", text: "create table t (a int);\n" + text }]).tables.keys()], ["u"], text);
  }
});

test("CR-248: what a file changes and changes back is undone, in every part of the model", () => {
  const undone = (...texts) => replayMigrations(texts.map((text, i) => ({ name: i + ".sql", text }))).undone.length;
  const t = "create table t (a text);";
  const f = "create function f() returns void language sql as $$ select 1 $$;";
  assert.equal(undone(t, "alter table t alter column a type bigint; alter table t alter column a type text;"), 1);
  assert.equal(undone(t, "alter table t set schema archive; alter table archive.t set schema public;"), 1);
  assert.equal(undone(f, "alter function f() rename to g; alter function g() rename to f;"), 1);
  assert.equal(undone(f, "alter function f() set schema archive; alter function archive.f() set schema public;"), 1);
  assert.equal(undone(f + "drop function f();"), 1);
  assert.equal(undone(t + f + "create trigger tr before update on t for each row execute function f(); drop trigger tr on t;"), 1);
  assert.equal(undone(f + "alter function f() rename to g; drop function g();"), 1, "what a file made counts under its new name");
  assert.equal(undone("create table x (a int); alter table x rename to y; drop table y;"), 1);
  assert.equal(undone("create table x (a int); alter table x rename to y; alter table y rename to z; drop table if exists y;"), 0, "the old name is gone: a drop of it undoes nothing");
  assert.equal(undone(f + "alter function f() rename to g; alter function g() rename to h; drop function if exists g();"), 0);
  assert.equal(undone("create table x (a int); alter table x set schema archive; drop table archive.x;"), 1);
  assert.equal(undone(t, "alter table t add column b int; alter table t rename column b to c; alter table t drop column c;"), 1);
  assert.equal(undone(t, "alter table t add column b int; alter table t rename to u; alter table u drop column b;"), 1);
  assert.equal(undone(t, "alter table t alter column a type bigint;", "alter table t alter column a type text;"), 0, "two migrations are two steps");
  assert.equal(undone(f, "drop function f(); create function f() returns int language sql as $$ select 1 $$;"), 0, "drop then create is forward");
});

test("CR-249: a rename onto something that is there is reported, and nothing is lost", () => {
  const { tables, skipped } = replayMigrations([{ name: "1.sql", text: "create table a (x int);\ncreate table b (y int);\ncreate table archive.a (z int);\nalter table a rename to b;\nalter table a set schema archive;\nalter table a set schema public;" }]);
  assert.deepEqual(tables.get("b").columns.map((c) => c.name), ["y"]);
  assert.ok(tables.has("a"));
  assert.equal(skipped.length, 2);
  const col = replayMigrations([{ name: "1.sql", text: "create table t (a int, b int);\nalter table t rename column a to b;" }]);
  assert.deepEqual(col.tables.get("t").columns.map((c) => c.name), ["a", "b"]);
  assert.equal(col.skipped.length, 1);
});

test("CR-251: a DO block is held to what the top level holds: DROP TYPE CASCADE, and triggers", () => {
  const first = "create table t (a int);\ncreate function f() returns trigger language plpgsql as $$ begin return new; end; $$;";
  for (const sql of ["do $$ begin drop type mood cascade; end $$", "do $$ begin drop domain d cascade; end $$", "do $$ begin drop schema s cascade; end $$", "do $$ begin drop trigger tr on t; end $$", "do $$ begin create trigger tr before update on t for each row execute function f(); end $$"]) {
    assert.deepEqual(SKIPPED(sql, first), [sql], sql);
  }
  assert.deepEqual(SKIPPED("do $$ begin drop type mood; end $$", first), []);
  const answered = "do $$ begin create table v (id int); create trigger tr before update on v for each row execute function f(); end $$;";
  assert.deepEqual(replayMigrations([{ name: "1.sql", text: first + answered }, { name: "2.sql", text: "create table if not exists v (id int);\ncreate trigger tr before update on v for each row execute function f();" }]).skipped, []);
});

test("CR-254: a procedure's whole life: made, moved, dropped", () => {
  const { functions, skipped } = replayMigrations([{ name: "1.sql", text: "create procedure p() language sql as $$ select 1 $$;\nalter procedure p() set schema archive;" }, { name: "2.sql", text: "drop procedure archive.p();" }]);
  assert.equal(functions.size, 0);
  assert.deepEqual(skipped, []);
  assert.deepEqual([...replayMigrations([{ name: "1.sql", text: "create procedure p() language sql as $$ select 1 $$;\nalter procedure p() set schema archive;" }]).functions.keys()], ["archive.p"]);
});
