// src/app/api/things/route.ts
// List (GET) and create (POST) things.
import { createClient } from "@/lib/supabase";

export async function GET() {
  const supabase = createClient();
  const { data } = await supabase.from("things").select("*").order("title");
  return Response.json(data);
}

export async function POST(req: Request) {
  const body = await req.json();
  const supabase = createClient();
  const { data, error } = await supabase.from("things").insert(body).select().single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json(data, { status: 201 });
}
