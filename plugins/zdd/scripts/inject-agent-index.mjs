#!/usr/bin/env node
// ZDD SessionStart hook — print the adopter repo's agent index to stdout so
// Claude Code injects it into the session context (the "read on open" half of
// ZDD). Two different roots are in play, and crossing them is the obvious first
// bug: this SCRIPT ships with the plugin (reached via ${CLAUDE_PLUGIN_ROOT} by
// hooks.json), but the INDEX it reads lives in the adopter's repo, reached via
// ${CLAUDE_PROJECT_DIR}.
//
// Silent by design when there is no index yet (repo hasn't adopted ZDD, or
// hasn't rendered): a SessionStart hook that errors or spams would punish every
// session in a repo that merely has the plugin installed.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// The index path is configurable per repo (zdd/config.json -> paths.agentIndex);
// default to the self-contained layout.
let indexRel = "zdd/agent-index.md";
const configPath = join(projectDir, "zdd", "config.json");
if (existsSync(configPath)) {
  try {
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    if (cfg?.paths?.agentIndex) indexRel = cfg.paths.agentIndex;
  } catch {
    // Malformed config is the ritual's problem to surface elsewhere, not this
    // hook's — fall back to the default path.
  }
}

const indexPath = resolve(projectDir, indexRel);
if (!existsSync(indexPath)) process.exit(0);

const body = readFileSync(indexPath, "utf8");
process.stdout.write(
  `<zdd-agent-index>\n${body}\n</zdd-agent-index>\n` +
    "The ZDD agent index above was injected at session start. Before designing or " +
    "building in an area, run /zdd:orient to load the glossary (whole), the ADR index " +
    "(whole), and the ADRs your task cites — then read the code fresh. Never trust the " +
    "docs over the code.\n",
);
