// src/app/things/[id]/page.tsx
// Thing detail — loads one thing and renders it inline (real logic, no wrapper).
export default async function ThingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`/api/things/${id}`);
  const thing = await res.json();
  return (
    <main>
      <h1>{thing.title}</h1>
    </main>
  );
}
