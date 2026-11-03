// The test-only adapter's own test, laid out as a starter's travels with
// it: it imports node: built-ins, its adapter, and ZDD only through the
// kit by the package's name, which `zdd-engine test` resolves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ioFor, trialRead } from "@rich-rees/zdd";
import * as notes from "../index.mjs";

const ADAPTERS = fileURLToPath(new URL("../../", import.meta.url));

test("notes: a GET line is a route; the trial read proposes the folder it is in, and skips what any adapter beside it skips", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-notes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["notes", "vendored/notes"]) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "a.note"), "GET /a\n# GET /old\n");
  }
  const out = notes.derive({ repoRoot: root, options: { roots: ["notes"] }, io: ioFor(root, "notes") });
  assert.deepEqual(out.records.map((r) => r.id), ["route:/a"]);
  const d = await trialRead(notes, root, ADAPTERS);
  assert.deepEqual(d.proposal.options, { roots: ["notes"] }, "vendored/ is skipped: the lists adapter beside it names it");
});
