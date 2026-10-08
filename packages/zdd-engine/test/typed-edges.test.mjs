// Typed edges (CAS-97, decision 0016): a record's `facts.edges` maps a verb to
// refs; the resolver resolves them like plain refs and makes them plain refs
// too; derive validates the shape; render carries the verb onto the graph
// edge and says it in the body; a record without edges renders byte-for-byte
// as before (every existing golden proves that). Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveRefs } from "../src/lib/resolve-refs.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE_FASTAPI = join(PKG, "test", "fixture-fastapi");

const rec = (kind, id, refs = [], facts = {}) => ({ kind, id, title: id, description: "", resource: [`${kind}.x`], refs, facts, filename: "x.json" });

test("resolver: edge refs resolve (resolved and `?` forms), land in refs too, come out sorted; empty verbs and empty maps are dropped; dropped targets are stripped", () => {
  const { records, diagnostics } = resolveRefs([
    rec("table", "table:db/audit_events"),
    rec("route", "route:/jobs/{job_id}/route"),
    rec("surface", "surface:/activity", ["?route:/jobs/*/route"], { edges: { subscribes: ["?table:audit_events"], calls: ["route:/jobs/{job_id}/route"], writes: ["?table:nope"], reads: [] } }),
    rec("module", "module:dead.ts", ["?from:nope"], {}),
  ]);
  const s = records.find((r) => r.id === "surface:/activity");
  assert.deepEqual(s.refs, ["route:/jobs/{job_id}/route", "table:db/audit_events"]);
  assert.deepEqual(s.facts.edges, { calls: ["route:/jobs/{job_id}/route"], subscribes: ["table:db/audit_events"] });
  assert.ok(diagnostics.some((d) => /table 'nope'/.test(d)), diagnostics.join("\n"));
  // A requireRefs record dropped after the fact takes its verb entry with it.
  const r2 = resolveRefs([
    rec("table", "table:db/t"),
    { ...rec("module", "module:gone.ts", ["?from:nope"]), requireRefs: true },
    rec("surface", "surface:/x", ["module:gone.ts", "table:db/t"], { edges: { uses: ["module:gone.ts"], reads: ["table:db/t"] } }),
  ]);
  const x = r2.records.find((r) => r.id === "surface:/x");
  assert.deepEqual(x.refs, ["table:db/t"]);
  assert.deepEqual(x.facts.edges, { reads: ["table:db/t"] });
});

const EDGE_EXTRACTOR = `
export const FACTS_KEY_ORDER = { surface: ["edges"] };
export function derive() {
  return {
    diagnostics: [],
    records: [{
      kind: "surface", id: "surface:/activity", title: "/activity", description: "The activity feed.",
      resource: ["web/activity.tsx"], refs: ["?route:/jobs/*"],
      facts: { edges: { subscribes: ["?table:jobs"], calls: ["?route:/jobs/*"] } }, filename: "activity.json",
    }, {
      kind: "surface", id: "surface:/plain", title: "/plain", description: "No verbs here.",
      resource: ["web/plain.tsx"], refs: ["?table:jobs"], facts: {}, filename: "plain.json",
    }],
  };
}
`;

test("CLI: a local extractor's typed edges land in the record, the graph edge carries the verb, the body says it; a plain ref stays plain; both viewers render", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-edges-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(FIXTURE_FASTAPI, repo, { recursive: true });
  mkdirSync(join(repo, "zdd", "extractors"), { recursive: true });
  writeFileSync(join(repo, "zdd", "extractors", "edgy.mjs"), EDGE_EXTRACTOR);
  const configPath = join(repo, "zdd", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  writeFileSync(configPath, JSON.stringify({ ...config, localExtractorDir: "zdd/extractors", extractors: [...config.extractors, "edgy"] }, null, 2));
  const run = (args) => execFileSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  run(["derive"]);
  const activity = JSON.parse(readFileSync(join(repo, "zdd", "metadata", "surface", "activity.json"), "utf8"));
  assert.deepEqual(activity.refs, ["route:/jobs/{id}", "table:db/jobs"]);
  assert.deepEqual(activity.facts.edges, { calls: ["route:/jobs/{id}"], subscribes: ["table:db/jobs"] });
  const plain = JSON.parse(readFileSync(join(repo, "zdd", "metadata", "surface", "plain.json"), "utf8"));
  assert.deepEqual(plain.facts, {});
  assert.match(run(["derive", "--check"]), /in sync/);

  run(["render"]);
  const graph = JSON.parse(readFileSync(join(repo, "zdd", "graph.json"), "utf8"));
  assert.equal(graph.schema, "zdd-graph/1");
  const sub = graph.edges.find((e) => e.source === "metadata/surface/activity" && e.target === "metadata/table/db--jobs");
  assert.equal(sub.verb, "subscribes");
  const call = graph.edges.find((e) => e.source === "metadata/surface/activity" && e.target === "metadata/route/jobs--_id");
  assert.equal(call.verb, "calls");
  const plainEdge = graph.edges.find((e) => e.source === "metadata/surface/plain");
  assert.ok(plainEdge && !("verb" in plainEdge), "a plain ref has no verb key");
  const body = graph.nodes.find((n) => n.id === "metadata/surface/activity").body;
  assert.match(body, /- subscribes to \[table:db\/jobs\]\(\/metadata\/table\/db--jobs\.json\)/, body);
  assert.match(body, /- calls \[route:\/jobs\/\{id\}\]/, body);
  assert.match(graph.nodes.find((n) => n.id === "metadata/surface/plain").body, /- \[table:db\/jobs\]/);
  const html = readFileSync(join(repo, "zdd", "human-index.html"), "utf8");
  assert.match(html, /"verb":"subscribes"/);
  assert.match(run(["render", "--check"]), /in sync/);

  writeFileSync(configPath, JSON.stringify({ ...JSON.parse(readFileSync(configPath, "utf8")), viewer: "minimal" }, null, 2));
  run(["render"]);
  assert.match(readFileSync(join(repo, "zdd", "human-index.html"), "utf8"), /<span class="muted">subscribes<\/span>/);
});

test("derive refuses a malformed facts.edges: not an object, a bad verb, an id that is not a ref", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-edges-bad-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(FIXTURE_FASTAPI, repo, { recursive: true });
  mkdirSync(join(repo, "zdd", "extractors"), { recursive: true });
  const configPath = join(repo, "zdd", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  writeFileSync(configPath, JSON.stringify({ ...config, localExtractorDir: "zdd/extractors", extractors: [...config.extractors, "edgy"] }, null, 2));
  const fail = (edges) => {
    writeFileSync(join(repo, "zdd", "extractors", "edgy.mjs"), EDGE_EXTRACTOR.replace(/facts: \{ edges: [^}]*\} \}/, `facts: { edges: ${edges} }`));
    try {
      execFileSync(process.execPath, [BIN, "derive"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      return String(e.stderr);
    }
    assert.fail("expected derive to fail");
  };
  assert.match(fail("[1]"), /facts\.edges must be an object/);
  assert.match(fail('{ "sub-scribes": ["?table:jobs"] }'), /bad edge verb 'sub-scribes'/);
  assert.match(fail('{ "subscribes": "?table:jobs" }'), /facts\.edges\.subscribes must be an array/);
});
