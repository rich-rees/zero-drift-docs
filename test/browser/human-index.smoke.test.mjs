// The human index, clicked (decision 0044). The engine suite proves the page's
// data (the BUNDLE golden) and its structure; this drives it in headless
// Chromium: every header button, the peek's filter and back history, a
// blessing to its cited ADR and back, a blessing to a node and back WITH A NODE
// ALREADY SELECTED (CR-167: the detail panel opened and closed at once, and no
// test or hand pass saw it), high blessings pinned first with their chip
// (decision 0045), a hostile blessing and the empty store. Every
// flow also fails on an uncaught page error, a dialog, or a request that
// leaves the page (the viewer contract promises none).
// Run: cd test/browser && npm ci && npx playwright install chromium && node --test "*.test.mjs"
// (on a clean Linux machine, `npx playwright install --with-deps chromium` also
// installs the system libraries Chromium needs).
import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = resolve(HERE, "..", "..", "packages", "zdd-engine");
const BIN = join(ENGINE, "bin", "zdd-engine.mjs");
const FIXTURE = join(ENGINE, "test", "fixture");
const ARTIFACTS = join(HERE, "artifacts");
// Longer than the slide-out's 0.25s transition and reveal's 200ms animation:
// CR-167's panel opened and then closed, so "open" is read only after both.
const SETTLE_MS = 400;

// The fixture rendered by the engine in this checkout, into a throwaway copy;
// `edit` changes the copy first (the committed fixture and goldens never move).
const repos = [];
function renderFixture(edit) {
  const repo = mkdtempSync(join(tmpdir(), "zdd-smoke-"));
  repos.push(repo);
  cpSync(FIXTURE, repo, { recursive: true });
  if (edit) edit(repo);
  for (const cmd of ["derive", "render"]) {
    execFileSync(process.execPath, [BIN, cmd], { cwd: repo, stdio: ["ignore", "ignore", "pipe"] });
  }
  return pathToFileURL(join(repo, "zdd", "human-index.html")).href;
}

// A blessing that tries every way into the page: raw HTML, event handlers
// (which would also raise a dialog), script-scheme links (markdown and raw),
// an iframe, and markup that fetches on its own (a stylesheet import, a
// stylesheet link, a video poster, a markdown image: a beacon the request
// guard catches). Its trigger question carries markup too, so the list row
// and the title are tried.
const HOSTILE = `---
where: src/app/page.tsx
kind: copy
---

Adding a <img src=x onerror="window.__pwned=1;alert(1)">hostile page? Never run
<script>window.__pwned=1;alert(2)</script> markup, never follow
[this link](javascript:window.__pwned=1) or <a href="javascript:window.__pwned=1">this one</a>,
and never frame <iframe src="javascript:window.__pwned=1"></iframe> or <svg onload="window.__pwned=1;alert(3)"></svg> anything.
<style>@import url(https://beacon.invalid/import.css);</style>
<link rel="stylesheet" href="https://beacon.invalid/link.css">
<video poster="https://beacon.invalid/poster.png"></video>

![a beacon](https://beacon.invalid/pixel.png)
`;

let browser, urls;
before(() => {
  urls = {
    fixture: renderFixture(),
    hostile: renderFixture((repo) => writeFileSync(join(repo, "zdd", "blessings", "hostile.md"), HOSTILE)),
    // A second high blessing whose question sorts after the fixture's high
    // one and after every normal one's — so only the pin puts it on top.
    twoHigh: renderFixture((repo) => writeFileSync(join(repo, "zdd", "blessings", "showing-a-thing.md"),
      "---\nwhere: src/app/page.tsx\nkind: copy\nimportance: high\n---\n\nShowing a thing? Copy the page because x.\n")),
    empty: renderFixture((repo) => {
      const dir = join(repo, "zdd", "blessings");
      for (const f of readdirSync(dir)) rmSync(join(dir, f));
    }),
  };
});
before(async () => { browser = await chromium.launch(); });
after(async () => {
  try {
    await browser?.close();
  } finally {
    for (const r of repos) rmSync(r, { recursive: true, force: true });
  }
});

