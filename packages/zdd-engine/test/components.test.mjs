// components extractor (CAS-97 item 2, ZDD 2.1): React and React Native
// components as records — exported, capitalised, returning JSX — with props
// as written, the shared rule (two importers or a shared folder), "used by"
// and "uses" edges, "calls" through decision 0019's expansion, and a
// platform pair as one record. Pages are the routing extractors'.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { scanComponents, parseProps, importedNames, derive } from "../src/extractors/components/index.mjs";
import { derive as reactRouter } from "../src/extractors/react-router/index.mjs";
import { derive as fastapi } from "../src/extractors/fastapi/index.mjs";
import { resolveRefs } from "../src/lib/resolve-refs.mjs";
import { makeExtractorIo } from "../src/lib/extractor-io.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture-components");
const names = (text) => scanComponents(text).components.map((c) => [c.name, c.export]);

test("scanComponents: function, arrow const, memo, forwardRef, default export, a declaration exported later; not a lowercase export, a helper that returns no JSX, a commented-out one, or one inside a string", () => {
  const text = `
    import { memo, forwardRef } from "react";
    /** The main thing. */
    export function Main({ a }: { a: string }) { return <div>{a}</div>; }
    export default function Page() { return <Main a="x" />; }
    export const Arrow = ({ n }: { n: number }) => <span>{n}</span>;
    export const Memoed = memo(({ n }: { n: number }) => <b>{n}</b>);
    export const Ref = forwardRef<HTMLDivElement, { n: number }>(({ n }, ref) => <div ref={ref}>{n}</div>);
    export const Generic = <T,>({ items }: { items: T[] }) => <ul>{items.map(() => <li />)}</ul>;
    export function useThing() { return 1; }
    export const helper = () => <i />; // lowercase: not a component
    export function Compute({ n }: { n: number }) { return n < 2 ? n : n * 2; } // no JSX
    // export function Commented() { return <p />; }
    const s = "export function InString() { return <p />; }";
    function Later() { return <em />; }
    export { Later };
    function Defaulted() { return <em />; }
    export default memo(Defaulted);
  `;
  assert.deepEqual(names(text), [
    ["Main", "named"],
    ["Page", "default"],
    ["Arrow", "named"],
    ["Memoed", "named"],
    ["Ref", "named"],
    ["Generic", "named"],
    ["Later", "named"],
    ["Defaulted", "default"],
  ]);
  const main = scanComponents(text).components[0];
  assert.equal(main.description, "The main thing.");
});

test("parseProps and importedNames: members as written, optional marks, nested brackets kept whole; type imports are names too", () => {
  assert.deepEqual(parseProps(` a: string; b?: number, c: (x: string, y: number) => void; d: Array<{ k: string }>\n e?: "x" | "y" `), [
    { name: "a", type: "string", optional: false },
    { name: "b", type: "number", optional: true },
    { name: "c", type: "(x: string, y: number) => void", optional: false },
    { name: "d", type: "Array<{ k: string }>", optional: false },
    { name: "e", type: '"x" | "y"', optional: true },
  ]);
  const im = importedNames(`import type { A, B as C } from "./t";\nimport D, { type E } from "./d";\nimport F from "./f";`);
  assert.deepEqual([...im], [["A", "./t"], ["C", "./t"], ["E", "./d"], ["D", "./d"], ["F", "./f"]]);
});

test("fixture: four records — props inline, from a same-file type, from an imported type; shared by folder or by two importers; a page-private widget; a platform pair as one record with both files", (t) => {
  const out = derive({ repoRoot: FIXTURE, options: { roots: ["apps/web/src", "packages/ui/src"] }, io: makeExtractorIo(FIXTURE, "components") });
  const by = (name) => out.records.find((r) => r.title === name);
  assert.deepEqual(out.records.map((r) => r.id), [
    "component:apps/web/src/components/Badge.tsx#Badge",
    "component:apps/web/src/components/RouteSearchPanel.tsx#RouteSearchPanel",
    "component:apps/web/src/widgets/Sparkline.tsx#Sparkline",
    "component:packages/ui/src/Button.tsx#Button",
  ]);
  assert.ok(!out.records.some((r) => ["JobRow", "Row", "toneLabel", "JobsPage"].includes(r.title)), "page-file and non-exported declarations are not records");

  const panel = by("RouteSearchPanel");
  assert.equal(panel.description, "Search a job's candidate fixed routes and choose one. Calls the search and the choose endpoints.");
  assert.deepEqual(panel.facts.props, [
    { name: "jobId", type: "string", optional: false },
    { name: "onChosen", type: "(routeId: string) => void", optional: true },
  ]);
  assert.equal(panel.facts.propsType, undefined);
  assert.deepEqual(panel.facts.edges, {
    calls: ["?route:/jobs/*/route", "?route:/jobs/*/route-search"],
    usedBy: ["?surface:apps/web/src/pages/JobsPage.tsx"],
    uses: ["component:apps/web/src/components/Badge.tsx#Badge"],
  });
  assert.equal(panel.facts.shared, true);
  assert.equal(panel.facts.sharedBy, "dir");

  const badge = by("Badge");
  assert.deepEqual(badge.facts.props.map((p) => p.name), ["tone", "children"]);
  assert.equal(badge.facts.propsType, "BadgeProps");
  assert.deepEqual(badge.facts.usedBy, ["apps/web/src/components/RouteSearchPanel.tsx", "apps/web/src/pages/ActivityPage.tsx", "apps/web/src/pages/JobsPage.tsx"]);
  assert.deepEqual(badge.facts.edges.usedBy, ["?surface:apps/web/src/pages/ActivityPage.tsx", "?surface:apps/web/src/pages/JobsPage.tsx"]);

  const spark = by("Sparkline");
  assert.equal(spark.facts.shared, false, "one importer, not in a shared folder");
  assert.equal(spark.facts.sharedBy, "none");
  assert.equal(spark.facts.propsType, "SparklineProps");
  assert.deepEqual(spark.facts.props.map((p) => [p.name, p.optional]), [["points", false], ["width", true]]);

  const button = by("Button");
  assert.deepEqual(button.resource, ["packages/ui/src/Button.native.tsx", "packages/ui/src/Button.web.tsx"]);
  assert.deepEqual(button.facts.platforms, ["native", "web"]);
  assert.equal(button.facts.propsType, "ButtonProps");
  assert.equal(button.facts.propsFrom, "./types");
  assert.deepEqual(button.facts.usedBy, ["apps/web/src/pages/JobsPage.tsx"], "imported by the pair's base name");
  // The shared rule by import count alone: two importers, no shared folder.
  const two = derive({ repoRoot: FIXTURE, options: { roots: ["apps/web/src"], sharedDirs: [] }, io: makeExtractorIo(FIXTURE, "components") });
  assert.equal(two.records.find((r) => r.title === "Badge").facts.sharedBy, "imports");
  assert.equal(two.records.find((r) => r.title === "RouteSearchPanel").facts.shared, false);
  t.diagnostic(out.diagnostics.join("\n"));
});

