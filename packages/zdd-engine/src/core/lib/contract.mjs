// The adapter contract (decision 0040): a number of its own, separate from
// ZDD's version, raised only when what the core asks of an adapter changes.
// Every adapter — the catalogue's and an adopter's own — declares the
// contract it was written for:
//
//   export const CONTRACT = 1;
//
// and the table below lists every step of the contract, the contract that
// added it, and whether an adapter must have it (required) or may go without
// it and simply not get the ability (optional). The table is the one place
// a step is described: CONTRIBUTING and the engine README show it, derive
// reads it to judge an adapter, and "upgrade ZDD" reads it (through
// `zdd-engine contract --json`) to interview an adopter about the steps their
// own adapter is behind on. The interview text (`ask`) travels here, in the
// core release, never in the adapter: adapters stay plain code.
//
// Before 1.0 the contract is open: CONTRACT stays 1 through 0.9.x and its
// steps may change without interviews, while the only adopters are the
// maintainer's own. From 1.0.0 it is frozen, and every change is a new row
// here with `since` one higher than the last, and CONTRACT raised to match
// (a test holds the two together). A new required step is a major release.
//
// Stack-free like everything under core/: a step names what the core asks,
// never a stack.

export const CONTRACT = 1;

export const CONTRACT_TABLE = [
  {
    step: "CONTRACT",
    since: 1,
    required: true,
    what: "`export const CONTRACT = n` — the adapter contract the adapter was written for",
    ask: "Which contract was this adapter written for? Add `export const CONTRACT = 1` once it passes the standard suite.",
  },
  {
    step: "derive",
    since: 1,
    required: true,
    what: "`derive({ repoRoot, options, io })` returns `{ records, diagnostics }`; the same source bytes give byte-identical records",
    ask: null,
  },
  {
    step: "io",
    since: 1,
    required: true,
    what: "every read and listing goes through the `io` the engine hands in (never node:fs, the environment or the network); a gitignored path is never read",
    ask: null,
  },
  {
    step: "missing source",
    since: 1,
    required: true,
    what: "a configured root that does not exist is nothing to inventory: no records and a diagnostic, never an error",
    ask: null,
  },
  {
    step: "COMMENT",
    since: 1,
    required: true,
    what: "`export const COMMENT = { \".ext\": \"<line comment mark>\" }` — how to comment out a line of each kind of file the adapter reads (`{}` when none can be commented), so the standard suite can prove commented-out code never becomes a record",
    ask: "What starts a line comment in each kind of file this adapter reads (for example `//`, `#` or `--`)?",
  },
  {
    step: "SUITE",
    since: 1,
    required: true,
    what: "a `fixture/` folder beside the adapter (a miniature repo in its convention) and `export const SUITE = { options }`, the options to read it with — what the standard suite runs on",
    ask: "Which small sample of your code shows this convention? It becomes the adapter's `fixture/`, and the standard suite runs on a copy of it, never on your repo.",
  },
  {
    step: "FACTS_KEY_ORDER",
    since: 1,
    required: false,
    what: "`FACTS_KEY_ORDER` per kind, so facts serialise in a stable order",
    ask: null,
  },
  {
    step: "unresolved refs",
    since: 1,
    required: false,
    what: "refs to another adapter's records emitted unresolved (`?table:<name>`, `?route:<url>`, …); the core resolves them",
    ask: null,
  },
  {
    step: "data access",
    since: 1,
    required: false,
    what: "`?code:<file>#<function>` refs from a route or screen, and `data-access` records naming the tables a function reaches; the core joins them on file and function",
    ask: "Does the code this adapter reads call functions that reach the database? ZDD can link those routes or screens to their tables through a data-access adapter.",
  },
  {
    step: "typed edges",
    since: 1,
    required: false,
    what: "`facts.edges`, a verb for a ref (`reads`, `writes`, `calls`, …)",
    ask: null,
  },
  {
    step: "warnings",
    since: 1,
    required: false,
    what: "an optional `warnings` list, printed on every derive",
    ask: null,
  },
  {
    step: "detection",
    since: 1,
    required: false,
    what: "`DETECTION` and `detect({ scan, proposed })`, so bootstrap can propose the adapter (a catalogue adapter has it; a local one may)",
    ask: null,
  },
  {
    step: "import reader",
    since: 1,
    required: false,
    what: "`IMPORTS` — `{ label, extensions, skipDirs, isTest(rel), resolver(io, files) }`, the files one file imports, so the blessing index names who uses an `extend` blessing's code (decision 0046)",
    ask: null,
  },
];

// The rows an adapter declaring `declared` is behind on, against `contract`.
export function stepsSince(declared, { contract = CONTRACT, table = CONTRACT_TABLE } = {}) {
  return table.filter((r) => r.since > declared && r.since <= contract);
}

// How the core judges an adapter module's declared contract, at derive and in
// the suite's report. Returns:
//   declared   the number, or null when the module declares none
//   fail       a message: derive stops (newer than this engine, not a
//              number, or behind on a required step — a required step is a
//              major release, and the upgrade stops until the adapter has it)
//   warning    a message printed on every derive (no CONTRACT line yet)
//   behind     the optional rows it is behind on: never blocking (0040
//              point 4), said under --verbose and by "upgrade ZDD"
export function judgeContract(name, mod, { contract = CONTRACT, table = CONTRACT_TABLE } = {}) {
  const raw = mod?.CONTRACT;
  if (raw === undefined) {
    return {
      declared: null,
      fail: null,
      warning: `adapter '${name}' declares no CONTRACT — add \`export const CONTRACT = ${contract}\` once it passes the standard suite (\`zdd-engine suite\`); "upgrade ZDD" walks you through it`,
      behind: [],
    };
  }
  if (!Number.isInteger(raw) || raw < 1) {
    return { declared: null, fail: `adapter '${name}': CONTRACT must be a whole number from 1 (got ${JSON.stringify(raw)})`, warning: null, behind: [] };
  }
  if (raw > contract) {
    return {
      declared: raw,
      fail: `adapter '${name}' was written for adapter contract ${raw}, and this engine speaks ${contract} — say "upgrade ZDD" to move to a release that speaks it`,
      warning: null,
      behind: [],
    };
  }
  const missing = stepsSince(raw, { contract, table });
  const required = missing.filter((r) => r.required);
  if (required.length) {
    return {
      declared: raw,
      fail: `adapter '${name}' was written for adapter contract ${raw}; contract ${contract} requires ${required.map((r) => r.step).join(", ")} — say "upgrade ZDD", which walks you through updating it`,
      warning: null,
      behind: missing,
    };
  }
  return { declared: raw, fail: null, warning: null, behind: missing };
}
