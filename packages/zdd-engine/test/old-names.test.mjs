// The engine's own text names the package a user can run (ZDD-10, finding
// 3 of PressPlay's move to 0.11.0): `zdd-engine` is the bin's name, not a
// command on an adopter's machine, so every generated header, footer and
// stale-artifact message says `npx -y @rich-rees/zdd@<release> …` — the
// release zdd/config.json pins, written as `<release>` in a generated file
// (its bytes must not move on every bump) and as the pin itself in a
// message. An area file written under the old header is still ZDD's to
// prune. The human index and the contract warning are held too (campaign
// CR-211).
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { judgeContract } from "../src/core/lib/contract.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");

const mkRepo = (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-names-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(FIXTURE, repo, { recursive: true });
  return repo;
};
const run = (repo, args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
const config = (repo, patch) => {
  const p = join(repo, "zdd", "config.json");
  const cur = JSON.parse(readFileSync(p, "utf8"));
  writeFileSync(p, JSON.stringify({ ...cur, ...patch, agentIndex: { ...(cur.agentIndex ?? {}), ...(patch.agentIndex ?? {}) } }, null, 2));
};
const markdownUnder = (dir) => {
  const out = [];
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) {
      if (f.name !== "metadata") out.push(...markdownUnder(p));
    } else if (f.name.endsWith(".md") || f.name.endsWith(".html")) out.push(p);
  }
  return out;
};

test("ZDD-10: no generated index, area file, footer or human index names `zdd-engine`; they name `npx -y @rich-rees/zdd@<release>`", (t) => {
  const repo = mkRepo(t);
  writeFileSync(join(repo, "zdd", "map", "features", "billing.md"), "---\ntype: Feature\ntitle: billing\ndescription: billing feature\ntags: [billing]\n---\n");
  config(repo, { agentIndex: { levels: 2 } });
  assert.equal(run(repo, ["derive"]).status, 0);
  const r = run(repo, ["render"]);
  assert.equal(r.status, 0, r.stderr);
  const generated = ["agent-index.md", "adr-index.md", "blessing-index.md"].map((f) => join(repo, "zdd", f)).filter(existsSync);
  generated.push(...readdirSync(join(repo, "zdd", "agent-index")).map((f) => join(repo, "zdd", "agent-index", f)));
  assert.ok(generated.length >= 4, generated.join(", "));
  for (const p of generated) {
    const text = readFileSync(p, "utf8");
    assert.doesNotMatch(text, /zdd-engine/, `${p} still names zdd-engine`);
    assert.match(text, /npx -y @rich-rees\/zdd@<release> (render|derive)/, `${p} names no command`);
  }
  assert.match(readFileSync(join(repo, "zdd", "agent-index.md"), "utf8"), /regenerate\nwith `npx -y @rich-rees\/zdd@<release> derive`; never edit\./);
  assert.doesNotMatch(readFileSync(join(repo, "zdd", "human-index.html"), "utf8").replace(/\/\*__[A-Z_]+__\*\//g, ""), /zdd-engine (lint|render|derive|suite|tally|detect)/, "the human index's own text");
  for (const p of markdownUnder(join(repo, "zdd"))) assert.doesNotMatch(readFileSync(p, "utf8"), /`zdd-engine (render|derive)`/, p);
});

test("ZDD-10: a stale artifact's message names the repo's pinned release, never `zdd-engine`", (t) => {
  const repo = mkRepo(t);
  config(repo, { release: "0.12.0" });
  assert.equal(run(repo, ["derive"]).status, 0);
  assert.equal(run(repo, ["render"]).status, 0);
  writeFileSync(join(repo, "zdd", "agent-index.md"), "stale\n");
  const r = run(repo, ["render", "--check"]);
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stderr + r.stdout, /`zdd-engine/);
  assert.match(r.stderr + r.stdout, /npx -y @rich-rees\/zdd@0\.12\.0 render/);
  const meta = join(repo, "zdd", "metadata");
  const kind = readdirSync(meta, { withFileTypes: true }).find((d) => d.isDirectory());
  const file = readdirSync(join(meta, kind.name))[0];
  writeFileSync(join(meta, kind.name, file), "{}\n");
  const d = run(repo, ["derive", "--check"]);
  assert.equal(d.status, 1);
  assert.doesNotMatch(d.stderr + d.stdout, /`zdd-engine/);
  assert.match(d.stderr + d.stdout, /npx -y @rich-rees\/zdd@0\.12\.0 derive/);
});

test("ZDD-10 campaign CR-211: the warning for an adapter with no CONTRACT names the engine's suite, not the bin", () => {
  const { warning } = judgeContract("mine", {});
  assert.match(warning, /the engine's `suite`/);
  assert.doesNotMatch(warning, /zdd-engine/);
});

test("ZDD-10: an area file under the new header is pruned like one under the old", (t) => {
  const repo = mkRepo(t);
  const dir = join(repo, "zdd", "agent-index");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "old-area.md"), "# Fixture App — old\n\nOne area of [the agent index](../agent-index.md). Generated by `npx -y @rich-rees/zdd@<release> render` — do not edit.\n");
  assert.equal(run(repo, ["derive"]).status, 0);
  assert.equal(run(repo, ["render"]).status, 0);
  assert.ok(!existsSync(join(dir, "old-area.md")));
});
