// Bootstrap after the adapters are attached (decision 0039): the first map
// check is owed (`mapCheck` in the config) until it is done together; on a
// greenfield repo it waits for the first derive that finds records, and
// `check --status` says when it is due. `check` reads the engine's coverage
// report; `check --done` clears it. `preview` renders the chosen adapters'
// examples outside the repo. Bootstrap runs the engine of its own release:
// ZDD_ENGINE_BIN when set, else the engine beside it at the same version,
// else the pinned package under npx. Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = resolve(PLUGIN, "..", "..", "packages", "zdd-engine");
const ENGINE_BIN = join(ENGINE, "bin", "zdd-engine.mjs");
const BOOTSTRAP = join(PLUGIN, "scripts", "bootstrap.mjs");

const tmp = (t, prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};
const run = (repo, args, env = process.env) => execFileSync(process.execPath, [BOOTSTRAP, ...args, `--root=${repo}`], { encoding: "utf8", env });
const engine = (repo, args) => execFileSync(process.execPath, [ENGINE_BIN, ...args, `--root=${repo}`], { encoding: "utf8" });
const applyDefaults = (t, repo) => {
  const answers = join(tmp(t, "zdd-ans-"), "a.json");
  writeFileSync(answers, JSON.stringify({ name: "Check" }));
  run(repo, ["apply", `--answers=${answers}`]);
};