// One page per test. An uncaught page error, a dialog, or a request that
// leaves the page fails the flow it happened in; an off-page request is also
// refused, so a beacon never reaches the network.
let context, page, pageErrors, dialogs, offPage;
beforeEach(async () => {
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  page = await context.newPage();
  pageErrors = [];
  dialogs = [];
  offPage = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
  page.on("request", (r) => { if (!/^(file|data|blob|about):/i.test(r.url())) offPage.push(r.url()); });
  await context.route(/^(?!file:|data:|blob:|about:)/i, (route) => route.abort());
});
afterEach(async () => { await context.close(); });
// A failing flow leaves a screenshot of the page as it failed; CI uploads it.
const smoke = (name, fn) => test(name, async () => {
  try {
    await fn();
    assert.deepEqual(pageErrors, [], "no uncaught page errors");
    assert.deepEqual(dialogs, [], "no dialogs");
    assert.deepEqual(offPage, [], "no request leaves the page");
  } catch (e) {
    mkdirSync(ARTIFACTS, { recursive: true });
    await page.screenshot({ path: join(ARTIFACTS, `${name.replace(/[^\w-]+/g, "_")}.png`) }).catch(() => {});
    throw e;
  }
});

async function open(url) {
  await page.goto(url);
  await page.waitForSelector("#graph canvas");
}
const settle = () => page.waitForTimeout(SETTLE_MS);
const isOpen = (sel) => page.$eval(sel, (el) => el.classList.contains("open"));
const text = (sel) => page.$eval(sel, (el) => el.textContent);
const isHidden = (sel) => page.$eval(sel, (el) => el.hidden);
const visibleCount = (sel) => page.$$eval(sel, (els) => els.filter((el) => !el.hidden).length);

async function expectDocs(title, back) {
  await settle();
  assert.equal(await isOpen("#docs"), true, `the peek is open on ${title}`);
  assert.equal(await isOpen("#detail"), false, "the detail panel is closed");
  assert.equal(await text("#docs-title"), title);
  if (back === null) assert.equal(await isHidden("#docs-back"), true, `no back on ${title}`);
  else {
    assert.equal(await isHidden("#docs-back"), false, `a back on ${title}`);
    assert.equal(await text("#docs-back"), `← ${back}`);
  }
}
async function expectDetail(id, back) {
  await settle();
  assert.equal(await isOpen("#detail"), true, `the detail panel stays open on ${id}`);
  assert.equal(await isHidden("#detail-content"), false);
  assert.equal(await isOpen("#docs"), false, "the peek is closed");
  assert.equal(await text("#detail-id"), id);
  assert.equal(await isHidden("#detail-back"), false, "the detail panel offers the way back");
  assert.equal(await text("#detail-back"), `← ${back}`);
}
const clickDocs = (selector, name) => page.locator(`#docs-body ${selector}`, { hasText: name }).first().click();

// A real mouse tap on a graph node, at the node's place on the canvas. The
// cytoscape instance is the page's own (cytoscape keeps it on its container);
// only its coordinates are read from it.
async function tapNode(id) {
  const at = await page.evaluate((nodeId) => {
    const graph = document.getElementById("graph");
    const cy = graph._cyreg && graph._cyreg.cy;
    if (!cy) throw new Error("no cytoscape instance on #graph");
    const n = cy.$id(nodeId);
    if (!n.length) throw new Error(`no node ${nodeId} in this view`);
    const p = n.renderedPosition();
    const box = graph.getBoundingClientRect();
    return { x: box.left + p.x, y: box.top + p.y };
  }, id);
  await page.mouse.click(at.x, at.y);
}

smoke("each header button does its job", async () => {
  await open(urls.fixture);
  await page.click("#btn-glossary");
  await expectDocs("Glossary", null);
  assert.equal(await isHidden("#docs-filter"), false, "the glossary has the filter");
  assert.deepEqual(await page.$$eval("#docs-body strong.term", (els) => els.map((e) => e.textContent)), ["Thing", "Audit trail"]);

  await page.click("#btn-adrs");
  await expectDocs("Architecture Decision Records", null);
  assert.equal(await isHidden("#docs-filter"), false);
  assert.equal(await visibleCount("#docs-body .adr-item"), 2);

  await page.click("#btn-blessings");
  await expectDocs("Blessings", null);
  assert.equal(await isHidden("#docs-filter"), false);
  assert.deepEqual(await page.$$eval("#docs-body .blessing-item > b", (els) => els.map((e) => e.textContent)),
    ["Saving a thing?", "Adding a page?", "Adding an endpoint for things?"], "the high blessing is pinned first (decision 0045)");

  await page.keyboard.press("Escape");
  await settle();
  assert.equal(await isOpen("#docs"), false, "Escape closes the peek");

  // The theme toggle flips the theme and redraws; again flips it back.
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme || "light");
  const first = await theme();
  await page.click("#theme-toggle");
  await page.waitForSelector("#graph canvas");
  assert.notEqual(await theme(), first, "the theme toggle changes the theme");
  await page.click("#theme-toggle");
  assert.equal(await theme(), first, "and changes it back");

  // Reset redraws the view and closes an open node.
  await tapNode("metadata/table/db--things");
  await settle();
  assert.equal(await isOpen("#detail"), true, "a tap opens the node");
  await page.click("#reset");
  await settle();
  assert.equal(await isOpen("#detail"), false, "Reset closes the node");
  assert.equal(await page.evaluate(() => document.getElementById("graph")._cyreg.cy.$("node:selected").length), 0, "Reset clears the selection");
});

