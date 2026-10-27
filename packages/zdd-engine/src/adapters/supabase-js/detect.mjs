// Detection for supabase-js (decision 0039): Supabase beside JS code that
// reaches it (decision 0037). The route and screen adapters name the code
// they run, and this adapter reads how that code reaches the database —
// without it, no page links to a table. So it is proposed, after the others
// have answered, when supabase is and a JS reader is; a stated greenfield
// stack selects it by the same rule (`companion`).

const JS_READERS = ["nextjs", "react-router", "components", "expo-router"];
const SUBSCRIBE_CALLS = "extractorOptions.supabase-js.subscribeCalls";

export const DETECTION = {
  parts: ["database access"],
  order: 11,
  after: true,
  optionShape: { pathLists: ["roots"], callLists: ["subscribeCalls"], callName: "^[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*$" },
  companion: { all: ["supabase"], any: JS_READERS },
};

export function detect({ proposed }) {
  if (!proposed.includes("supabase")) return null;
  const readers = JS_READERS.filter((n) => proposed.includes(n));
  if (!readers.length) return null;
  // A question the evidence raises but cannot answer (2.2.0): Realtime
  // subscriptions become `subscribes` edges; the client's own call is seen,
  // a wrapper of the app's own is not until it is named. One question naming
  // every web app: since 0.9 the call names live here, whichever app calls.
  const questions = [];
  const webs = ["react-router", "nextjs"].filter((n) => proposed.includes(n));
  if (webs.length) {
    const apps = webs.map((w) => (w === "nextjs" ? "Next.js" : "React Router")).join(" or the ");
    questions.push({
      topic: "realtime",
      ask:
        `Does the ${apps} app subscribe to Supabase Realtime through a wrapper of its own (e.g. \`live.onInsert("table", …)\`)? ` +
        'The client\'s own `.on("postgres_changes", { table })` needs nothing; a wrapper is invisible until its call names are listed in subscribeCalls',
      records: SUBSCRIBE_CALLS,
    });
  }
  return {
    proposal: {
      evidence: [`Supabase beside JS code (${readers.join(", ")}): the client's \`.from()\` / \`.rpc()\` / Realtime calls are read here and joined to the pages and screens that run them`],
      options: {},
    },
    questions,
  };
}
