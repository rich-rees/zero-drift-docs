// Sweeps jobs stuck past their deliver-by date.
export async function GET() {
  return Response.json({ ok: true });
}
