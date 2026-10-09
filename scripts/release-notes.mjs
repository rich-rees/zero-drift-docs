#!/usr/bin/env node
// The GitHub release's notes are the README's Versioning entry for the tag,
// lifted verbatim (CAS-103, the release action): the two cannot disagree.
//
//   node scripts/release-notes.mjs vX.Y.Z   # prints the entry's markdown
//
// The entry is the README list item that opens `- **\`X.Y.Z\` — …`, up to
// the next entry or the next heading. Exit 1 when there is none: a release
// without a Versioning entry is a release the checklist forbids.
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) {
  console.error("usage: release-notes.mjs vX.Y.Z");
  process.exit(2);
}
const version = tag.slice(1);
const lines = readFileSync(join(ROOT, "README.md"), "utf8").split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith(`- **\`${version}\` — `));
if (start === -1) {
  console.error(`README.md has no Versioning entry for ${version} (a line opening "- **\`${version}\` — ")`);
  process.exit(1);
}
let end = start + 1;
while (end < lines.length && !/^- \*\*`\d+\.\d+\.\d+`/.test(lines[end]) && !/^#/.test(lines[end])) end++;
const entry = lines.slice(start, end).join("\n").trimEnd();
process.stdout.write(`${entry.replace(/^- /, "")}\n\nEngine: \`npx -y @rich-rees/zdd-engine@${version}\`. Plugin: \`claude plugin marketplace add rich-rees/zero-drift-docs@${tag} --scope project\`, then \`claude plugin install zdd@zero-drift-docs --scope project\`. Adopters on an earlier release say "upgrade ZDD".\n`);
