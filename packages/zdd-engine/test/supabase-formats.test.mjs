// The trial read (decision 0048 point 6): `supabase` claims `schema` only when
// its replay of the repo's migrations makes sense. Each sample below is
// hand-written in that tool's real shape, and each must come out read
// correctly or declined: never silently wrong. A decline leaves `schema`
// uncovered, which is what makes bootstrap offer to build.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { detectRepo } from "../src/core/lib/detect-repo.mjs";
import { catalogueModules } from "../src/core/derive.mjs";
import { makeExtractorIo } from "../src/core/lib/extractor-io.mjs";
import { derive } from "../src/adapters/supabase/index.mjs";

const modules = await catalogueModules();

const repo = (t, files) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-formats-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
};

// The proposal's own options through the adapter: what the repo would get.
function tablesRead(root, proposal) {
  const out = derive({ repoRoot: root, options: proposal.options, io: makeExtractorIo(root, "supabase") });
  assert.deepEqual(out.unread, [], "a claim made by the trial read reads clean");
  return Object.fromEntries(out.records.filter((r) => r.kind === "table").map((r) => [r.title.replace(/ \(.*$/, ""), r.facts.columns.map((c) => c.name)]));
}
function read(t, files) {
  const root = repo(t, files);
  const d = detectRepo(root, modules);
  const proposal = d.proposals.find((p) => p.name === "supabase");
  assert.ok(proposal, `expected a claim, got ${JSON.stringify(d.declined)}`);
  assert.deepEqual(d.coverage.find((c) => c.part === "schema").adapters, ["supabase"]);
  return tablesRead(root, proposal);
}
function declined(t, files, why) {
  const d = detectRepo(repo(t, files), modules);
  assert.ok(!d.proposals.some((p) => p.name === "supabase"), "no claim");
  assert.ok(d.uncovered.includes("schema"), "`schema` stays uncovered, so bootstrap offers to build");
  const said = d.declined.find((x) => x.name === "supabase");
  assert.deepEqual(said.parts, ["schema"]);
  assert.match(said.reasons.join(" | "), why);
}

// ---- Read ----

test("plain Postgres is read", (t) => {
  const tables = read(t, {
    "db/migrations/001_init.sql": "CREATE TABLE users (\n  id bigserial PRIMARY KEY,\n  email text NOT NULL\n);\nCREATE INDEX users_email ON users (email);\n",
    "db/migrations/002_people.sql": "ALTER TABLE users RENAME TO people;\nALTER TABLE people ADD COLUMN name text;\nDROP INDEX users_email;\n",
  });
  assert.deepEqual(tables, { people: ["id", "email", "name"] });
});

test("a SQLite rename is read", (t) => {
  const tables = read(t, {
    "migrations/0001_init.sql": "CREATE TABLE notes (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  body TEXT\n);\n",
    "migrations/0002_rename.sql": "ALTER TABLE notes RENAME TO memos;\nALTER TABLE memos RENAME COLUMN body TO text;\n",
  });
  assert.deepEqual(tables, { memos: ["id", "text"] });
});

test("a Supabase history is read: its reach into the tables the platform owns is no gap", (t) => {
  const tables = read(t, {
    "supabase/migrations/20240101000000_init.sql": `create table public.profiles (id uuid primary key references auth.users(id));
alter table public.profiles enable row level security;
drop policy if exists "own" on public.profiles;
create policy "own" on public.profiles for select using (auth.uid() = id);
create function public.handle_new_user() returns trigger language plpgsql security definer as $$ begin insert into public.profiles (id) values (new.id); return new; end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
insert into storage.buckets (id, name) values ('avatars', 'avatars');
create policy "read" on storage.objects for select using (bucket_id = 'avatars');
alter table storage.objects enable row level security;
alter publication supabase_realtime add table public.profiles;
`,
    "supabase/migrations/20240102000000_more.sql": "drop trigger if exists on_auth_user_created on auth.users;\nalter table auth.users add column if not exists nickname text;\n",
  });
  assert.deepEqual(tables, { "public.profiles": ["id"] });
});

test("golang-migrate is read: `.up.sql` applied, `.down.sql` never", (t) => {
  const tables = read(t, {
    "migrations/000001_create_users.up.sql": "CREATE TABLE IF NOT EXISTS users (id serial PRIMARY KEY, age int);\n",
    "migrations/000001_create_users.down.sql": "DROP TABLE IF EXISTS users;\n",
    "migrations/000002_rename.up.sql": "ALTER TABLE users RENAME TO people;\n",
    "migrations/000002_rename.down.sql": "ALTER TABLE people RENAME TO users;\n",
    "migrations/000003_age.up.sql": "ALTER TABLE people DROP COLUMN age;\n",
    "migrations/000003_age.down.sql": "ALTER TABLE people ADD COLUMN age int;\n",
  });
  assert.deepEqual(tables, { people: ["id"] });
});

test("Flyway is read: `V10` after `V9`, undo files never, repeatable ones last", (t) => {
  const tables = read(t, {
    "db/migrations/V1__init.sql": "CREATE TABLE orders (id INT PRIMARY KEY);\n",
    "db/migrations/V2__a.sql": "ALTER TABLE orders ADD COLUMN a int;\n",
    "db/migrations/V3__b.sql": "ALTER TABLE orders ADD COLUMN b int;\n",
    "db/migrations/V4__c.sql": "ALTER TABLE orders ADD COLUMN c int;\n",
    "db/migrations/V5__d.sql": "ALTER TABLE orders ADD COLUMN d int;\n",
    "db/migrations/V6__e.sql": "ALTER TABLE orders ADD COLUMN e int;\n",
    "db/migrations/V7__f.sql": "ALTER TABLE orders ADD COLUMN f int;\n",
    "db/migrations/V8__g.sql": "ALTER TABLE orders ADD COLUMN g int;\n",
    "db/migrations/V9__h.sql": "ALTER TABLE orders ADD COLUMN h int;\n",
    "db/migrations/V10__rename.sql": "ALTER TABLE orders RENAME COLUMN h TO hh;\n",
    "db/migrations/U10__rename.sql": "ALTER TABLE orders RENAME COLUMN hh TO h;\n",
    "db/migrations/R__view.sql": "CREATE OR REPLACE VIEW v AS SELECT 1;\n",
  });
  assert.deepEqual(tables, { orders: ["id", "a", "b", "c", "d", "e", "f", "g", "hh"] });
});

test("Flyway's own folder, `db/migration`, is not a migrations folder here: nothing claimed, nothing wrong", (t) => {
  const d = detectRepo(repo(t, { "src/main/resources/db/migration/V1__init.sql": "CREATE TABLE orders (id INT PRIMARY KEY);\n" }), modules);
  assert.ok(d.uncovered.includes("schema"));
  assert.deepEqual(d.declined, []);
});

test("MySQL with no quoting and no MySQL-only statement is read", (t) => {
  const tables = read(t, { "migrations/001_init.sql": "CREATE TABLE users (\n  id INT AUTO_INCREMENT PRIMARY KEY,\n  email VARCHAR(255)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n" });
  assert.deepEqual(tables, { users: ["id", "email"] });
});

// ---- Declined ----

const PRISMA = {
  "prisma/migrations/migration_lock.toml": 'provider = "postgresql"\n',
  "prisma/migrations/20240101120000_init/migration.sql": `-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
`,
  "prisma/migrations/20240201120000_add_name/migration.sql": `-- AlterTable
ALTER TABLE "User" ADD COLUMN     "name" TEXT;
`,
};

test("Prisma, a folder per migration, is declined: however many there are", (t) => {
  declined(t, PRISMA, /a folder per migration/);
  const one = { "prisma/migrations/migration_lock.toml": PRISMA["prisma/migrations/migration_lock.toml"], "prisma/migrations/20240101120000_init/migration.sql": PRISMA["prisma/migrations/20240101120000_init/migration.sql"] };
  declined(t, one, /a folder per migration/);
});

test("the same with an up and a down in each folder", (t) => {
  declined(t, {
    "migrations/2024-01-01-000000_create_users/up.sql": "CREATE TABLE users (id serial primary key);\n",
    "migrations/2024-01-01-000000_create_users/down.sql": "DROP TABLE users;\n",
  }, /a folder per migration/);
});

test("Prisma's quoted names themselves are read, in a folder of files", (t) => {
  const tables = read(t, { "db/migrations/001.sql": 'CREATE TABLE "public"."User" ("id" SERIAL NOT NULL, CONSTRAINT "User_pkey" PRIMARY KEY ("id"));\n', "db/migrations/002.sql": 'ALTER TABLE "public"."User" ADD COLUMN     "name" TEXT;\n' });
  assert.deepEqual(tables, { "public.User": ["id", "name"] });
});

test("goose: an up and a down in one file are declined, with no tables left and with some", (t) => {
  const first = "-- +goose Up\n-- +goose StatementBegin\nCREATE TABLE users (\n  id bigserial PRIMARY KEY\n);\n-- +goose StatementEnd\n\n-- +goose Down\n-- +goose StatementBegin\nDROP TABLE users;\n-- +goose StatementEnd\n";
  declined(t, { "db/migrations/00001_create_users.sql": first }, /undo/);
  declined(t, {
    "db/migrations/00001_create_users.sql": "-- +goose Up\nCREATE TABLE users (id bigserial PRIMARY KEY);\n\n-- +goose Down\n",
    "db/migrations/00002_add_email.sql": "-- +goose Up\nALTER TABLE users ADD COLUMN email text;\n\n-- +goose Down\nALTER TABLE users DROP COLUMN email;\n",
  }, /undo/);
  declined(t, {
    "db/migrations/00001_create_users.sql": "-- +goose Up\nCREATE TABLE users (id bigserial PRIMARY KEY);\n\n-- +goose Down\n",
    "db/migrations/00002_rename.sql": "-- +goose Up\nALTER TABLE users RENAME TO people;\n\n-- +goose Down\nALTER TABLE people RENAME TO users;\n",
  }, /undo/);
});

test("dbmate: the same two sections, declined", (t) => {
  declined(t, {
    "db/migrations/20240101120000_create_users.sql": "-- migrate:up\ncreate table users (\n  id integer primary key\n);\n\n-- migrate:down\ndrop table users;\n",
    "db/migrations/20240102120000_create_posts.sql": "-- migrate:up\ncreate table posts (\n  id integer primary key\n);\n\n-- migrate:down\ndrop table posts;\n",
  }, /undo/);
});

test("MySQL backticks are declined", (t) => {
  declined(t, { "migrations/001_init.sql": "CREATE TABLE `users` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `email` varchar(255) DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n" }, /cannot read/);
  declined(t, { "migrations/001_init.sql": "CREATE TABLE users (\n  `id` int NOT NULL\n);\n" }, /cannot read/);
});

test("MySQL's own changes are declined: MODIFY, CHANGE, ADD INDEX, RENAME TABLE", (t) => {
  for (const change of ["ALTER TABLE users MODIFY COLUMN email text", "ALTER TABLE users CHANGE email mail text", "ALTER TABLE users ADD INDEX idx_email (email)", "RENAME TABLE users TO people"]) {
    declined(t, { "migrations/001.sql": "CREATE TABLE users (id INT, email VARCHAR(255));\n", "migrations/002.sql": `${change};\n` }, /cannot read/);
  }
});

test("SQL Server is declined: brackets, batch separators, sp_rename", (t) => {
  declined(t, { "migrations/001_init.sql": "CREATE TABLE [dbo].[Users] (\n    [Id] INT IDENTITY (1, 1) NOT NULL,\n    CONSTRAINT [PK_Users] PRIMARY KEY CLUSTERED ([Id] ASC)\n);\nGO\n" }, /cannot read/);
  declined(t, { "migrations/001_init.sql": "CREATE TABLE dbo.Users (Id INT NOT NULL)\nGO\nCREATE TABLE dbo.Orders (Id INT NOT NULL)\nGO\n" }, /cannot read/);
  declined(t, { "migrations/001.sql": "CREATE TABLE dbo.Users (Id INT NOT NULL);\n", "migrations/002.sql": "EXEC sp_rename 'dbo.Users', 'People';\n" }, /cannot read/);
});

test("a change to a table the files never create is declined, and said so", (t) => {
  declined(t, { "migrations/001_later.sql": "ALTER TABLE users ADD COLUMN email text;\n" }, /a table they never create/);
  declined(t, { "migrations/001.sql": "CREATE TABLE a (id int);\nDROP TABLE users;\n" }, /a table they never create/);
});

test("files that create tables and end with none are declined", (t) => {
  declined(t, { "migrations/001.sql": "CREATE TABLE a (id int);\n", "migrations/002.sql": "DROP TABLE a;\n" }, /end with none/);
});

test("a file the trial cannot read is declined", (t) => {
  declined(t, { "migrations/001.sql": `-- ${"x".repeat(1024 * 1024 + 1)}\n` }, /could not read/);
});

test("two folders making one table are declined: derive would stop on it", (t) => {
  declined(t, { "a/migrations/001.sql": "CREATE TABLE users (id int);\n", "b/migrations/001.sql": "CREATE TABLE public.users (id int);\n" }, /two folders/);
});

test("one folder's bad read declines the claim: `schema` is a claim on the whole repo", (t) => {
  declined(t, { "supabase/migrations/001.sql": "create table a (id int);\n", "legacy/migrations/001.sql": "CREATE TABLE `b` (`id` int);\n" }, /legacy\/migrations/);
});

test("a nested folder of files beside a history is a second database, as it was", (t) => {
  const tables = read(t, { "migrations/001.sql": "create table a (id int);\n", "migrations/media/001.sql": "create table b (id int);\n" });
  assert.deepEqual(Object.keys(tables).sort(), ["a", "b"]);
});

test("the evidence counts the files applied", (t) => {
  const d = detectRepo(repo(t, { "migrations/1.up.sql": "create table a (id int);\n", "migrations/1.down.sql": "drop table a;\n" }), modules);
  assert.deepEqual(d.proposals.find((p) => p.name === "supabase").evidence, ["SQL migrations under `migrations` (1 file)"]);
});

test("a folder holding only undo steps is no history: nothing claimed, nothing declined", (t) => {
  const d = detectRepo(repo(t, { "migrations/1.down.sql": "drop table a;\n" }), modules);
  assert.ok(!d.proposals.some((p) => p.name === "supabase"));
  assert.deepEqual(d.declined, []);
});

test("migrations that hold no table at all are no contradiction", (t) => {
  assert.deepEqual(read(t, { "migrations/001_seed.sql": "insert into things (a) values (1);\n" }), {});
});

// ---- Other claimers ----

test("SQLAlchemy with no schema reader: `queries` covered, `schema` uncovered", (t) => {
  const d = detectRepo(repo(t, { "requirements.txt": "sqlalchemy==2.0\n", "app/db.py": "from sqlalchemy import text\nrows = session.execute(text('select * from things'))\n" }), modules);
  assert.deepEqual(d.coverage.find((c) => c.part === "queries").adapters, ["sqlalchemy"]);
  assert.deepEqual(d.coverage.find((c) => c.part === "schema").adapters, []);
  assert.ok(d.uncovered.includes("schema"));
});

test("SQLAlchemy beside migrations the trial declines: `schema` is uncovered there too", (t) => {
  const d = detectRepo(repo(t, { "requirements.txt": "sqlalchemy==2.0\n", "migrations/001.sql": "CREATE TABLE `users` (`id` int);\n" }), modules);
  assert.deepEqual(d.coverage.find((c) => c.part === "schema").adapters, []);
});

test("no adapter that reads queries also claims schema", () => {
  const both = modules.filter(({ mod }) => mod.DETECTION?.parts.includes("queries") && mod.DETECTION.parts.includes("schema"));
  assert.deepEqual(both.map((m) => m.name), []);
  const schema = modules.filter(({ mod }) => mod.DETECTION?.parts.includes("schema")).map((m) => m.name);
  assert.deepEqual(schema, ["supabase"]);
});
