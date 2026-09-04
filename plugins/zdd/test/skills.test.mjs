// The four SKILL.md frontmatters, parsed the way a STRICT YAML reader parses
// them. Claude Code's reader is lenient; Codex's is not — a description that
// began with a quoted phrase and continued after the closing quote
// (`description: "load ZDD" — the declared load…`) is a YAML error there, and
// the skill silently vanished from Codex's list (found by the DIO-312 live
// smoke test: Codex offered bootstrap and grill only). Dependency-free: the
// subset of YAML a frontmatter uses is `key: scalar` lines, and a scalar that
// opens with a quote must close at end of line with nothing after it.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const DOUBLE = new RegExp('^"(?:[^"\\\\]|\\\\.)*"$');
const SINGLE = new RegExp("^'(?:[^']|'')*'$");
const INDICATOR = /^[[\]{}&*!|>%@`,]/;

export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  assert.ok(m, "frontmatter block present");
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    assert.ok(kv, `plain key: value line, got ${JSON.stringify(line)}`);
    const key = kv[1];
    let v = kv[2].trim();
    if (v.startsWith('"')) {
      assert.match(v, DOUBLE, `${key}: a double-quoted scalar must end at its closing quote (got: ${v.slice(0, 40)}…)`);
      v = JSON.parse(v);
    } else if (v.startsWith("'")) {
      assert.match(v, SINGLE, `${key}: a single-quoted scalar must end at its closing quote`);
      v = v.slice(1, -1).replace(/''/g, "'");
    } else {
      assert.ok(!INDICATOR.test(v), `${key}: unquoted scalar starts with a YAML indicator — quote it`);
      assert.ok(!/: /.test(v) && !/\s#/.test(v), `${key}: unquoted scalar contains ': ' or ' #' — quote it`);
    }
    out[key] = v;
  }
  return out;
}

test("the parser itself rejects the shape that hid load and update from Codex", () => {
  assert.throws(() => frontmatter('---\nname: x\ndescription: "load ZDD" — the declared load.\n---\n'), /closing quote/);
  assert.equal(frontmatter('---\nname: x\ndescription: "\\"load ZDD\\" — the declared load."\n---\n').description, '"load ZDD" — the declared load.');
});

for (const dir of readdirSync(SKILLS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
  test(`skills/${dir}/SKILL.md: strict frontmatter, name matches its directory, description present`, () => {
    const fm = frontmatter(readFileSync(join(SKILLS, dir, "SKILL.md"), "utf8"));
    assert.equal(fm.name, dir);
    assert.ok(typeof fm.description === "string" && fm.description.length > 40, "description is a real sentence");
    assert.ok(fm.description.length < 1024, "description under the hosts' budget");
  });
}
