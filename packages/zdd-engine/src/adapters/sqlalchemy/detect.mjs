// Detection for sqlalchemy (decision 0039): SQLAlchemy declared as a
// dependency or imported. The adapter reads raw SQL strings in Python
// functions; the ORM is not read, and the evidence says so.

import { PY_SKIP_DIRS, pythonLibraryEvidence } from "../python/detect.mjs";

// upgradeAdds: new in 0.9, and the only reader of a Python repo's raw SQL
// once `jobs` stopped reading it (decision 0037).
export const DETECTION = { parts: ["database access"], order: 13, upgradeAdds: "0.9.0", optionShape: { pathLists: ["roots"] }, skipDirs: PY_SKIP_DIRS };

export function detect({ scan }) {
  const ev = pythonLibraryEvidence(scan, { dep: "sqlalchemy", module: "sqlalchemy", label: "SQLAlchemy" });
  if (!ev) return null;
  return { proposal: { evidence: [...ev, "the SQL in `text(\"…\")` and other SQL strings is read; ORM queries (`select(Model)`, `session.query`) are not — say so on the map"], options: {} } };
}
