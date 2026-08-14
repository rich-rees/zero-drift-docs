// Tests for page-wrapper resolution (DIO-181): a page.tsx whose default
// export is a bare wrapper around a single `@/`-imported component should
// resolve to that component's import source; anything with real logic stays
// unresolved.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWrapperTarget } from "../src/adapters/nextjs-supabase/index.mjs";

test("resolveWrapperTarget: bare named-import wrapper resolves", () => {
  const text = `import { ClientsPage } from "@/components/settings/ClientsPage";

export default function Page() {
  return <ClientsPage />;
}
`;
  assert.equal(resolveWrapperTarget(text), "@/components/settings/ClientsPage");
});

test("resolveWrapperTarget: aliased import resolves", () => {
  const text = `import { ClientsPage as CP } from "@/components/settings/ClientsPage";

export default function Page() {
  return <CP />;
}
`;
  assert.equal(resolveWrapperTarget(text), "@/components/settings/ClientsPage");
});

test("resolveWrapperTarget: default-import wrapper resolves", () => {
  const text = `import BankPage from '@/components/bank/BankPage'

export default function Page() {
  return <BankPage />
}
`;
  assert.equal(resolveWrapperTarget(text), "@/components/bank/BankPage");
});

test("resolveWrapperTarget: parenthesised multi-line return resolves", () => {
  const text = `import { SetsPage } from "@/components/bank/SetsPage";

export default function Page() {
  return (
    <SetsPage />
  );
}
`;
  assert.equal(resolveWrapperTarget(text), "@/components/bank/SetsPage");
});

test("resolveWrapperTarget: real logic in page.tsx stays unresolved", () => {
  const text = `import { createServerClient } from '@/lib/supabase/server'
import JourneyBreadcrumb from '@/components/journeys/JourneyBreadcrumb'
import JourneyEditorTabs from './JourneyEditorTabs'

export default async function JourneyCanvasPage({ params }) {
  const { id } = await params
  const supabase = createServerClient()
  const { data } = await supabase.from('journeys').select('title').eq('id', id).single()
  return (
    <div className="flex flex-col h-full">
      <JourneyBreadcrumb journeyName={data?.title ?? 'Journey'} />
      <JourneyEditorTabs surveyId={id} />
    </div>
  )
}
`;
  assert.equal(resolveWrapperTarget(text), null);
});

test("resolveWrapperTarget: props on the component disqualify (not bare)", () => {
  const text = `import { LoginPage } from "@/components/auth/LoginPage";

export default function Page() {
  return <LoginPage mode="sso" />;
}
`;
  assert.equal(resolveWrapperTarget(text), null);
});

test("resolveWrapperTarget: one styling-only DOM wrapper element resolves", () => {
  const text = `import { JourneyListPage } from "@/components/journeys/JourneyListPage";

export default function JourneysPage() {
  return (
    <div className="h-full">
      <JourneyListPage />
    </div>
  );
}
`;
  assert.equal(resolveWrapperTarget(text), "@/components/journeys/JourneyListPage");
});

test("resolveWrapperTarget: two components inside the wrapper stay unresolved", () => {
  const text = `import { Crumb } from "@/components/Crumb";
import { Body } from "@/components/Body";

export default function Page() {
  return (
    <div>
      <Crumb />
      <Body />
    </div>
  );
}
`;
  assert.equal(resolveWrapperTarget(text), null);
});

test("resolveWrapperTarget: trailing exports after the function stay unresolved", () => {
  // The body capture is greedy to the file's last brace — anything after the
  // default export (e.g. a metadata export) fails the bare-return match. The
  // safe direction: such pages keep themselves as primary resource.
  const text = `import { AboutPage } from "@/components/AboutPage";

export default function Page() {
  return <AboutPage />;
}

export const metadata = { title: "About" };
`;
  assert.equal(resolveWrapperTarget(text), null);
});

test("resolveWrapperTarget: relative import stays unresolved (only @/ is followed)", () => {
  const text = `import { LocalThing } from "./LocalThing";

export default function Page() {
  return <LocalThing />;
}
`;
  assert.equal(resolveWrapperTarget(text), null);
});
