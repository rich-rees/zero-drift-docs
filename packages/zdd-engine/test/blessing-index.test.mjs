// The blessing index (CAS-96; where and why since ZDD-1, decision 0031):
// one line per blessing in the store, house rules under their app first,
// then every other blessing by question. The builder on its own, then the
// fixture's index against its golden, render --check catching a stale or
// missing index, and the agent index's reading path naming it.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildBlessingIndex } from "../src/lib/blessing-index.mjs";
import { readBlessing } from "../src/lib/blessings.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");
const GOLDEN = join(PKG, "test", "golden");

const b = (id, header, text) => readBlessing(`---\n${header}\n---\n\n${text}\n`, id);
const PAGES = { "apps/web": { title: "Web", href: "map/apps/web.md" }, "packages/ui": { title: "UI", href: "map/packages/ui.md" } };
const opts = (users = () => null) => ({
  adrHref: (num) => (num === "0042" ? null : `adr/${num}-x.md`),
  blessingHref: (id) => `blessings/${id}.md`,
  mapPage: (id) => PAGES[id] ?? null,
  usersOf: users,
});

test("buildBlessingIndex: house rules under their app first, by app title; then every other blessing by question; where and why on every line", () => {
  const users = (bl) => (bl.id === "extending-a-client" ? [{ id: "s:/a", title: "/a" }, { id: "s:/b", title: "/b" }] : bl.id === "extending-unknown" ? null : []);
  const { text, count } = buildBlessingIndex(
    [
      b("writing-a-zeta", "where: src/z.ts\nkind: copy", "Writing a zeta? Copy z, per ADR-0003."),
      b("styling", "where: web/tokens.css\nkind: copy\napplies-to: apps/web\nadr: ADR-0001", "Styling anything? Use tokens, per ADR-0002."),
      b("reading-a-zeta", "where: src/r.ts (readZeta)\nkind: copy", "Reading a zeta? Copy r because reads are cached."),
      b("no-question", "where: src/b.ts\nkind: copy", "Copy b, per ADR-0042."),
      b("adding-a-component", "where: ui/Button.tsx (Button)\nkind: extend\napplies-to: packages/ui", "Adding a component? Extend Button, per ADR-0004."),
      b("extending-a-client", "where: lib/client.ts\nkind: extend", "Calling the API? Extend the client because it holds the auth."),
      b("extending-unknown", "where: lib/py.py\nkind: extend", "Parsing a file? Extend the parser because it is shared."),
      b("no-where", "kind: copy", "Adding an alpha? Copy a."),
    ],
    opts(users),
  );
  assert.equal(count, 8);
  assert.equal(
    text.slice(text.indexOf("## Applies to")),
    [
      "## Applies to [UI](map/packages/ui.md)",
      "",
      "- [Adding a component?](blessings/adding-a-component.md) — extend: `ui/Button.tsx` (Button), used by nothing ZDD sees · why: [ADR-0004](adr/0004-x.md)",
      "",
      "## Applies to [Web](map/apps/web.md)",
      "",
      "- [Styling anything?](blessings/styling.md) — copy: `web/tokens.css` · why: [ADR-0001](adr/0001-x.md), [ADR-0002](adr/0002-x.md)",
      "",
      "## Every other blessing",
      "",
      "- [_(no trigger question)_](blessings/no-question.md) Copy b, per ADR-0042. — copy: `src/b.ts` · why: ADR-0042",
      "- [Adding an alpha?](blessings/no-where.md) — copy: _none given_ · why: _no reason given_",
      "- [Calling the API?](blessings/extending-a-client.md) — extend: `lib/client.ts`, used by 2: /a, /b · why: because it holds the auth",
      "- [Parsing a file?](blessings/extending-unknown.md) — extend: `lib/py.py`, users unknown to ZDD · why: because it is shared",
      "- [Reading a zeta?](blessings/reading-a-zeta.md) — copy: `src/r.ts` (readZeta) · why: because reads are cached",
      "- [Writing a zeta?](blessings/writing-a-zeta.md) — copy: `src/z.ts` · why: [ADR-0003](adr/0003-x.md)",
      "",
    ].join("\n"),
  );
  assert.match(text, /^# Blessing index\n/);
  assert.match(text, /do not edit/);
});

test("buildBlessingIndex: no house rules means one 'Blessings' list; more than five users are cut with a count; an unknown app page is said", () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ id: `s:/${i}`, title: `/${i}` }));
  const { text } = buildBlessingIndex([b("a", "where: a.ts\nkind: extend", "Adding A? Extend a because x.")], opts(() => many));
  assert.match(text, /\n## Blessings\n\n- \[Adding A\?\]\(blessings\/a\.md\) — extend: `a\.ts`, used by 7: \/0, \/1, \/2, \/3, \/4, \+2 more · why: because x\n/);
  const lost = buildBlessingIndex([b("a", "where: a.ts\nkind: copy\napplies-to: apps/gone", "Adding A? Copy a because x.")], opts());
  assert.match(lost.text, /## Applies to apps\/gone _\(no such map page\)_/);
});

