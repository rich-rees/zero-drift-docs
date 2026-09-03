#!/usr/bin/env node
// ZDD SessionStart hook — the auto-load. Prints the adopter repo's agent index
// to stdout so the host injects it into the session context (the "read on
// open" half of ZDD), followed by the declared-load trailer that names the
// `load` skill. Two different roots are in play, and crossing them is the
// obvious first bug: this SCRIPT ships with the plugin (reached via
// ${CLAUDE_PLUGIN_ROOT} by hooks.json), but the INDEX it reads lives in the
// adopter's repo, reached via ${CLAUDE_PROJECT_DIR}.
//
// Opt-in per repo: bootstrap records `"hooks": { "autoLoad": true|false }` in
// zdd/config.json. An absent key means a repo bootstrapped before the opt-ins
// existed — it keeps loading, as it always did; only an explicit `false`
// switches it off. Silent by design when there is no index yet (repo hasn't
// adopted ZDD, or hasn't rendered): a SessionStart hook that errors or spams
// would punish every session in a repo that merely has the plugin installed.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { adopterRoot, loadConfig, artifactPaths } from "./lib/repo.mjs";

try {
  const root = adopterRoot();
  const config = loadConfig(root);
  if (config?.hooks?.autoLoad === false) process.exit(0);

  const indexPath = resolve(root, artifactPaths(config).agentIndex);
  if (!existsSync(indexPath)) process.exit(0);

  const body = readFileSync(indexPath, "utf8");
  process.stdout.write(
    `<zdd-agent-index>\n${body}\n</zdd-agent-index>\n` +
      "The ZDD agent index above was injected at session start. Before designing or " +
      "building in an area, say \"load ZDD\" (the `load` skill) to read the glossary " +
      "whole, the ADR index whole, and the ADRs your task cites — then read the code " +
      "fresh. Never trust the docs over the code. Before finishing a unit of work, say " +
      "\"update ZDD\" (the `update` skill).\n",
  );
} catch {
  process.exit(0);
}
