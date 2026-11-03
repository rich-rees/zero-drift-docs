// Shared data-access helpers for things — used by pages and scripts alike.
import { createClient } from "./supabase";

export async function listThings() {
  const supabase = createClient();
  return supabase.from("things").select("*");
}

export async function auditFor(thingId: string) {
  const supabase = createClient();
  return supabase.from("audit_log").select("*").eq("thing_id", thingId);
}

export async function saveThingRemote(id: string, title: string) {
  return fetch(`/api/things/${id}`, { method: "PUT", body: JSON.stringify({ title }) });
}