smoke("each list keeps its filter text across back", async () => {
  await open(urls.fixture);

  await page.click("#btn-adrs");
  await page.fill("#docs-filter", "widgets are");
  assert.equal(await visibleCount("#docs-body .adr-item"), 1);
  await clickDocs(".adr-item", "ADR-0001");
  await expectDocs("ADR-0001", "All ADRs");
  assert.equal(await isHidden("#docs-filter"), true, "a page has no filter");
  await page.click("#docs-back");
  await expectDocs("Architecture Decision Records", null);
  assert.equal(await page.inputValue("#docs-filter"), "widgets are");
  assert.equal(await visibleCount("#docs-body .adr-item"), 1);

  await page.click("#btn-blessings");
  assert.equal(await page.inputValue("#docs-filter"), "", "a header button starts fresh");
  await page.fill("#docs-filter", "saving");
  assert.equal(await visibleCount("#docs-body .blessing-item"), 1);
  await clickDocs(".blessing-item", "Saving a thing?");
  await expectDocs("Saving a thing?", "All blessings");
  await page.click("#docs-back");
  await expectDocs("Blessings", null);
  assert.equal(await page.inputValue("#docs-filter"), "saving");
  assert.equal(await visibleCount("#docs-body .blessing-item"), 1);

  await page.click("#btn-glossary");
  await page.fill("#docs-filter", "renamed");
  assert.deepEqual(await page.$$eval("#docs-body strong.term", (els) => els.filter((e) => !e.closest("[hidden]")).map((e) => e.textContent)), ["Thing"]);
  await clickDocs("a.internal", "ADR-0002");
  await expectDocs("ADR-0002", "Glossary");
  await page.click("#docs-back");
  await expectDocs("Glossary", null);
  assert.equal(await page.inputValue("#docs-filter"), "renamed");
  assert.equal(await visibleCount("#docs-body > p"), 1);
});

smoke("blessing → cited ADR → back → back", async () => {
  await open(urls.fixture);
  await page.click("#btn-blessings");
  await clickDocs(".blessing-item", "Adding an endpoint for things?");
  await expectDocs("Adding an endpoint for things?", "All blessings");
  await page.locator("#docs-body dl.frontmatter a.internal", { hasText: "ADR-0002" }).click();
  await expectDocs("ADR-0002", "Adding an endpoint for things?");
  await page.click("#docs-back");
  await expectDocs("Adding an endpoint for things?", "All blessings");
  await page.click("#docs-back");
  await expectDocs("Blessings", null);
  assert.equal(await visibleCount("#docs-body .blessing-item"), 3);
});

smoke("blessing → node → back to the blessing, with a node already selected (CR-167)", async () => {
  await open(urls.fixture);
  // A node selected on the graph first: the case every earlier pass missed.
  await tapNode("metadata/table/db--things");
  await settle();
  assert.equal(await isOpen("#detail"), true, "a tap opens the node");
  assert.equal(await text("#detail-id"), "metadata/table/db--things");

  // Applies to.
  await page.click("#btn-blessings");
  await expectDocs("Blessings", null);
  await clickDocs(".blessing-item", "Adding a page?");
  await page.locator("#docs-body dl.frontmatter a.internal", { hasText: "Fixture App" }).first().click();
  await expectDetail("map/apps/fixture-app", "Adding a page?");
  await page.click("#detail-back");
  await expectDocs("Adding a page?", "All blessings");
  assert.equal(await isHidden("#detail-back"), true, "the detail's back is spent");

  // Used by — the app node is still selected from the step before.
  await page.click("#docs-back");
  await clickDocs(".blessing-item", "Saving a thing?");
  await page.locator("#docs-body dl.frontmatter a.internal", { hasText: "/api/things/[id]" }).click();
  await expectDetail("metadata/route/things--_id", "Saving a thing?");
  await page.click("#detail-back");
  await expectDocs("Saving a thing?", "All blessings");
  await page.click("#docs-back");
  await expectDocs("Blessings", null);
});

