// The hooks, observed as processes: stdin in, exit code + stdout/stderr out,
// against a throwaway adopter repo. Also the manifests: both hosts must reach
// the same skills and hooks, and hooks.json may only reach its scripts via
// ${CLAUDE_PLUGIN_ROOT}.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FENCE = join(PLUGIN, "scripts", "fence.mjs");
const INJECT = join(PLUGIN, "scripts", "inject-agent-index.mjs");

let repo;
before(() => {
  repo = mkdtempSync(join(tmpdir(), "zdd-hooks-"));
  mkdirSync(join(repo, "zdd"), { recursive: true });
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], hooks: { autoLoad: true, fence: true } }));
  writeFileSync(join(repo, "zdd", "agent-index.md"), "# Index\n\n## Things\n");
});
after(() => rmSync(repo, { recursive: true, force: true }));

const runHook = (script, input, env = {}) =>
  spawnSync(process.execPath, [script], {
    input: input === undefined ? "" : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ...env },
  });

test("fence blocks a Write to the agent index, naming update", () => {
  const r = runHook(FENCE, { tool_name: "Write", tool_input: { file_path: join(repo, "zdd", "agent-index.md") } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /generated artifact/);
  assert.match(r.stderr, /update/);
});

test("fence reads the paths from config.json (moved index)", () => {
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], hooks: { fence: true }, paths: { agentIndex: "docs/AGENT.md" } }));
  const blocked = runHook(FENCE, { tool_name: "Edit", tool_input: { file_path: "docs/AGENT.md" }, cwd: repo });
  assert.equal(blocked.status, 2);
  const allowed = runHook(FENCE, { tool_name: "Write", tool_input: { file_path: join(repo, "zdd", "agent-index.md") } });
  assert.equal(allowed.status, 0, "the default path is no longer generated here");
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], hooks: { autoLoad: true, fence: true } }));
});

test("fence blocks write-shaped shell over the metadata dir, allows reads and curated writes", () => {
  const blocked = runHook(FENCE, { tool_name: "Bash", tool_input: { command: "echo x > zdd/metadata/table/db--jobs.json" } });
  assert.equal(blocked.status, 2);
  const rm = runHook(FENCE, { tool_name: "Bash", tool_input: { command: "rm -rf zdd/graph.json" } });
  assert.equal(rm.status, 2);
  const read = runHook(FENCE, { tool_name: "Bash", tool_input: { command: "cat zdd/agent-index.md" } });
  assert.equal(read.status, 0);
  const curated = runHook(FENCE, { tool_name: "Write", tool_input: { file_path: join(repo, "zdd", "glossary.md") } });
  assert.equal(curated.status, 0);
});

test("fence is a no-op without the opt-in, without config, and on garbage input", () => {
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"] }));
  assert.equal(runHook(FENCE, { tool_name: "Write", tool_input: { file_path: join(repo, "zdd", "agent-index.md") } }).status, 0);
  writeFileSync(join(repo, "zdd", "config.json"), "{ not json");
  assert.equal(runHook(FENCE, { tool_name: "Write", tool_input: { file_path: join(repo, "zdd", "agent-index.md") } }).status, 0);
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], hooks: { autoLoad: true, fence: true } }));
  const garbage = spawnSync(process.execPath, [FENCE], { input: "not json", encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
  assert.equal(garbage.status, 0);
});

test("session-start injects the index with the load/update trailer; honours autoLoad:false; silent without an index", () => {
  const r = runHook(INJECT);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /<zdd-agent-index>\n# Index/);
  assert.match(r.stdout, /"load ZDD"/);
  assert.match(r.stdout, /"update ZDD"/);
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], hooks: { autoLoad: false } }));
  assert.equal(runHook(INJECT).stdout, "");
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], hooks: { autoLoad: true, fence: true } }));
  const empty = mkdtempSync(join(tmpdir(), "zdd-empty-"));
  const none = spawnSync(process.execPath, [INJECT], { encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: empty } });
  assert.equal(none.status, 0);
  assert.equal(none.stdout, "");
  rmSync(empty, { recursive: true, force: true });
});

test("pre-push hook with no engine CLI on PATH prints one line and exits 0", (t) => {
  const sh = ["/bin/sh", "/usr/bin/sh", "C:\\Program Files\\Git\\bin\\sh.exe", "C:\\Program Files\\Git\\usr\\bin\\sh.exe"].find((p) => existsSync(p));
  if (!sh) return t.skip("no sh available");
  const r = spawnSync(sh, [join(PLUGIN, "templates", "pre-push")], { encoding: "utf8", env: { PATH: "" }, cwd: repo });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1, r.stdout);
  assert.match(lines[0], /npx not found/);
});

test("manifests: Claude and Codex reference the same skills and hooks; hooks.json reaches scripts via ${CLAUDE_PLUGIN_ROOT} only", () => {
  const claude = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8"));
  const codex = JSON.parse(readFileSync(join(PLUGIN, ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(claude.name, codex.name);
  assert.equal(claude.version, codex.version);
  assert.equal(claude.skills, codex.skills);
  assert.equal(claude.hooks, codex.hooks);
  assert.ok(existsSync(join(PLUGIN, claude.skills)));
  assert.ok(existsSync(join(PLUGIN, claude.hooks)));
  const hooks = JSON.parse(readFileSync(join(PLUGIN, claude.hooks), "utf8"));
  const commands = Object.values(hooks.hooks).flat().flatMap((g) => g.hooks);
  assert.ok(commands.length >= 2);
  for (const c of commands) {
    const script = c.args.find((a) => a.endsWith(".mjs"));
    assert.match(script, /^\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\//, script);
    assert.ok(existsSync(join(PLUGIN, script.replace("${CLAUDE_PLUGIN_ROOT}/", ""))), `${script} exists`);
    assert.ok(!/(^|\/)(\.\.|~|\/)/.test(c.command), "no absolute or home paths");
  }
  // Marketplace entry and manifests agree on the version.
  const market = JSON.parse(readFileSync(resolve(PLUGIN, "..", "..", ".claude-plugin", "marketplace.json"), "utf8"));
  assert.equal(market.plugins.find((p) => p.name === "zdd").version, claude.version);
  // The skills still exist under the names the docs promise (orient is gone).
  for (const s of ["bootstrap", "load", "update", "grill"]) assert.ok(existsSync(join(PLUGIN, "skills", s, "SKILL.md")), s);
  assert.ok(!existsSync(join(PLUGIN, "skills", "orient")));
});
