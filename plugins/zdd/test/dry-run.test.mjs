// The pre-tag dry run (CAS-103, the process scope; decision 8 of its design
// session): the release proven on three committed scenario repos that are
// not DiO's or Cascade's — a greenfield folder, a young Next.js + Supabase
// app shaped like the one the videos show, and a mature monorepo with an
// Express API, a React Router web app and a Python archiver — with no
// secrets and no network. Each is bootstrapped by the workspace plugin with
// a fake `.claude/worktrees/` folder planted, derived, rendered and linted
// by the workspace engine, upgraded from a pre-2.3 shape, hosted off GitHub,
// and merged across a conflict in a generated file. The preflight's
// messages are proven against stand-ins for a dead registry and a dead
// GitHub. Run: node --test "plugins/zdd/test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync, mkdirSync, cpSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(PLUGIN, "scripts", "bootstrap.mjs");
const ENGINE = resolve(PLUGIN, "..", "..", "packages", "zdd-engine", "bin", "zdd-engine.mjs");
const SCENARIOS = join(PLUGIN, "test", "fixtures", "scenarios");
const VERSION = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;
const execAsync = promisify(execFile);

let scratch, home;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "zdd-dryrun-"));
  home = join(scratch, "home");
  mkdirSync(home, { recursive: true });
});
after(() => scratch && rmSync(scratch, { recursive: true, force: true }));

const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const commit = (cwd, msg) => {
  git(cwd, "add", "-A");
  git(cwd, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", msg);
};
const bootstrap = (root, args) => execFileSync(process.execPath, [SCRIPT, ...args, `--root=${root}`, `--home=${home}`, "--date=2026-10-09"], { encoding: "utf8" });
const bootstrapJson = (root, args) => JSON.parse(bootstrap(root, [...args, "--json"]));
const engine = (root, args) => spawnSync(process.execPath, [ENGINE, ...args, `--root=${root}`], { encoding: "utf8" });
const answers = (name, a) => {
  const p = join(scratch, `${name}.json`);
  writeFileSync(p, JSON.stringify(a));
  return p;
};
// A scenario, copied, under git, with the folder that bit DiO planted.
function scenario(name, { remote = "https://github.com/example/app.git", old = false } = {}) {
  const repo = join(scratch, `${name}-${Math.random().toString(36).slice(2, 8)}`);
  cpSync(join(SCENARIOS, name), repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  if (remote) git(repo, "remote", "add", "origin", remote);
  if (old) {
    // Years of history, so the estimate reads it as a mature codebase.
    git(repo, "add", "-A");
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "first", "--date=2020-01-01T10:00:00"], { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: "2020-01-01T10:00:00" } });
  }
  commit(repo, "snapshot");
  mkdirSync(join(repo, ".claude", "worktrees", "feat-x", "lib"), { recursive: true });
  writeFileSync(join(repo, ".claude", "worktrees", "feat-x", "lib", "planted.ts"), 'export const k = process.env.STRIPE_SECRET; // a second checkout: never source\n');
  writeFileSync(join(repo, ".gitignore"), (existsSync(join(repo, ".gitignore")) ? readFileSync(join(repo, ".gitignore"), "utf8") : "") + ".claude/worktrees/\n");
  return repo;
}
const grepArtifacts = (repo, needle) => {
  const hits = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (readFileSync(p, "utf8").includes(needle)) hits.push(p);
    }
  };
  if (existsSync(join(repo, "zdd"))) walk(join(repo, "zdd"));
  return hits;
};

test("greenfield: the install writes an empty zdd/ and the instructions, derive writes nothing and passes, render and lint pass, estimate says greenfield", () => {
  const repo = scenario("greenfield", { remote: null });
  assert.equal(bootstrapJson(repo, ["estimate"]).scenario, "greenfield");
  const d = bootstrapJson(repo, ["detect"]);
  assert.equal(d.mode, "greenfield");
  assert.equal(d.host.kind, "none");
  const json = bootstrapJson(repo, ["apply", `--answers=${answers("g", { stack: ["FastAPI", "Supabase"], apps: ["Web"] })}`]);
  for (const f of ["zdd/config.json", "zdd/instructions.md", "zdd/glossary.md", "zdd/adr/0001-adopt-zero-drift-docs.md", "CLAUDE.md", ".gitattributes", ".github/workflows/zdd.yml", ".claude/settings.json"]) assert.ok(json.wrote.includes(f), `${f} written: ${json.wrote.join(", ")}`);
  assert.match(readFileSync(join(repo, "CLAUDE.md"), "utf8"), /^@zdd\/instructions\.md$/m);
  for (const cmd of ["derive", "render", "lint"]) {
    const r = engine(repo, [cmd]);
    assert.equal(r.status, 0, `${cmd}: ${r.stderr}`);
  }
  assert.equal(engine(repo, ["derive", "--check"]).status, 0);
  assert.equal(engine(repo, ["render", "--check"]).status, 0);
});

