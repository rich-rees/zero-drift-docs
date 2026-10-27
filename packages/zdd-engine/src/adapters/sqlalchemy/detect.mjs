// Detection for sqlalchemy (decision 0039): SQLAlchemy declared as a
// dependency or imported. The adapter reads raw SQL strings in Python
// functions; the ORM is not read, and the evidence says so.

import { PY_SKIP_DIRS, pythonLibraryEvidence } from "../python/detect.mjs";

export const DETECTION = { parts: ["database access"], order: 13, optionShape: { pathLists: ["roots"] }, skipDirs: PY_SKIP_DIRS };

export function detect({ scan }) {
  const ev = pythonLibraryEvidence(scan, { dep: "sqlalchemy", module: "sqlalchemy", label: "SQLAlchemy" });
  if (!ev) return null;
  return { proposal: { evidence: [...ev, "the SQL in `text(\"…\")` and other SQL strings is read; ORM queries (`select(Model)`, `session.query`) are not — say so on the map"], options: {} } };
}
