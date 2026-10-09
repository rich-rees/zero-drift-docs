// Checkout: places a real order.
import { supabase } from "@/lib/db";
export async function POST(req: Request) {
  const body = await req.json();
  await supabase.from("orders").insert(body);
  return Response.json({ ok: true });
}
