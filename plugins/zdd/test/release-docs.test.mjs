// CAS-101: the release checklist, backed where a test can reach. The README's
// and CONTRIBUTING's status lines name the plugin's version — 2.0.0 and 2.1.0
// both shipped with CONTRIBUTING still saying an older one — and the README
// has a roadmap and a Versioning entry for it.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PLUGIN, "..", "..");
const VERSION = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;
const README = readFileSync(join(ROOT, "README.md"), "utf8");
const lines = (text) => text.split(/\r?\n/);

test("README status names the plugin version", () => {
  assert.ok(README.includes(`**Status: ${VERSION}.**`), `README: "**Status: ${VERSION}.**"`);
});

test("CONTRIBUTING status names the plugin version", () => {
  assert.ok(readFileSync(join(ROOT, "CONTRIBUTING.md"), "utf8").includes(`ZDD is \`${VERSION}\``), `CONTRIBUTING: "ZDD is \`${VERSION}\`"`);
});

test("README's roadmap and Versioning each have an entry for this release", () => {
  assert.ok(lines(README).some((l) => l.startsWith(`- [x] **${VERSION}**`)), `roadmap: "- [x] **${VERSION}**"`);
  assert.ok(lines(README).some((l) => l.startsWith(`- **\`${VERSION}\` —`)), `Versioning: "- **\`${VERSION}\` —"`);
});