test("after the merge: usedBy resolves to the surfaces by their element file, calls to the expanded routes (never /health), uses to the component", () => {
  const io = makeExtractorIo(FIXTURE, "components");
  const api = fastapi({ repoRoot: FIXTURE, options: { roots: ["apps/api"] } });
  const web = reactRouter({ repoRoot: FIXTURE, options: { routesFile: "apps/web/src/routes.tsx" } });
  const comps = derive({ repoRoot: FIXTURE, options: { roots: ["apps/web/src", "packages/ui/src"] }, io });
  const { records } = resolveRefs([...api.records, ...web.records, ...comps.records]);
  const panel = records.find((r) => r.title === "RouteSearchPanel");
  assert.deepEqual(panel.refs, ["component:apps/web/src/components/Badge.tsx#Badge", "route:/jobs/{job_id}/route", "route:/jobs/{job_id}/route-search", "surface:/jobs"]);
  assert.deepEqual(panel.facts.edges, {
    calls: ["route:/jobs/{job_id}/route", "route:/jobs/{job_id}/route-search"],
    usedBy: ["surface:/jobs"],
    uses: ["component:apps/web/src/components/Badge.tsx#Badge"],
  });
  assert.deepEqual(records.find((r) => r.title === "Badge").facts.edges.usedBy, ["surface:/activity", "surface:/jobs"]);
});

test("CLI: derive and render are byte-stable on the fixture; the graph types a component 'UI Component' with its verbs; a bad option is refused naming the extractor", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-comp-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(FIXTURE, repo, { recursive: true });
  const run = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
  const d = run(["derive"]);
  assert.equal(d.status, 0, d.stderr);
  assert.match(d.stdout, /Wrote 16 records \(4 components, 4 routes, 8 surfaces\)/, "web pages and native screens are all surfaces");
  assert.equal(run(["derive", "--check"]).status, 0);
  const r = run(["render"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(run(["render", "--check"]).status, 0);
  const graph = JSON.parse(readFileSync(join(repo, "zdd", "graph.json"), "utf8"));
  const panel = graph.nodes.find((n) => n.title === "RouteSearchPanel");
  assert.equal(panel.type, "UI Component");
  assert.equal(panel.resource, "apps/web/src/components/RouteSearchPanel.tsx");
  // The shared button is used by the web page and the native screen alike (CLI roots include apps/mobile).
  const button = graph.nodes.find((n) => n.title === "Button");
  assert.deepEqual(graph.edges.filter((e) => e.source === button.id && e.verb === "usedBy").map((e) => e.target).sort(), ["metadata/surface/jobs", "metadata/surface/native--jobs"]);
  const verbs = graph.edges.filter((e) => e.source === panel.id).map((e) => [e.target, e.verb]).sort();
  assert.deepEqual(verbs, [
    ["metadata/component/apps--web--src--components--Badge--Badge", "uses"],
    ["metadata/route/jobs--_job_id--route", "calls"],
    ["metadata/route/jobs--_job_id--route-search", "calls"],
    ["metadata/surface/jobs", "usedBy"],
  ]);
  assert.match(panel.body, /- calls \[route:\/jobs\/\{job_id\}\/route\]/);
  assert.match(panel.body, /- used by \[surface:\/jobs\]/);
  const agent = readFileSync(join(repo, "zdd", "agent-index.md"), "utf8");
  assert.match(agent, /\[RouteSearchPanel\]\(metadata\/component\/.*\) — Search a job's candidate fixed routes and choose one\./);

  const config = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  config.extractorOptions.components.roots = "apps/web/src";
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(config));
  const bad = run(["derive"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Extractor 'components' failed: components\.roots must be an array of strings/);
});

