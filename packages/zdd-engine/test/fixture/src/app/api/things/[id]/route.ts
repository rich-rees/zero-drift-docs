// src/app/api/things/[id]/route.ts
// Read (GET), save (PUT), and delete (DELETE) one thing.
import { createClient } from "@/lib/supabase";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const { data } = await supabase.from("things").select("*").eq("id", id).single();
  return Response.json(data);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { title } = await req.json();
  const supabase = createClient();
  const { error } = await supabase.rpc("save_thing", { p_id: id, p_title: title });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  await supabase.from("things").delete().eq("id", id);
  return new Response(null, { status: 204 });
}
