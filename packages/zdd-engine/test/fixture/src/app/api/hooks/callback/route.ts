// src/app/api/hooks/callback/route.ts
// Machine-to-machine callback from the external worker — HMAC-verified.
import { verifySignature } from "@/lib/signing";
import { createClient } from "@/lib/supabase";

export async function POST(req: Request) {
  const body = await req.text();
  if (!verifySignature(req.headers.get("x-signature"), body)) {
    return new Response("bad signature", { status: 401 });
  }
  const supabase = createClient();
  await supabase.from("audit_log").insert(JSON.parse(body));
  return Response.json({ ok: true });
}
