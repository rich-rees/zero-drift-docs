// Tokenizer + replay engine unit tests (inline fixtures).
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenizeSql, replayMigrations, sortMigrations, commentsToDescription } from "../src/adapters/nextjs-supabase/sql-replay.mjs";

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

test("replay tripwire: unrecognized schema-like statements are reported", () => {
  const { skipped } = replayMigrations([
    { name: "x.sql", text: "alter table nosuch add column a int; drop index idx_x;" },
  ]);
  // alter on unknown table is silently ignored (not ours); drop index trips.
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].statement, /drop index/i);
});
