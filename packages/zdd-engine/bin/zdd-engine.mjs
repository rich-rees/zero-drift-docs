#!/usr/bin/env node
// ZDD engine CLI — one bin, four subcommands. Every command reads the adopter
// repo's zdd/config.json (located by walking up from cwd; override with
// --root=<dir> and/or --config=<file>) and runs deterministically: same source
// bytes in, byte-identical artifacts out. No LLM anywhere — the agent-side
// ritual lives in the zdd plugin's skills; this is the mechanical half.
//
//   zdd-engine derive [--check] [--verbose]   codebase metadata from source
//   zdd-engine render [--check]               agent index + ADR index + human index
//   zdd-engine lint [--tempstate]             deterministic store lints
//   zdd-engine freshness [--base <ref>]       advisory semantic-map staleness nudge

const COMMANDS = {
  derive: () => import("../src/derive.mjs"),
  render: () => import("../src/render.mjs"),
  lint: () => import("../src/lint-stores.mjs"),
  freshness: () => import("../src/check-freshness.mjs"),
};

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || !(cmd in COMMANDS)) {
  console.error(
    `Usage: zdd-engine <command> [options]\n\n` +
      `Commands:\n` +
      `  derive     generate codebase metadata (--check: verify instead of write)\n` +
      `  render     generate agent-index.md, adr-index.md, human-index.html (--check)\n` +
      `  lint       deterministic curated-store lints (--tempstate: also forbid TEMPSTATE.md)\n` +
      `  freshness  advisory semantic-map staleness report (--base <ref>)\n\n` +
      `Common options: --root=<repo-root> --config=<path-to-config.json>`,
  );
  process.exit(cmd ? 2 : 0);
}

const mod = await COMMANDS[cmd]();
await mod.run(rest);
