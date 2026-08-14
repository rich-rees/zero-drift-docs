// Regression: DIO-148 — CRLF checkouts (Windows core.autocrlf=true) broke
// parseFrontmatter, blocking render.mjs --check ("missing frontmatter" x18)
// and with it the /zdd-update ritual. CI never saw it: Linux checkouts are LF.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter } from "../src/lib/frontmatter.mjs";

const LF = `---
type: Feature
title: Auth
description: "NextAuth v5 session middleware"
tags: [sso, entra]
---
Body line one.

Body line two.
`;

test("parses LF frontmatter (baseline)", () => {
  const parsed = parseFrontmatter(LF);
  assert.ok(parsed, "LF must parse");
  assert.equal(parsed.frontmatter.type, "Feature");
  assert.equal(parsed.frontmatter.title, "Auth");
  assert.equal(parsed.frontmatter.description, "NextAuth v5 session middleware");
  assert.deepEqual(parsed.frontmatter.tags, ["sso", "entra"]);
  assert.equal(parsed.body, "Body line one.\n\nBody line two.\n");
});

test("parses CRLF frontmatter identically to LF (the DIO-148 bug)", () => {
  const crlf = LF.replace(/\n/g, "\r\n");
  const parsed = parseFrontmatter(crlf);
  assert.ok(parsed, "CRLF must parse — autocrlf checkouts are a supported input");
  // Deep-equal against the LF parse: catches both the regex miss AND the
  // second-order bug (values keeping a trailing \r after split("\n")).
  assert.deepEqual(parsed, parseFrontmatter(LF));
});

test("CRLF values carry no trailing carriage returns", () => {
  const parsed = parseFrontmatter("---\r\ntype: Feature\r\ntitle: Auth\r\n---\r\nbody\r\n");
  assert.equal(parsed.frontmatter.type, "Feature");
  assert.doesNotMatch(parsed.frontmatter.type, /\r/);
  assert.equal(parsed.body, "body\n");
});

test("returns null when there is no frontmatter", () => {
  assert.equal(parseFrontmatter("just a body\n"), null);
  assert.equal(parseFrontmatter(""), null);
});
