// ZDD's own text names commands a user can run (ZDD-10, finding 3 of
// PressPlay's move to 0.11.0): `zdd-engine` is the engine's bin, not a
// command on an adopter's machine, and `@rich-rees/zdd-engine` is the old
// line's package. The skills, templates and ZDD's instructions say "the
// engine's `lint`" (or the pinned npx line); the upgrade rewrites the old
// package's name in an owned workflow's comments, where the pin moved but
// the comment did not. Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { refreshHeader } from "../scripts/bootstrap.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shipped = (dir) => {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...shipped(p));
    else if (/\.(md|json|yml|tmpl)$/.test(e.name) || e.name === "pre-push") out.push(p);
  }
  return out;
};

test("ZDD-10: no skill, template or instructions text names `zdd-engine <verb>` as a command", () => {
  const hits = [];
  for (const p of [...shipped(join(PLUGIN, "skills")), ...shipped(join(PLUGIN, "templates"))]) {
    readFileSync(p, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/`zdd-engine [a-z]/.test(line)) hits.push(`${p.slice(PLUGIN.length + 1)}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(hits, []);
});

test("ZDD-10: the upgrade rewrites the old package's name in an owned workflow's comments, never in its steps", () => {
  const owned = [
    "# Zero-Drift Docs — blocking CI check.",
    '# Managed by Zero-Drift Docs (zdd): written by `zdd:bootstrap`; "upgrade ZDD"',
    "# rewrites the engine pin below. Remove this header line to take ownership",
    "# of the file.",
    "#",
    "# Deterministic only: it calls the same @rich-rees/zdd-engine the plugin's skills call, so",
    "   # indented: @rich-rees/zdd-engine@2.4.1 was the old pin",
    "env:",
    '  ZDD_ENGINE: "@rich-rees/zdd@0.11.0"',
    "  OTHER: @rich-rees/zdd-engine-tools # a package of the team's own, not ZDD's",
    "",
  ].join("\r\n");
  const out = refreshHeader(owned);
  assert.match(out, /^# Deterministic only: it calls the same @rich-rees\/zdd the plugin's skills call, so\r$/m);
  assert.match(out, /^ {3}# indented: @rich-rees\/zdd-engine@2\.4\.1 was the old pin\r$/m, "an old-line version is history, never renamed into a version the new package lacks");
  assert.match(out, /^ {2}OTHER: @rich-rees\/zdd-engine-tools # a package of the team's own, not ZDD's\r$/m, "a step line and a longer name are never touched");
  assert.equal(out.split("\r\n").length, owned.split("\r\n").length, "line endings kept");
  assert.equal(refreshHeader(out), out, "idempotent");
});
