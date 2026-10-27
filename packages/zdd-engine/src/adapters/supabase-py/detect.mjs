// Detection for supabase-py (decision 0039): the Supabase Python client,
// declared as a dependency, imported, or simply called — `.table("x")` /
// `.from_("x")` in Python, the convention this adapter reads, even where the
// client is built in another module and handed in. Its calls are read
// wherever they are (the default roots), so no option is proposed.

import { PY_SKIP_DIRS, pythonLibraryEvidence } from "../python/detect.mjs";

// upgradeAdds: before 0.9 `fastapi` read these calls itself (decision 0037).
export const DETECTION = { parts: ["database access"], order: 12, upgradeAdds: "0.9.0", optionShape: { pathLists: ["roots"] }, skipDirs: PY_SKIP_DIRS };

const TEST_FILE = /(^|\/)(test_[^/]*\.py|[^/]*_test\.py|conftest\.py)$/;
const CALL = /\.(?:table|from_)\(\s*(['"])[\w-]+\1\s*\)/;

export function detect({ scan }) {
  const ev = pythonLibraryEvidence(scan, { dep: "supabase", module: "supabase", label: "the Supabase Python client" }) ?? [];
  const calling = scan.files.filter((f) => f.name.endsWith(".py") && !TEST_FILE.test(f.rel) && CALL.test(scan.read(f.rel) ?? "")).map((f) => f.rel);
  if (calling.length) ev.push(`\`.table("…")\` / \`.from_("…")\` calls in ${calling.slice(0, 3).map((f) => `\`${f}\``).join(", ")}${calling.length > 3 ? ` and ${calling.length - 3} more file${calling.length - 3 === 1 ? "" : "s"}` : ""}`);
  if (!ev.length) return null;
  return { proposal: { evidence: [...ev, "its `.table()` / `.from_()` / `.rpc()` calls are read and joined to the routes that make them"], options: {} } };
}