test("young app (the video repo's shape): detection proposes Supabase, Next.js, components and external services with evidence; estimate says young with a backfill offer; the install, derive, render and lint pass; nothing from .claude/worktrees/ reaches a record", () => {
  const repo = scenario("young-app");
  const d = bootstrapJson(repo, ["detect"]);
  assert.deepEqual(d.proposals.map((p) => p.name).sort(), ["components", "external-services", "nextjs", "supabase"], JSON.stringify(d.proposals.map((p) => p.name)));
  assert.equal(d.host.kind, "github");
  const svc = d.proposals.find((p) => p.name === "external-services");
  assert.ok(svc.options.services.some((s) => s.name === "Resend"), JSON.stringify(svc.options));
  assert.ok(!JSON.stringify(d).includes("planted"), "detection never reads the worktree");
  const e = bootstrapJson(repo, ["estimate"]);
  assert.equal(e.scenario, "young");
  assert.ok(e.backfill && /about/.test(e.backfill.total));
  const json = bootstrapJson(repo, ["apply", `--answers=${answers("y", { name: "Sandwich shop" })}`]);
  assert.ok(json.wrote.includes("zdd/instructions.md"));
  assert.ok(json.wrote.includes("CLAUDE.md"), "the one line appended to the existing CLAUDE.md");
  const claude = readFileSync(join(repo, "CLAUDE.md"), "utf8");
  assert.ok(claude.startsWith("# Sandwich shop\n") && claude.includes('Say "load ZDD" before you start'), "the adopter's text is untouched");
  assert.match(claude, /^@zdd\/instructions\.md$/m);
  const derive = engine(repo, ["derive"]);
  assert.equal(derive.status, 0, derive.stderr);
  assert.deepEqual(grepArtifacts(repo, "planted"), [], "the worktree copy reached no record");
  assert.deepEqual(grepArtifacts(repo, "STRIPE_SECRET"), []);
  assert.ok(existsSync(join(repo, "zdd", "metadata", "route", "orders.json")), "the checkout route");
  assert.ok(existsSync(join(repo, "zdd", "metadata", "table", "db--public.orders.json")) || existsSync(join(repo, "zdd", "metadata", "table", "db--orders.json")), readdirSync(join(repo, "zdd", "metadata", "table")).join(","));
  assert.ok(existsSync(join(repo, "zdd", "metadata", "external-service", "resend.json")));
  for (const cmd of ["render", "lint"]) {
    const r = engine(repo, [cmd]);
    assert.equal(r.status, 0, `${cmd}: ${r.stderr}`);
  }
  assert.equal(engine(repo, ["derive", "--check"]).status, 0);
  assert.equal(engine(repo, ["render", "--check"]).status, 0);
  // The install's own text is the plain-words kind: every written file has a card.
  const text = bootstrap(repo, ["apply", `--answers=${answers("y2", {})}`]);
  assert.match(text, /kept    zdd\/instructions\.md\n {10}what: ZDD's instructions/);
});

test("mature codebase: an Express API, a React Router web app, a Python archiver, a queue and a nightly — detected, derived, rendered and linted; background work appears in the index; a pre-2.3 shape upgrades: the block becomes the line, the services key is renamed, the adopter's own rules are read against ZDD's and retired names are listed", () => {
  const repo = scenario("mature-codebase", { old: true });
  const d = bootstrapJson(repo, ["detect"]);
  assert.ok(d.proposals.some((p) => p.name === "react-router"), JSON.stringify(d.proposals.map((p) => p.name)));
  assert.ok(d.proposals.some((p) => p.name === "jobs"), "Procfile, Compose and the queue propose background work");
  assert.ok(d.proposals.some((p) => p.name === "external-services"), "Sentry");
  assert.equal(bootstrapJson(repo, ["estimate"]).scenario, "mature");
  // A pre-2.3 adopter: an old block in CLAUDE.md, the old extractor key, the old pin.
  bootstrapJson(repo, ["apply", `--answers=${answers("m", { name: "Fleet", extractors: ["react-router", "jobs", "services"], extractorOptions: { "react-router": { routesFile: "web/src/routes.tsx" }, jobs: { modes: { emails: "worker", archive: "worker" } }, services: { services: [{ name: "Sentry", imports: ["@sentry/node"], env: ["SENTRY_"] }] } } })}`]);
  const cfgPath = join(repo, "zdd", "config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  assert.deepEqual(cfg.extractors, ["react-router", "jobs", "external-services"], "a fresh apply writes the current name even when answered with the old one");
  cfg.extractors = ["react-router", "jobs", "services"];
  cfg.extractorOptions.services = cfg.extractorOptions["external-services"];
  delete cfg.extractorOptions["external-services"];
  cfg.engine = "2.2.1";
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  // The repo's lock sat at v2.1.0 (its own lock test still says so, in docs/setup.md).
  const settingsPath = join(repo, ".claude", "settings.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  settings.extraKnownMarketplaces["zero-drift-docs"].source.ref = "v2.1.0";
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  const instr = readFileSync(join(repo, "CLAUDE.md"), "utf8");
  writeFileSync(join(repo, "CLAUDE.md"), instr.replace(/<!-- Zero-Drift Docs:[^\n]*\n@zdd\/instructions\.md\n/, "<!-- zdd:begin -->\n## Documentation — Zero-Drift Docs (ZDD)\nold block\n<!-- zdd:end -->\n"));
  assert.match(readFileSync(join(repo, "CLAUDE.md"), "utf8"), /<!-- zdd:begin -->/);
  const plan = bootstrapJson(repo, ["upgrade", "--plan"]);
  assert.ok(plan.wrote.includes("CLAUDE.md") && plan.wrote.includes("zdd/config.json"), plan.wrote.join("\n"));
  const units = plan.duplicates.map((u) => [u.heading, u.rules]);
  assert.ok(units.some(([h, r]) => h === "## Rules" && r.includes("update")), JSON.stringify(units));
  assert.ok(units.some(([h, r]) => h === "## Rules" && r.includes("merge")), JSON.stringify(units));
  assert.ok(!units.some(([, r]) => r.length === 0));
  const retired = plan.notes.filter((n) => / still says /.test(n)).join("\n");
  assert.match(retired, /docs\/setup\.md:3 still says `zdd:bootstrap --upgrade`/, retired);
  assert.match(retired, /docs\/setup\.md:3 still says `v2\.1\.0`/, retired);
  const json = bootstrapJson(repo, ["upgrade"]);
  assert.match(readFileSync(join(repo, "CLAUDE.md"), "utf8"), /^@zdd\/instructions\.md$/m);
  assert.doesNotMatch(readFileSync(join(repo, "CLAUDE.md"), "utf8"), /zdd:begin/);
  assert.deepEqual(JSON.parse(readFileSync(cfgPath, "utf8")).extractors, ["react-router", "jobs", "external-services"]);
  assert.ok(json.notes.some((n) => /^2\.3 moves ZDD's rules out of the marked block/.test(n)), "the 2.3 note is said when crossing it");
  for (const cmd of ["derive", "render", "lint"]) {
    const r = engine(repo, [cmd]);
    assert.equal(r.status, 0, `${cmd}: ${r.stderr}`);
  }
  const index = readFileSync(join(repo, "zdd", "agent-index.md"), "utf8");
  assert.match(index, /^## Background work$/m, index);
  assert.match(index, /\[emails\]\(metadata\/job\/emails\.json\) — queue `emails`/, index);
  assert.match(index, /\[archive\]\(metadata\/job\/archive\.json\) — worker/, index);
  assert.doesNotMatch(index, /nightly/, "the Actions schedule is off by default");
  assert.ok(existsSync(join(repo, "zdd", "metadata", "external-service", "sentry.json")));
  assert.deepEqual(grepArtifacts(repo, "planted"), []);
});

test("hosted off GitHub: no workflow is written, the three commands are printed, the pre-push hook is the fallback; a merge conflict in a generated file: take either side, regenerate, the check passes", () => {
  const repo = scenario("young-app", { remote: "https://gitlab.com/example/app.git" });
  const json = bootstrapJson(repo, ["apply", `--answers=${answers("gl", {})}`]);
  assert.ok(!json.wrote.includes(".github/workflows/zdd.yml"));
  assert.ok(json.wrote.includes(".githooks/pre-push"));
  assert.equal(json.optIns.ci, false);
  const text = bootstrap(repo, ["apply", `--answers=${answers("gl2", {})}`]);
  assert.match(text, /The merge gate for your own pipeline is three commands/);
  assert.equal(engine(repo, ["derive"]).status, 0);
  assert.equal(engine(repo, ["render"]).status, 0);
  commit(repo, "adopt ZDD");
  // Two branches regenerate after different changes: the generated index conflicts.
  git(repo, "checkout", "-q", "-b", "a");
  writeFileSync(join(repo, "zdd", "glossary.md"), "# Glossary\n\n**Sandwich**: a thing between bread.\n");
  mkdirSync(join(repo, "zdd", "map", "features"), { recursive: true });
  writeFileSync(join(repo, "zdd", "map", "features", "orders.md"), "---\ntype: Feature\ntitle: Orders\ndescription: Placing an order.\ntags: [orders]\n---\n\n- [Checkout](../../metadata/route/orders.json)\n");
  assert.equal(engine(repo, ["render"]).status, 0);
  commit(repo, "a: orders feature");
  git(repo, "checkout", "-q", "main");
  git(repo, "checkout", "-q", "-b", "b");
  writeFileSync(join(repo, "zdd", "map", "features", "menu.md"), "---\ntype: Feature\ntitle: Menu\ndescription: The menu.\ntags: [menu]\n---\n\n- [Menu page](../../metadata/surface/menu.json)\n");
  assert.equal(engine(repo, ["render"]).status, 0);
  commit(repo, "b: menu feature");
  // An identity on the command: CI runners have none configured, and a merge
  // that fails for lack of one is not a conflict.
  const merge = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "merge", "--no-edit", "a"], { cwd: repo, encoding: "utf8" });
  assert.notEqual(merge.status, 0, "the generated index conflicts");
  assert.match(merge.stdout + merge.stderr, /CONFLICT/, merge.stdout + merge.stderr);
  const conflicted = git(repo, "diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean);
  assert.ok(conflicted.includes("zdd/agent-index.md"), conflicted.join(","));
  // The instructions' recipe: take either side of a generated file, finish the merge, regenerate.
  for (const f of conflicted) {
    git(repo, "checkout", "--theirs", "--", f);
    git(repo, "add", f);
  }
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "merge a");
  assert.notEqual(engine(repo, ["render", "--check"]).status, 0, "stale until regenerated");
  assert.equal(engine(repo, ["render"]).status, 0);
  assert.equal(engine(repo, ["render", "--check"]).status, 0);
  assert.match(readFileSync(join(repo, "zdd", "agent-index.md"), "utf8"), /## Orders[\s\S]*## Menu|## Menu[\s\S]*## Orders/);
});

test("the preflight's messages: a dead registry, a dead GitHub, no repository — each named in plain words; all present passes", async () => {
  const ok = await new Promise((r) => {
    const s = createServer((req, res) => res.writeHead(req.url === `/@rich-rees%2fzdd-engine/${VERSION}` ? 200 : req.url === "/" ? 200 : 404).end("{}"));
    s.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${s.address().port}`, close: () => s.close() }));
  });
  try {
    const repo = scenario("greenfield", { remote: null });
    const good = await execAsync(process.execPath, [SCRIPT, "preflight", `--registry=${ok.url}`, `--github=${ok.url}`, `--root=${repo}`, `--home=${home}`], { encoding: "utf8" });
    assert.match(good.stdout, /Everything ZDD needs is here\. No account is needed anywhere\./);
    const dead = "http://127.0.0.1:9";
    const bad = await execAsync(process.execPath, [SCRIPT, "preflight", `--registry=${dead}`, `--github=${dead}`, `--root=${join(scratch, "no-repo")}`, `--home=${home}`], { encoding: "utf8" }).catch((e) => e);
    assert.equal(bad.code, 1);
    assert.match(bad.stdout, /MISSING a git repository/);
    assert.match(bad.stdout, /MISSING github\.com — could not be reached/);
    assert.match(bad.stdout, /MISSING the npm registry — could not be reached/);
    assert.match(bad.stdout, /Nothing was written\./);
  } finally {
    ok.close();
  }
});
