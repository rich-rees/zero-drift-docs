// Thing detail — loads one thing from the API.
export default async function Thing({ params }: { params: { id: string } }) {
  const thing = await fetch(`/api/things?id=${params.id}`).then((r) => r.json());
  return <main>{thing.title}</main>;
}
