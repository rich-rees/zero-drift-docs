// CAS-103 findings 16, 17 and C5 — the two hooks, at the process seam.
//   16 / C5  the Stop check waits for a finished unit of work: a turn that
//            ends on a question to the developer is mid-task, and a diff
//            holding only files ZDD itself writes (the lock, a pin, the
//            import line) is the upgrade's own pause — neither prompts.
//   17       the fence judges the write's target, not the words: an
//            interpreter one-liner that mentions a generated path in a
//            string it writes elsewhere is a write to that elsewhere.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { lastAssistantText, endsOnQuestion, ZDD_MANAGED } from "../scripts/stop-check.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STOP = join(PLUGIN, "scripts", "stop-check.mjs");
const FENCE = join(PLUGIN, "scripts", "fence.mjs");

let scratch, tmp;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "zdd-hooks23-"));
  tmp = join(scratch, "tmp");
  mkdirSync(tmp);
});
after(() => scratch && rmSync(scratch, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const commit = (cwd, msg) => {
  git(cwd, "add", "-A");
  git(cwd, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", msg);
};
let n = 0;
function mkRepo() {
  const repo = join(scratch, `repo${n++}`);
  mkdirSync(join(repo, "zdd"), { recursive: true });
  mkdirSync(join(repo, "src"));
  mkdirSync(join(repo, ".claude"));
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], hooks: { stop: true, fence: true } }));
  writeFileSync(join(repo, "zdd", "glossary.md"), "# Glossary\n");
  writeFileSync(join(repo, ".claude", "settings.json"), JSON.stringify({ extraKnownMarketplaces: { "zero-drift-docs": { source: { source: "github", repo: "rich-rees/zero-drift-docs", ref: "v2.2.1" }, autoUpdate: false } } }) + "\n");
  writeFileSync(join(repo, "CLAUDE.md"), "# Repo\n");
  git(repo, "init", "-q", "-b", "main");
  commit(repo, "base");
  git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(repo, "remote", "add", "origin", repo);
  git(repo, "checkout", "-q", "-b", "feature");
  return repo;
}
let sid = 0;
const stop = (repo, input = {}) => {
  const env = { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp, CLAUDE_PROJECT_DIR: repo };
  return spawnSync(process.execPath, [STOP], { input: JSON.stringify({ hook_event_name: "Stop", session_id: `q${sid++}`, ...input }), encoding: "utf8", env, cwd: repo });
};
const silent = (r, msg) => {
  assert.equal(r.status, 0, `${msg}: exit ${r.status} ${r.stderr}`);
  assert.equal(r.stdout, "", `${msg}: stdout ${r.stdout}`);
};
const blocked = (r, msg) => {
  assert.equal(r.status, 0, msg);
  assert.equal(JSON.parse(r.stdout).decision, "block", msg);
};
const transcript = (name, entries) => {
  const p = join(scratch, `${name}.jsonl`);
  writeFileSync(p, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return p;
};
const assistant = (text) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const user = (text) => ({ type: "user", message: { role: "user", content: text } });

test("16: a turn that ends on a question to the developer is mid-task — the Stop check stays silent; a turn that ends on a statement prompts", () => {
  const repo = mkRepo();
  writeFileSync(join(repo, "src", "a.ts"), "// changed\n");
  const asking = transcript("asking", [user("do the thing"), assistant("I changed a.ts.\n\nShall I also update the tests?")]);
  silent(stop(repo, { transcript_path: asking }), "ends on a question");
  const askingBold = transcript("asking-bold", [user("x"), assistant("Question 2 of 5 — **Keep the old name?**")]);
  silent(stop(repo, { transcript_path: askingBold }), "a bold question");
  const done = transcript("done", [user("do the thing"), assistant("Is that right? Yes.\n\nDone: a.ts changed and the tests pass.")]);
  blocked(stop(repo, { transcript_path: done }), "ends on a statement — the earlier question inside the turn does not count");
  const toolsAfter = transcript("tools-after", [assistant("Running the tests now?"), { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: {} }] } }, assistant("All green.")]);
  blocked(stop(repo, { transcript_path: toolsAfter }), "the last TEXT decides, tool calls between are skipped");
  blocked(stop(repo, { transcript_path: join(scratch, "missing.jsonl") }), "no transcript: not mid-task (Codex sends none)");
  blocked(stop(repo), "no transcript_path: as before");
  assert.equal(lastAssistantText(done), "Is that right? Yes.\n\nDone: a.ts changed and the tests pass.");
  assert.equal(endsOnQuestion("Move the lock?"), true);
  assert.equal(endsOnQuestion("Moved the lock."), false);
  assert.equal(endsOnQuestion(null), false);
});

