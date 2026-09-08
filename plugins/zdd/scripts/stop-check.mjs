#!/usr/bin/env node
// ZDD Stop hook — the prompt for the curated half. The CI check makes drift in
// the GENERATED artifacts un-mergeable; the curated half (glossary, ADRs,
// comments, the map with its blessings) is protected only by the finish
// ritual, and the moment the ritual gets skipped is the moment the agent
// declares done. This hook fires when the agent ends a turn, and if code has
// changed on this branch while nothing in the ZDD bundle moved, it blocks
// ONCE with one line: run the ritual, or say that nothing met the three-part
// test. It is a prompt, not a check — it cannot verify the answer, and a
// truthful "nothing to change" is the right answer often (decision 0008).
//
// Opt-in per repo: it does nothing unless the adopter's VALID zdd/config.json
// says `"hooks": { "stop": true }` (bootstrap writes that on a "yes"; a repo
// bootstrapped before 1.1 has no key and stays silent). Never traps the agent:
// silent when the host says a Stop hook already blocked this continuation
// (`stop_hook_active`); silent after this hook has blocked once in the
// session (a marker keyed by the session id, in the OS temp dir); and silent
// whenever it cannot PROVE it will be silent next time — no session id, or a
// marker it could not create exclusively (CR-001, CR-002). Blocking is the
// JSON `{"decision":"block","reason"}` reply on stdout with exit 0 — the
// shape both hosts honour; exit 2 fails open in Codex (decision 0007).
//
// "Code changed": any path under the adopter root that differs from the
// merge-base with the base branch (origin/<baseBranch>, else the local
// branch, else HEAD alone — the working tree included, untracked files
// included) and is not a ZDD artifact. "ZDD moved": any such path inside the
// bundle dir or at one of the configured artifact paths. Paths outside the
// adopter root (a sibling package in a monorepo) are nobody's business here
// (CR-009). No git, no config, no changes, anything unexpected: exit 0,
// silently — a hook that errors punishes every session.
//
// Budget: the host kills the hook at hooks.json's timeout (15 s), so every
// git call gets only what is left of one global deadline well inside that
// (CR-004); stdin is read up to a cap (CR-003); git paths are taken NUL-
// delimited so a quoted (non-ASCII) name cannot be misclassified (CR-005).

