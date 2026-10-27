// Test helper (not a test file): run background-* readers on one repo and
// merge their records as the core does after the merge (decision 0038), so a
// reader's test sees the tasks a derive would write, before ref resolution.
import { makeExtractorIo } from "../src/core/lib/extractor-io.mjs";
import { mergeBackgroundTasks } from "../src/core/lib/background-tasks.mjs";

export const READERS = ["background-railway", "background-procfile", "background-vercel", "background-cloudflare", "background-pg-cron", "background-compose", "background-bullmq", "background-inngest", "background-trigger-dev", "background-sqs", "background-github-actions", "background-declared"];
const loaded = new Map();
for (const name of READERS) loaded.set(name, (await import(`../src/adapters/${name}/index.mjs`)).derive);

// `options` is { "<reader>": {...} }; `readers` the ones to run (default:
// every reader but the GitHub Actions opt-in).
export function runReaders(repoRoot, options = {}, readers = READERS.filter((n) => n !== "background-github-actions")) {
  const records = [];
  const diagnostics = [];
  for (const name of readers) {
    const out = loaded.get(name)({ repoRoot, options: options[name] ?? {}, io: makeExtractorIo(repoRoot, name) });
    records.push(...out.records);
    diagnostics.push(...out.diagnostics);
  }
  const merged = mergeBackgroundTasks(records);
  return { records: merged.records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), diagnostics: [...diagnostics, ...merged.diagnostics], warnings: merged.warnings };
}
