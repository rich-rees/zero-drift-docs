// The parts of an app an adapter can cover (decision 0039): a stack-free
// list the core owns. An adapter's detection names the parts it covers, and
// bootstrap reads coverage part by part — what is covered, and by which
// adapter, and what nothing covers yet.
export const PARTS = ["routes", "screens", "components", "database access", "background tasks", "external services"];
