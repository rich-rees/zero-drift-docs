import { test } from "node:test";
import assert from "node:assert/strict";
import { firstSentence, supersessionStamps, buildAdrIndex, rebaseAdrLinks } from "../src/lib/adr-index.mjs";

const PLAIN = [
  "# Region per deployment",
  "",
  "Each market gets its own isolated stack. Regions share no data.",
  "",
  "More prose here.",
].join("\n");

const STAMPED = [
  "# Codebase wiki",
  "",
  "> **Superseded in part by [ADR-0019](0019-zero-drift-docs-quadrumvirate.md)** (2026-07-20): the bundle splits.",
  "",
  "> **Superseded in part by [ADR-0021](0021-wiki-embeds.md)** (2026-07-21): links change.",
  "",
  "The wiki is a rendering, never a home. It is machine-written.",
].join("\n");

const INLINE_STAMP = [
  "# FACT store",
  "",
  "FACTs are latest-only; validity is computed on read, never stored.",
  "",
  "**Superseded in part by ADR-0031** (2026-08-01): the option_label rule stops being universal.",
].join("\n");

test("firstSentence takes the first sentence of the first prose paragraph", () => {
  assert.equal(
    firstSentence(PLAIN),
    "Each market gets its own isolated stack.",
  );
});

test("firstSentence skips the title and blockquote stamp lines", () => {
  assert.equal(
    firstSentence(STAMPED),
    "The wiki is a rendering, never a home.",
  );
});

test("firstSentence joins hard-wrapped paragraph lines before splitting", () => {
  const wrapped = [
    "# E2E",
    "",
    "The Playwright suite runs against an app that the",
    "workflow builds itself, never the preview URL.",
    "",
    "Second paragraph.",
  ].join("\n");
  assert.equal(
    firstSentence(wrapped),
    "The Playwright suite runs against an app that the workflow builds itself, never the preview URL.",
  );
});

test("firstSentence caps runaway sentences", () => {
  const long = "# T\n\n" + "word ".repeat(100) + "end.";
  const s = firstSentence(long);
  assert.ok(s.length <= 220, `too long: ${s.length}`);
  assert.ok(s.endsWith("…"));
});

test("supersessionStamps finds blockquote stamps with target numbers", () => {
  assert.deepEqual(supersessionStamps(STAMPED), [
    { partial: true, by: "0019" },
    { partial: true, by: "0021" },
  ]);
});

test("supersessionStamps finds inline bold stamps", () => {
  assert.deepEqual(supersessionStamps(INLINE_STAMP), [{ partial: true, by: "0031" }]);
});

test("supersessionStamps distinguishes full supersession", () => {
  const full = "# X\n\n> **Superseded by [ADR-0009](0009-x.md)** (2026-07-01): replaced.\n\nBody.";
  assert.deepEqual(supersessionStamps(full), [{ partial: false, by: "0009" }]);
});

test("buildAdrIndex renders one line per ADR, numerically sorted, with stamps", () => {
  const adrs = [
    { num: "0004", file: "0004-codebase-wiki.md", title: "Codebase wiki", body: STAMPED },
    { num: "0001", file: "0001-region.md", title: "Region per deployment", body: PLAIN },
  ];
  const out = buildAdrIndex(adrs);
  const lines = out.split("\n");
  // Header identifies it as generated.
  assert.ok(lines[0].startsWith("# ADR index"), lines[0]);
  assert.ok(out.includes("do not edit"));
  const i1 = out.indexOf("ADR-0001");
  const i4 = out.indexOf("ADR-0004");
  assert.ok(i1 !== -1 && i4 !== -1 && i1 < i4, "numeric order");
  assert.ok(
    out.includes("[ADR-0001](adr/0001-region.md) — Region per deployment — Each market gets its own isolated stack."),
    out,
  );
  assert.ok(out.includes("superseded in part by ADR-0019, ADR-0021"), out);
});

