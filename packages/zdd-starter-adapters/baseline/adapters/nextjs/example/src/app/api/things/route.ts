// List (GET) and create (POST) things.
export async function GET() {
  return Response.json([]);
}
export async function POST(req: Request) {
  return Response.json(await req.json());
}
