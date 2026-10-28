#!/usr/bin/env node
// ZDD engine CLI — one bin, ten subcommands. Every command but detect,
// preview and contract reads the adopter repo's zdd/config.json (located by walking up from cwd; override with
// --root=<dir> and/or --config=<file>) and runs deterministically: same source
// bytes in, byte-identical artifacts out. No LLM anywhere — the agent-side
// ritual lives in the zdd plugin's skills; this is the mechanical half.
//
//   zdd-engine derive [--check] [--verbose]   codebase metadata from source
//   zdd-engine render [--check]               agent index + ADR index (and the harness ADR index, when set) + blessing index + human index
//   zdd-engine lint [--merge] [--tempstate]   deterministic store lints
//   zdd-engine freshness [--base <ref>]       advisory semantic-map staleness nudge
//   zdd-engine tally [--since <ref|date>] [--json]  the ZDD record, counted over git history
//   zdd-engine detect [--root=<dir>]           which adapters fit a repo, as JSON (bootstrap asks this)
//   zdd-engine coverage [--json]               what the derived records link to, and what links to nothing
//   zdd-engine preview --extractors=<a,b>      the chosen adapters' examples rendered outside the repo
//   zdd-engine suite [--extractors=<a,b>] [--json]  the standard suite on this repo's own adapters
//   zdd-engine contract [--json]               the adapter contract this engine speaks, and its table

const COMMANDS = {
  derive: () => import("../src/core/derive.mjs"),
  render: () => import("../src/core/render.mjs"),
  lint: () => import("../src/core/lint-stores.mjs"),
  freshness: () => import("../src/core/check-freshness.mjs"),
  tally: () => import("../src/core/tally.mjs"),
  detect: () => import("../src/core/detect.mjs"),
  coverage: () => import("../src/core/coverage.mjs"),
  preview: () => import("../src/core/preview.mjs"),
  suite: () => import("../src/core/suite.mjs"),
  contract: () => import("../src/core/contract.mjs"),
};

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || !(cmd in COMMANDS)) {
  console.error(
    `Usage: zdd-engine <command> [options]\n\n` +
      `Commands:\n` +
      `  derive     generate codebase metadata (--check: verify instead of write)\n` +
      `  render     generate agent-index.md, adr-index.md, human-index.html (--check)\n` +
      `  lint       deterministic curated-store lints (--merge: the CI gate — the pattern plan fails, a malformed ZDD record warns; --tempstate: also forbid TEMPSTATE.md)\n` +
      `  freshness  advisory semantic-map staleness report (--base <ref>)\n` +
      `  tally      the ZDD record counted over git history (--since <ref|date>, --json)\n` +
      `  detect     which adapters fit this repo, with evidence and the parts they cover (JSON)\n` +
      `  coverage   per record kind: what it links to, and what links to nothing (--json)\n` +
      `  preview    render the chosen adapters' examples outside the repo (--extractors=<a,b>)\n` +
      `  suite      the standard suite on this repo's own adapters, each on its fixture (--extractors=<a,b>, --json)\n` +
      `  contract   the adapter contract this engine speaks, and its table (--json)\n\n` +
      `Common options: --root=<repo-root> --config=<path-to-config.json>`,
  );
  process.exit(cmd ? 2 : 0);
}

const mod = await COMMANDS[cmd]();
await mod.run(rest);
