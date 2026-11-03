// src/app/api/hooks/status/route.ts
// Worker status probe — checks the caller's session inside the handler
// (the middleware matcher excludes api/hooks).
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  return Response.json({ status: "idle" });
}
