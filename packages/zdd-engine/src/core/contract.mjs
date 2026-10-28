#!/usr/bin/env node
// ZDD adapter contract (decision 0040) — prints the contract this engine
// speaks and its table: every step, the contract that added it, and whether
// an adapter must have it. Reads no repo.
//
//   zdd-engine contract [--json]

import { CONTRACT, CONTRACT_TABLE } from "./lib/contract.mjs";

export function narrateContract() {
  const lines = [`This engine speaks adapter contract ${CONTRACT}. Each adapter declares the one it was written for (export const CONTRACT = n).`, ""];
  for (const r of CONTRACT_TABLE) lines.push(`  ${r.required ? "required" : "optional"}  ${r.step} (contract ${r.since}) — ${r.what}`);
  return lines.join("\n");
}

export async function run(args) {
  if (args.includes("--json")) console.log(JSON.stringify({ contract: CONTRACT, table: CONTRACT_TABLE }, null, 2));
  else console.log(narrateContract());
}