test("C5: a diff holding only files ZDD itself writes — the lock, the import line, a pin — is the upgrade's own pause, never prompted for; code beside them still is", () => {
  const repo = mkRepo();
  writeFileSync(join(repo, ".claude", "settings.json"), JSON.stringify({ extraKnownMarketplaces: { "zero-drift-docs": { source: { source: "github", repo: "rich-rees/zero-drift-docs", ref: "v2.3.0" }, autoUpdate: false } } }) + "\n");
  silent(stop(repo), "a lock-only change");
  writeFileSync(join(repo, "CLAUDE.md"), "# Repo\n\n@zdd/instructions.md\n");
  writeFileSync(join(repo, ".gitattributes"), "zdd/** text eol=lf\n");
  silent(stop(repo), "the import line and .gitattributes too");
  writeFileSync(join(repo, "src", "a.ts"), "// changed\n");
  blocked(stop(repo), "code changed beside them: the prompt stands");
  assert.ok(ZDD_MANAGED.includes(".claude/settings.json") && ZDD_MANAGED.includes("CLAUDE.md"));
});

test("17: the fence judges the write's target — a one-liner writing a scratch file whose text names a generated path passes; writing the generated path itself is still refused; copy and rename take their destination", () => {
  const repo = mkRepo();
  const fence = (command) => spawnSync(process.execPath, [FENCE], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }), encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: repo }, cwd: repo });
  const passes = [
    "node -e \"const p = 'zdd/metadata/table/x.json'; require('fs').writeFileSync('/tmp/scratch.mjs', 'console.log(' + JSON.stringify(p) + ')')\"",
    "node -e \"require('fs').writeFileSync('scratch/probe.mjs', 'zdd/metadata/table/x.json')\"",
    "python -c \"open('scratch/notes.txt','w').write('see zdd/graph.json')\"",
    "node -e \"fs.copyFileSync('zdd/graph.json', '/tmp/copy.json')\"",
    "python -c \"import shutil; shutil.copy('zdd/graph.json', '/tmp/copy.json')\"",
  ];
  for (const command of passes) {
    const r = fence(command);
    assert.equal(r.stdout, "", `should pass: ${command}\n${r.stdout}`);
  }
  const refused = [
    "node -e \"require('fs').writeFileSync('zdd/graph.json','{}')\"",
    "node -e \"const out = 'zdd/graph.json'; fs.writeFileSync(out, '{}'); fs.writeFileSync('zdd/agent-index.md', 'x')\"",
    "python -c \"open('zdd/graph.json','w').write('x')\"",
    "node -e \"fs.copyFileSync('/tmp/x.json', 'zdd/graph.json')\"",
    "python -c \"import shutil; shutil.move('/tmp/x.json', 'zdd/graph.json')\"",
    "python -c \"import os; os.remove('zdd/graph.json')\"",
    "perl -e \"rename 'x', 'zdd/graph.json'\"",
  ];
  for (const command of refused) {
    const r = fence(command);
    assert.match(r.stdout, /"permissionDecision":"deny"/, `should refuse: ${command}`);
  }
});