test("buildBlessingIndex: an empty store says so, and control characters never reach the index", () => {
  const empty = buildBlessingIndex([], opts());
  assert.equal(empty.count, 0);
  assert.match(empty.text, /No blessings yet\./);
  const { text } = buildBlessingIndex([b("a", "where: a\x1b.ts\nkind: copy", "Adding \x07x? Copy y because z.")], opts());
  assert.ok(!/[\x00-\x08\x0b-\x1f\x7f]/.test(text), JSON.stringify(text));
});

const mkRepo = () => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-blessidx-"));
  cpSync(FIXTURE, repo, { recursive: true });
  execFileSync(process.execPath, [BIN, "derive"], { cwd: repo, encoding: "utf8" });
  return repo;
};

test("render: the fixture's blessing index equals its golden; the agent index's reading path names it", () => {
  const repo = mkRepo();
  execFileSync(process.execPath, [BIN, "render"], { cwd: repo, encoding: "utf8" });
  assert.equal(readFileSync(join(repo, "zdd", "blessing-index.md"), "utf8"), readFileSync(join(GOLDEN, "blessing-index-nextjs-supabase.md"), "utf8"));
  assert.match(readFileSync(join(repo, "zdd", "agent-index.md"), "utf8"), /choose patterns: `zdd\/blessing-index\.md` lists every blessing by its trigger question/);
  rmSync(repo, { recursive: true, force: true });
});

test("render --check: a stale, hand-edited or missing blessing index fails, naming it", () => {
  const repo = mkRepo();
  execFileSync(process.execPath, [BIN, "render"], { cwd: repo, encoding: "utf8" });
  const check = () => spawnSync(process.execPath, [BIN, "render", "--check"], { cwd: repo, encoding: "utf8" });
  assert.equal(check().status, 0);
  writeFileSync(join(repo, "zdd", "blessings", "deleting-a-thing.md"), "---\nwhere: src/app/api/things/route.ts\nkind: copy\nadr: ADR-0002\n---\n\nDeleting a thing? Soft-delete it.\n");
  let r = check();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /blessing-index\.md/);
  execFileSync(process.execPath, [BIN, "render"], { cwd: repo, encoding: "utf8" });
  assert.match(readFileSync(join(repo, "zdd", "blessing-index.md"), "utf8"), /- \[Deleting a thing\?\]\(blessings\/deleting-a-thing\.md\) — copy: `src\/app\/api\/things\/route\.ts` · why: \[ADR-0002\]/);
  writeFileSync(join(repo, "zdd", "blessing-index.md"), "hand edit\n");
  assert.equal(check().status, 1);
  rmSync(join(repo, "zdd", "blessing-index.md"));
  r = check();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /blessing-index\.md/);
  rmSync(repo, { recursive: true, force: true });
});
