// The parts of an app an adapter can cover (decision 0039): a stack-free
// list the core owns. An adapter's detection names the parts it covers, and
// bootstrap reads coverage part by part — what is covered, and by which
// adapter, and what nothing covers yet. Schema and queries are two parts
// (decision 0048 point 6): an adapter that reads one says nothing about the
// other, so a repo with one of them is told about the other.
export const PARTS = ["routes", "screens", "components", "schema", "queries", "background tasks", "external services"];
