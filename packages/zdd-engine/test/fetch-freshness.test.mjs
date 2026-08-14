// refreshOriginBase: the changed-set highlight diffs against
// merge-base(HEAD, origin/<base>), so origin/<base> must be fetched before
// computing it — except in CI, and never fatally (offline renders proceed).
// Run: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshOriginBase } from "../src/lib/fetch-freshness.mjs";

test("fetches the configured base branch outside CI", () => {
  const calls = [];
  const git = (...args) => void calls.push(args);
  const result = refreshOriginBase(git, "main", {}, () => {});
  assert.equal(result, "fetched");
  assert.deepEqual(calls, [["fetch", "origin", "main"]]);
});

test("a non-default base branch is fetched verbatim", () => {
  const calls = [];
  const git = (...args) => void calls.push(args);
  refreshOriginBase(git, "master", {}, () => {});
  assert.deepEqual(calls, [["fetch", "origin", "master"]]);
});

test("skips the fetch when CI is set", () => {
  const calls = [];
  const git = (...args) => void calls.push(args);
  const result = refreshOriginBase(git, "main", { CI: "true" }, () => {});
  assert.equal(result, "skipped-ci");
  assert.deepEqual(calls, []);
});

test("a failed fetch warns and proceeds, never throws", () => {
  const warnings = [];
  const git = () => {
    throw new Error("fatal: unable to access remote\nextra detail");
  };
  const result = refreshOriginBase(git, "main", {}, (msg) => warnings.push(msg));
  assert.equal(result, "failed");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /origin\/main/);
  assert.match(warnings[0], /unable to access remote/);
  assert.ok(!warnings[0].includes("extra detail"), "first line of the error only");
});
