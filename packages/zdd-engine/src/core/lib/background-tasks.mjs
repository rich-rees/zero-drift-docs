// Background tasks, merged across readers (decision 0038, ZDD-3 slice 3).
// One reader per platform file means one task can be seen twice: a process
// line names it, a deployment file states its schedule; a hand-declared task
// names it, the deployment file runs it. Two `background-task` records are
// ONE task when they run the same command from the same folder
// (`processKeys`: the shape that survives when the code is build output
// nobody commits), or when one is a process and the other runs the same code
// file (`runs`) — a queue or a schedule declared in the code a process runs.
// Two declarations in one file with no process running it stay two tasks. The merge knows no platform: readers say
// which record only says how a task is deployed (`deploys: true`), and that
// record joins another rather than naming the task.
//
// In each group one record names the task — the first process (a command a
// manifest or a declaration runs), else the first that is not a deployment
// record, in the order the extractors ran; the others join it:
// their files are added to its resource list, their refs and typed edges
// united, a schedule / trigger / target / queue / producers / consumers /
// description it lacks taken, and its mode settled — scheduled when any
// member states a schedule, else the first stated mode. A record whose
// command names no file in the repo (`unresolved`) is dropped: joined, its
// files and schedule still count; alone, the reader's warning says so on
// every derive. Two tasks left with one name are two different tasks: the
// first is kept and the second named in a diagnostic. The transient keys
// (`runs`, `processKeys`, `deploys`, `unresolved`) are never written.

const KIND = "background-task";
const FILL = ["schedule", "trigger", "target", "queue", "producers", "consumers"];

export function mergeBackgroundTasks(records) {
  const diagnostics = [];
  const warnings = [];
  const tasks = records.filter((r) => r.kind === KIND);
  if (!tasks.length) return { records, diagnostics, warnings };

  // Union-find over the tasks, keyed by code file and by command + folder.
  const parent = tasks.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  // A command run from a folder: every record that names it is one task.
  const firstBy = new Map();
  tasks.forEach((t, i) => {
    for (const k of Array.isArray(t.processKeys) ? t.processKeys : []) {
      if (firstBy.has(k)) union(firstBy.get(k), i);
      else firstBy.set(k, i);
    }
  });
  // A code file joins THROUGH A PROCESS only: the queues and schedules one
  // file declares (two Trigger.dev tasks in one module) are as many tasks,
  // and each joins the process that runs that file, if one does.
  const byFile = new Map();
  tasks.forEach((t, i) => {
    for (const f of Array.isArray(t.runs) ? t.runs : typeof t.runs === "string" ? [t.runs] : []) {
      if (!byFile.has(f)) byFile.set(f, []);
      if (!byFile.get(f).includes(i)) byFile.get(f).push(i);
    }
  });
  for (const members of byFile.values()) {
    const proc = members.find((i) => Array.isArray(tasks[i].processKeys));
    if (proc === undefined) continue;
    for (const i of members) union(proc, i);
  }
  const groups = new Map();
  tasks.forEach((t, i) => {
    const g = find(i);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(t);
  });

  const merged = [];
  for (const members of [...groups.keys()].sort((a, b) => a - b).map((g) => groups.get(g))) {
    const named = members.filter((m) => !m.unresolved);
    if (!named.length) {
      // Nobody names the task with a file in the repo: one warning per
      // record that tried (a reader's own words), no record.
      for (const m of members) warnings.push(`WARNING [${m.facts.reader}]: ${m.unresolved}`);
      continue;
    }
    // A process names the task before a queue or schedule declared in its
    // code, and both before a deployment record — whatever order the
    // readers ran in.
    const lead = named.find((m) => !m.deploys && Array.isArray(m.processKeys)) ?? named.find((m) => !m.deploys) ?? named[0];
    const out = { ...lead, resource: [...lead.resource], refs: [...lead.refs], facts: { ...lead.facts, ...(lead.facts.edges ? { edges: { ...lead.facts.edges } } : {}) } };
    for (const m of members) {
      if (m === lead) continue;
      if (m.unresolved) diagnostics.push(`${m.facts.manifest}: '${m.title}' runs no file in the repo — joined to ${lead.id} (${lead.facts.manifest}), which runs ${[].concat(lead.runs ?? []).join(", ") || "the same command"}`);
      for (const f of m.resource) if (!out.resource.includes(f)) out.resource.push(f);
      for (const ref of m.refs) if (!out.refs.includes(ref)) out.refs.push(ref);
      for (const [verb, ids] of Object.entries(m.facts.edges ?? {})) {
        const edges = (out.facts.edges ??= {});
        edges[verb] = [...new Set([...(edges[verb] ?? []), ...ids])];
      }
      for (const k of FILL) if (out.facts[k] === undefined && m.facts[k] !== undefined) out.facts[k] = m.facts[k];
      if (!out.description && m.description) out.description = m.description;
    }
    // A mode is stated when it names one (CR-079: a missing or empty mode is
    // not a statement, so another member's stated mode still counts).
    const isStated = (v) => typeof v === "string" && v !== "" && v !== "unknown";
    const stated = members.map((m) => m.facts.mode).find(isStated);
    out.facts.mode = out.facts.schedule ? "scheduled" : isStated(out.facts.mode) ? out.facts.mode : (stated ?? "unknown");
    out.refs.sort();
    // Facts keys keep the lead's order, filled keys in the reader's order:
    // the serializer orders them by the kind's facts key order anyway.
    merged.push(out);
  }

  // One name, two different tasks: the first (in run order) is kept.
  const byId = new Map();
  const kept = [];
  for (const t of merged) {
    if (byId.has(t.id)) {
      diagnostics.push(`background task '${t.title}' is declared in ${byId.get(t.id).facts.manifest} and again in ${t.facts.manifest} — the second is skipped`);
      continue;
    }
    byId.set(t.id, t);
    kept.push(t);
  }
  for (const t of kept) {
    delete t.runs;
    delete t.processKeys;
    delete t.deploys;
    delete t.unresolved;
  }
  const others = records.filter((r) => r.kind !== KIND);
  return { records: [...others, ...kept], diagnostics, warnings };
}
