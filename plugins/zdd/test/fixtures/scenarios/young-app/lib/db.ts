import { createClient } from "@supabase/supabase-js";
export const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
export const resendKey = process.env.RESEND_API_KEY;