// Decision 0045: the high blessings come first, by question, each with a
// "high" chip and the rest with none; a filter keeps them on top; the chip is
// on the blessing's page too, and the filter finds "high".
const rows = () => page.$$eval("#docs-body .blessing-item", (els) => els.filter((el) => !el.hidden).map((el) => [el.querySelector(":scope > b").textContent, el.querySelectorAll(".high-chip").length]));
smoke("high blessings are pinned first with a chip, under the filter and on their page", async () => {
  await open(urls.twoHigh);
  await page.click("#btn-blessings");
  await expectDocs("Blessings", null);
  assert.deepEqual(await rows(), [["Saving a thing?", 1], ["Showing a thing?", 1], ["Adding a page?", 0], ["Adding an endpoint for things?", 0]]);
  assert.equal(await page.$eval("#docs-body .high-chip", (el) => el.textContent), "high");
  await page.fill("#docs-filter", "thing");
  assert.deepEqual(await rows(), [["Saving a thing?", 1], ["Showing a thing?", 1], ["Adding an endpoint for things?", 0]], "the filter keeps the pin");
  await page.fill("#docs-filter", "high");
  assert.deepEqual(await rows(), [["Saving a thing?", 1], ["Showing a thing?", 1]], "the filter finds the high ones");
  await clickDocs(".blessing-item", "Showing a thing?");
  await expectDocs("Showing a thing?", "All blessings");
  assert.equal(await page.$$eval("#docs-body .blessing-chips .high-chip", (els) => els.length), 1, "the chip on the blessing's page");
  await page.click("#docs-back");
  await expectDocs("Blessings", null);
  assert.equal(await page.inputValue("#docs-filter"), "high");
  await clickDocs(".blessing-item", "Saving a thing?");
  await expectDocs("Saving a thing?", "All blessings");
  await page.click("#docs-back");
  await page.fill("#docs-filter", "");
  await clickDocs(".blessing-item", "Adding a page?");
  await expectDocs("Adding a page?", "All blessings");
  assert.equal(await page.$$eval("#docs-body .high-chip", (els) => els.length), 0, "a normal blessing has no chip");
});

smoke("a hostile blessing shows no executable markup", async () => {
  await open(urls.hostile);
  await page.click("#btn-blessings");
  const row = page.locator("#docs-body .blessing-item", { hasText: "hostile page" });
  assert.equal(await row.count(), 1, "the hostile blessing is listed");
  await expectInert("the list");
  await row.click();
  await settle();
  assert.match(await text("#docs-body"), /hostile page/);
  await expectInert("the blessing");
  for (const name of ["this link", "this one"]) {
    const link = page.locator("#docs-body a", { hasText: name });
    if (await link.count()) await link.first().click();
  }
  await settle();
  assert.equal(await page.evaluate(() => window.__pwned), undefined, "nothing in the blessing ran");
});

// The peek, where the store renders, carries nothing that runs or fetches.
async function expectInert(where) {
  const found = await page.$eval("#docs", (root) => ({
    tags: [...root.querySelectorAll("script, iframe, object, embed, svg, img, style, link, video, audio, source")].map((e) => e.tagName),
    handlers: [...root.querySelectorAll("*")].flatMap((e) => [...e.attributes].filter((a) => /^on/i.test(a.name)).map((a) => `${e.tagName}[${a.name}]`)),
    // The viewer's own in-page links are `javascript:void(0)` with a click
    // handler; any other script-scheme href came from the store.
    hrefs: [...root.querySelectorAll("[href], [src]")].map((e) => e.getAttribute("href") ?? e.getAttribute("src"))
      .filter((h) => /^\s*(javascript|data|vbscript):/i.test(h) && h !== "javascript:void(0)"),
  }));
  assert.deepEqual(found, { tags: [], handlers: [], hrefs: [] }, `${where} carries no executable markup`);
}

smoke("an empty blessing store says so", async () => {
  await open(urls.empty);
  await page.click("#btn-blessings");
  await expectDocs("Blessings", null);
  assert.equal(await page.locator("#docs-body .blessing-item").count(), 0);
  assert.match(await text("#docs-body"), /^No blessings yet\./);
});