test("buildAdrIndex is deterministic", () => {
  const adrs = [{ num: "0001", file: "0001-region.md", title: "Region per deployment", body: PLAIN }];
  assert.equal(buildAdrIndex(adrs), buildAdrIndex(adrs));
});

// DIO-226 review finding: a supersession sentence opens with a link relative to
// zdd/adr/, but the index it lands in sits at zdd/adr-index.md — so the href has
// to be rebased or it 404s.
test("rebaseAdrLinks rewrites sibling ADR hrefs onto adr/", () => {
  assert.equal(
    rebaseAdrLinks("Supersedes in part [ADR-0043](0043-narration.md): the auto-pick goes."),
    "Supersedes in part [ADR-0043](adr/0043-narration.md): the auto-pick goes.",
  );
});

test("rebaseAdrLinks leaves already-qualified and absolute links alone", () => {
  const already = "See [ADR-0043](adr/0043-narration.md).";
  assert.equal(rebaseAdrLinks(already), already);
  const absolute = "See [spec](https://example.com/0043-narration.md).";
  assert.equal(rebaseAdrLinks(absolute), absolute);
});

// An anchored sibling link 404s just the same, so it is rebased too — the
// anchor rides along untouched.
test("rebaseAdrLinks rebases anchored sibling links and keeps the anchor", () => {
  assert.equal(
    rebaseAdrLinks("See [ADR-0043](0043-narration.md#why)."),
    "See [ADR-0043](adr/0043-narration.md#why).",
  );
});

test("buildAdrIndex rebases links carried inside an extracted first sentence", () => {
  const body = "# Codex is the default lane\n\nSupersedes in part [ADR-0043](0043-narration.md): the auto-pick is withdrawn.\n";
  const out = buildAdrIndex([{ num: "0065", file: "0065-codex.md", title: "Codex is the default lane", body }]);
  assert.ok(out.includes("](adr/0043-narration.md)"), out);
  assert.ok(!out.includes("](0043-narration.md)"), out);
});

// CAS-93: the length cap ran before the links were rebased, so a cap that
// landed inside "[ADR-0016](0016-…" left half a link in the index — one that
// ADR_HREF_RE no longer matched, so it never got its adr/ prefix either. Seen
// in DiO (ADR-0094, ADR-0110) and Cascade (ADR-0019, ADR-0037, ADR-0042).
test("firstSentence never cuts inside a markdown link — the cut backs off to before the [", () => {
  const prose = "This decision replaces the earlier draft and its publishing rules because the pipeline moved: ".repeat(2);
  const body = `# T\n\n${prose}see [ADR-0016](0016-publish-is-driven-by-the-release-branch-not-the-tag.md) for the old shape.`;
  const s = firstSentence(body);
  assert.ok(s.endsWith("…"), s);
  assert.ok(!/\[[^\]]*$/.test(s), `cut inside a link text: ${s}`);
  assert.ok(!/\]\([^)]*$/.test(s), `cut inside a link target: ${s}`);
  assert.ok(!s.includes("[ADR-0016]"), `link should have been dropped whole, not cut: ${s}`);
});

test("buildAdrIndex carries no half link when the cap falls inside a link's target", () => {
  // Pad so position 199 lands inside "(0016-publish-…": the pre-fix output was
  // "[ADR-0016](0016-publish-is-dr…" — a link with no closing paren and no adr/.
  const link = "[ADR-0016](0016-publish-is-driven-by-the-release-branch-not-the-tag.md)";
  const pad = "x".repeat(199 - 12 - "[ADR-0016](".length);
  const body = `# T\n\nSupersedes ${pad} ${link} and more.`;
  const out = buildAdrIndex([{ num: "0019", file: "0019-x.md", title: "X", body }]);
  const line = out.split("\n").find((l) => l.startsWith("- [ADR-0019]"));
  assert.ok(!line.includes("[ADR-0016]"), `cut link survived into the index: ${line}`);
  assert.ok(line.endsWith("…"), line);
});