test("the first map check: owed after apply, silent until derive finds records, then due; check names the unlinked; --done clears it", (t) => {
  const repo = tmp(t, "zdd-check-");
  cpSync(join(ENGINE, "test", "fixture-fastapi"), repo, { recursive: true });
  rmSync(join(repo, "zdd"), { recursive: true });
  applyDefaults(t, repo);
  assert.equal(JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")).mapCheck, "owed");
  applyDefaults(t, repo); // a repair apply
  assert.equal(JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")).mapCheck, "owed", "a repair keeps what is owed");
  assert.equal(run(repo, ["check", "--status"]), "", "no records yet: nothing to say");
  engine(repo, ["derive"]);
  assert.match(run(repo, ["check", "--status"]), /^The first map check is owed: derive now finds records/);
  const report = run(repo, ["check"]);
  assert.match(report, /- 2 routes; 2 link to a table/, report);
  assert.match(report, /does this all look right, and is any link missing\?/);
  const json = JSON.parse(run(repo, ["check", "--json"]));
  assert.deepEqual(json.coverage.find((k) => k.kind === "table").reachedByNothing.count, 0);
  assert.match(run(repo, ["check", "--done"]), /mapCheck cleared/);
  assert.equal(JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")).mapCheck, undefined);
  assert.equal(run(repo, ["check", "--status"]), "", "done: never asked again");
  applyDefaults(t, repo);
  assert.equal(JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")).mapCheck, undefined, "a repair after the check never owes it again");
});

test("check --status in a repo that has not adopted ZDD is silent and succeeds (CR-099); interactive check still says bootstrap first", (t) => {
  const repo = tmp(t, "zdd-check-none-");
  const r = spawnSync(process.execPath, [BOOTSTRAP, "check", "--status", `--root=${repo}`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
  const i = spawnSync(process.execPath, [BOOTSTRAP, "check", `--root=${repo}`], { encoding: "utf8" });
  assert.equal(i.status, 1);
  assert.match(i.stderr, /bootstrap first/);
});

test("check --status never reads a metadataDir that is a link out of the repo (CR-104)", (t) => {
  const repo = tmp(t, "zdd-check-link-");
  const outside = tmp(t, "zdd-check-outside-");
  mkdirSync(join(outside, "route"), { recursive: true });
  writeFileSync(join(outside, "route", "x.json"), "{}");
  mkdirSync(join(repo, "zdd"), { recursive: true });
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], mapCheck: "owed" }));
  try {
    symlinkSync(outside, join(repo, "zdd", "metadata"), "junction");
  } catch {
    return t.skip("links cannot be made here");
  }
  const r = spawnSync(process.execPath, [BOOTSTRAP, "check", "--status", `--root=${repo}`], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /metadataDir zdd\/metadata: .*symlink|real path leaves the checkout/);
});

test("answers are checked against each adapter's option shape: call-name grammar (CR-102, CR-109) and required and optional object paths (CR-101)", async (t) => {
  const { validateAnswers } = await import(pathToFileURL(BOOTSTRAP).href);
  const { adapters } = JSON.parse(run(tmp(t, "zdd-shapes-"), ["detect", "--json"]));
  const opts = (extractorOptions) => () => validateAnswers({ extractorOptions }, adapters);
  assert.doesNotThrow(opts({ "supabase-js": { subscribeCalls: ["live.onInsert", "$sub"] }, "react-router": { subscribeCalls: ["watch"] }, nextjs: { refs: { subscribeCalls: ["rt.on_x"] } } }));
  assert.throws(opts({ "supabase-js": { subscribeCalls: "live.onInsert" } }), /supabase-js\.subscribeCalls must be an array of call names/);
  assert.throws(opts({ "supabase-js": { subscribeCalls: [""] } }), /must be an array of call names/);
  assert.throws(opts({ "supabase-js": { subscribeCalls: ['live["insert"]'] } }), /supabase-js\.subscribeCalls: "live\[\\"insert\\"\]" is not a call name the adapter reads/);
  assert.throws(opts({ "react-router": { subscribeCalls: ["a.b("] } }), /react-router\.subscribeCalls: .* is not a call name/);
  assert.throws(opts({ nextjs: { refs: { subscribeCalls: ["x y"] } } }), /nextjs\.refs\.subscribeCalls: .* is not a call name/);
  assert.throws(opts({ nextjs: { refs: "x" } }), /nextjs\.refs must be an object/);
  assert.doesNotThrow(opts({ "background-declared": { entries: [{ name: "a", file: "worker/a.mjs", cwd: "worker" }, { name: "b", module: "app.b" }] } }));
  assert.throws(opts({ "background-declared": { entries: [{ name: "a", file: "../../outside.js" }] } }), /background-declared\.entries\[0\]\.file/);
  assert.throws(opts({ "background-declared": { entries: [{ name: "a", module: "m", cwd: "/abs" }] } }), /background-declared\.entries\[0\]\.cwd/);
  assert.throws(opts({ supabase: { migrationNamespaces: [{ name: "db" }] } }), /supabase\.migrationNamespaces\[0\]\.dir/, "a required path key");
});

test("a detected path the engine would refuse stops apply before the first write (CR-100)", (t) => {
  const repo = tmp(t, "zdd-spaced-");
  mkdirSync(join(repo, "my api"), { recursive: true });
  writeFileSync(join(repo, "my api", "main.py"), "from fastapi import FastAPI\napp = FastAPI()\n");
  const answers = join(tmp(t, "zdd-ans-"), "a.json");
  writeFileSync(answers, JSON.stringify({ name: "Spaced" }));
  const r = spawnSync(process.execPath, [BOOTSTRAP, "apply", `--answers=${answers}`, `--root=${repo}`], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /the extractor options to write: fastapi\.roots\[0\] "my api" must be repo-relative.*nothing was written/);
  assert.deepEqual(readdirSync(repo), ["my api"]);
});

test("detect says how many files it could not read, and names the first (CR-103)", (t) => {
  const repo = tmp(t, "zdd-refused-");
  writeFileSync(join(repo, "requirements.txt"), "supabase\n" + "#".repeat(1100000));
  writeFileSync(join(repo, "main.py"), "x = 1\n");
  assert.match(run(repo, ["detect"]), /^  \(1 file could not be read — over 1 MiB, unreadable or a link: `requirements\.txt` — evidence in it was not seen\)$/m);
});

test("greenfield: the check stays owed and silent while there is no code", (t) => {
  const repo = tmp(t, "zdd-check-green-");
  applyDefaults(t, repo);
  assert.equal(JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")).mapCheck, "owed");
  assert.deepEqual(JSON.parse(run(repo, ["check", "--status", "--json"])), { owed: true, records: false, due: false });
});

test("preview: the examples render outside the repo, and nothing is written into it", (t) => {
  const repo = tmp(t, "zdd-preview-repo-");
  const r = JSON.parse(run(repo, ["preview", "--extractors=fastapi,supabase", "--json"]));
  t.after(() => rmSync(r.out, { recursive: true, force: true }));
  assert.deepEqual(r.used, ["fastapi", "supabase"]);
  assert.ok(existsSync(r.humanIndex));
  assert.ok(!resolve(r.out).startsWith(resolve(repo)));
  assert.deepEqual(readdirSync(repo), []);
  const bad = spawnSync(process.execPath, [BOOTSTRAP, "preview", "--extractors=../x", `--root=${repo}`], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /is not an adapter name/);
  // A well-formed name the catalogue does not hold is refused, not "no example" (CR-115).
  const typo = spawnSync(process.execPath, [BOOTSTRAP, "preview", "--extractors=fastapy", `--root=${repo}`], { encoding: "utf8" });
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /fastapy is not an adapter in the catalogue/);
  assert.deepEqual(readdirSync(repo), []);
});

test("the engine bootstrap runs: ZDD_ENGINE_BIN only when it is an engine's own bin (CR-097), else the sibling engine of the same version", async (t) => {
  const { engineCommand } = await import(pathToFileURL(BOOTSTRAP).href);
  assert.deepEqual(engineCommand({ env: {} }), { cmd: process.execPath, pre: [ENGINE_BIN], shell: false }, "this checkout ships the engine at the plugin's version");
  assert.deepEqual(engineCommand({ env: { ZDD_ENGINE_BIN: ENGINE_BIN } }).pre, [ENGINE_BIN]);
  // An engine package elsewhere is accepted; any other file is refused, never run.
  const other = tmp(t, "zdd-otherengine-");
  mkdirSync(join(other, "bin"));
  writeFileSync(join(other, "bin", "zdd-engine.mjs"), "");
  writeFileSync(join(other, "package.json"), JSON.stringify({ name: "@rich-rees/zdd", version: "0.0.1" }));
  assert.deepEqual(engineCommand({ env: { ZDD_ENGINE_BIN: join(other, "bin", "zdd-engine.mjs") } }).pre, [join(other, "bin", "zdd-engine.mjs")]);
  // The old line's package is not this release's engine (decision 0042).
  writeFileSync(join(other, "package.json"), JSON.stringify({ name: "@rich-rees/zdd-engine", version: "2.5.0" }));
  assert.throws(() => engineCommand({ env: { ZDD_ENGINE_BIN: join(other, "bin", "zdd-engine.mjs") } }), /in a @rich-rees\/zdd package/);
  writeFileSync(join(other, "package.json"), JSON.stringify({ name: "not-the-engine" }));
  assert.throws(() => engineCommand({ env: { ZDD_ENGINE_BIN: join(other, "bin", "zdd-engine.mjs") } }), /is not an engine's bin\/zdd-engine\.mjs/);
  writeFileSync(join(other, "evil.mjs"), "");
  assert.throws(() => engineCommand({ env: { ZDD_ENGINE_BIN: join(other, "evil.mjs") } }), /is not an engine's bin/);
  // Refused before anything runs: detection fails loudly, naming the variable, and writes nothing.
  const repo = tmp(t, "zdd-noengine-");
  const r = spawnSync(process.execPath, [BOOTSTRAP, "detect", `--root=${repo}`], { encoding: "utf8", env: { ...process.env, ZDD_ENGINE_BIN: join(repo, "missing.mjs") } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /detection could not run — the engine said: ZDD_ENGINE_BIN/);
  assert.deepEqual(readdirSync(repo), []);
});

test("outside this checkout: npx on POSIX, npm's npx-cli.js with node on Windows (no shell), and cmd.exe only as a last resort that refuses what it would change (CR-096)", async (t) => {
  const { engineCommand, engineArgv } = await import(pathToFileURL(BOOTSTRAP).href);
  const VERSION = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;
  const pkg = `@rich-rees/zdd@${VERSION}`;
  const none = join(tmp(t, "zdd-nosibling-"), "engine");
  assert.deepEqual(engineCommand({ env: {}, platform: "linux", sibling: none }), { cmd: "npx", pre: ["-y", pkg], shell: false });
  const nodeDir = tmp(t, "zdd-nodedir-");
  const node = join(nodeDir, "node.exe");
  assert.deepEqual(engineCommand({ env: {}, platform: "win32", execPath: node, sibling: none }), { cmd: "npx.cmd", pre: ["-y", pkg], shell: true });
  mkdirSync(join(nodeDir, "node_modules", "npm", "bin"), { recursive: true });
  writeFileSync(join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"), "");
  const cli = engineCommand({ env: {}, platform: "win32", execPath: node, sibling: none });
  assert.deepEqual(cli, { cmd: node, pre: [join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"), "-y", pkg], shell: false });
  // No shell: every argument passes as it is, quote, percent and all.
  assert.deepEqual(engineArgv(cli, ['--root=C:\\a "b"\\%TEMP%']).at(-1), '--root=C:\\a "b"\\%TEMP%');
  // Through cmd.exe: a space is quoted; a quote, % and the other metacharacters are refused before anything runs.
  const shell = { cmd: "npx.cmd", pre: ["-y", pkg], shell: true };
  assert.deepEqual(engineArgv(shell, ["detect", "--root=C:\\my repo"]), [`"-y"`, `"${pkg}"`, `"detect"`, `"--root=C:\\my repo"`]);
  for (const bad of ['C:\\x"&whoami&rem "', "C:\\work\\%TEMP%\\repo", "C:\\a^b", "C:\\a&b", "C:\\a!b"]) assert.throws(() => engineArgv(shell, [`--root=${bad}`]), /cannot run the engine through cmd\.exe/, bad);
});