import { execFileSync } from "node:child_process";
import { readSync, openSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { readConfig, artifactPaths, adopterRoot, posixify, isUnder, samePath } from "./lib/repo.mjs";

export const MAX_STDIN_BYTES = 256 * 1024; // a Stop payload is a few hundred bytes; over this is not a payload
export const DEADLINE_MS = 10_000; // hooks.json gives 15 s; leave the host a margin
const MAX_SESSION_ID = 256;

// The host's Stop payload, or null when there is none to read: a hook that
// cannot see `stop_hook_active` or the session id has no way to promise it
// will not trap the agent, so it stays silent rather than guess. Read up to
// the cap and no further (CR-003).
function readStdin() {
  try {
    const chunks = [];
    let total = 0;
    const buf = Buffer.alloc(16 * 1024);
    for (;;) {
      let n;
      try {
        n = readSync(0, buf, 0, buf.length, null);
      } catch (e) {
        if (e.code === "EAGAIN") continue;
        if (e.code === "EOF") break;
        throw e;
      }
      if (n === 0) break;
      total += n;
      if (total > MAX_STDIN_BYTES) return null;
      chunks.push(Buffer.from(buf.subarray(0, n)));
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// One deadline for the whole run; each git call gets the remainder.
export function gitRunner(deadlineAt = Date.now() + DEADLINE_MS) {
  return (cwd, ...args) => {
    const left = deadlineAt - Date.now();
    if (left <= 0) throw new Error("deadline");
    return execFileSync("git", args, { cwd, encoding: "buffer", stdio: ["ignore", "pipe", "ignore"], timeout: left, maxBuffer: 16 * 1024 * 1024 });
  };
}
const text = (buf) => buf.toString("utf8").trimEnd();
const nulList = (buf) => buf.toString("utf8").split("\0").filter(Boolean);

// The paths that differ between the working tree (untracked included) and the
// best base we can find, relative to the git top level, NUL-delimited so git
// never quotes them (CR-005). Null when there is no usable git here.
export function changedPaths(root, baseBranch, git = gitRunner()) {
  let top;
  try {
    top = text(git(root, "rev-parse", "--show-toplevel"));
  } catch {
    return null;
  }
  const base = mergeBase(root, baseBranch, git);
  const out = new Set();
  try {
    for (const f of nulList(git(root, "diff", "--name-only", "-z", base ?? "HEAD"))) out.add(f);
  } catch {
    // No HEAD yet (an unborn branch): every tracked file is a change against nothing.
    try {
      for (const f of nulList(git(root, "ls-files", "-z", "--full-name"))) out.add(f);
    } catch {
      return null;
    }
  }
  try {
    // --full-name: ls-files is cwd-relative by default; diff is top-relative.
    for (const f of nulList(git(root, "ls-files", "-z", "--others", "--exclude-standard", "--full-name"))) out.add(f);
  } catch {
    /* untracked listing is best-effort */
  }
  return { top: resolve(top), paths: [...out] };
}

function mergeBase(root, baseBranch, git) {
  for (const ref of [`origin/${baseBranch}`, baseBranch]) {
    try {
      const mb = text(git(root, "merge-base", "HEAD", ref));
      if (mb) return mb;
    } catch {
      /* try the next ref */
    }
  }
  return null;
}

// A base branch name git itself accepts (CR-007): anything else falls back to
// "main" rather than silently degrading the diff to HEAD-only.
export function validBaseBranch(value, git) {
  if (typeof value !== "string" || !value || value.length > 256 || /[\s\x00-\x1f\x7f]/.test(value)) return "main";
  try {
    git(process.cwd(), "check-ref-format", "--branch", value);
    return value;
  } catch {
    return "main";
  }
}

// Where a session's "already blocked" marker lives: one file per session id
// (Claude Code and Codex both send one), under the OS temp dir. No usable
// session id ⇒ null ⇒ the hook stays silent (CR-001).
export function markerPath(sessionId, root) {
  if (typeof sessionId !== "string" || !sessionId || sessionId.length > MAX_SESSION_ID) return null;
  const key = createHash("sha256").update(`${sessionId}\0${resolve(root)}`).digest("hex").slice(0, 32);
  return join(tmpdir(), "zdd-stop", key);
}

// Claim the marker exclusively (`wx`: O_CREAT|O_EXCL — fails on an existing
// file AND on a symlink, dangling or not). True only when THIS run created
// it; an existing marker or any failure means "do not block" (CR-002): the
// prompt is worth less than the promise never to loop.
export function claimMarker(marker) {
  try {
    const { mkdirSync } = fsModule;
    mkdirSync(join(tmpdir(), "zdd-stop"), { recursive: true });
    const fd = openSync(marker, "wx");
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}
import * as fsModule from "node:fs";

const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p); // CR-006

// Split the git top-relative paths into this adopter's ZDD artifacts and its
// code, dropping everything outside the adopter root (CR-009). Returned paths
// are adopter-relative.
export function classify(changed, root, config) {
  // Both sides through realpath: git's top level is the canonical long path,
  // the adopter root may be spelled via a short (8.3) or differently-cased
  // segment (the D:-drive CI runner), and `relative` would then see two trees.
  const real = (p) => {
    try {
      return fsModule.realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  const rootRel = posixify(relative(real(changed.top), real(root)));
  if (rootRel.startsWith("..") || isAbsolute(rootRel)) return null; // the adopter root is not inside this git checkout
  const prefix = rootRel && rootRel !== "." ? rootRel + "/" : "";
  const paths = artifactPaths(config, { lenient: true });
  const zddPrefixes = [paths.bundleDir, paths.glossary, paths.adrDir, paths.mapDir, paths.metadataDir, paths.agentIndex, paths.adrIndex, paths.humanIndex, paths.graph]
    .filter(Boolean)
    .map(fold);
  const isZdd = (f) => zddPrefixes.some((z) => fold(f) === z || fold(f).startsWith(z + "/"));
  const zdd = [];
  const code = [];
  for (const f of changed.paths) {
    if (prefix && !fold(f).startsWith(fold(prefix))) continue;
    const rel = f.slice(prefix.length);
    if (!rel) continue;
    (isZdd(rel) ? zdd : code).push(rel);
  }
  return { zdd, code };
}

// Filenames come from the checkout; a control character in one must not
// reach the model's context or the terminal as anything but "?".
const printable = (s) => s.replace(/[\x00-\x1f\x7f]/g, "?");

export function reason(code, bundleDir) {
  const n = code.length;
  return (
    `ZDD: ${n} file${n === 1 ? "" : "s"} changed on this branch (e.g. ${code.slice(0, 3).map(printable).join(", ")}${n > 3 ? ", …" : ""}) ` +
    `but nothing under ${bundleDir}/ moved. Before finishing, run the finish ritual — say "update ZDD" (the \`update\` skill): ` +
    `curate the glossary, ADRs, code comments and semantic map the change touched, then regenerate — or state explicitly that ` +
    `no decision met the three-part ADR test and no term, comment, edge or blessing changed. This prompt fires once per session.`
  );
}

// The payload's cwd is untrusted (CR-010): it may steer root discovery only
// within the tree the process itself was started in — the same checkout, a
// package below it, or an ancestor of it — never to some other repo on disk.
export function trustedCwd(candidate) {
  if (typeof candidate !== "string" || !candidate || !isAbsolute(candidate)) return undefined;
  const here = process.cwd();
  if (samePath(candidate, here) || isUnder(candidate, here) || isUnder(here, candidate)) return candidate;
  return undefined;
}

function main() {
  const input = readStdin();
  if (!input) return;
  if (input.stop_hook_active === true) return; // the host is already continuing because a Stop hook blocked — never trap the agent
  const git = gitRunner();

  const cwd = trustedCwd(input.cwd);
  const root = adopterRoot(cwd ? { cwd } : {});
  if (!root) return;
  const { state, config } = readConfig(root);
  if (state !== "valid" || config.hooks?.stop !== true) return;

  const marker = markerPath(input.session_id, root);
  if (!marker) return; // nothing to key "once" on — silence, not a guess (CR-001)

  const changed = changedPaths(root, validBaseBranch(config.baseBranch, git), git);
  if (!changed) return;
  const split = classify(changed, root, config);
  if (!split || !split.code.length || split.zdd.length) return;

  if (!claimMarker(marker)) return; // already blocked this session, or cannot promise not to loop (CR-002)
  const line = reason(split.code, artifactPaths(config, { lenient: true }).bundleDir);
  process.stdout.write(JSON.stringify({ decision: "block", reason: line }) + "\n");
  process.stderr.write(line + "\n"); // mirrored for the hook log, as the fence does
}

if (process.argv[1] && posixify(process.argv[1]).endsWith("/scripts/stop-check.mjs")) {
  try {
    main();
  } catch {
    process.exitCode = 0;
  }
}
