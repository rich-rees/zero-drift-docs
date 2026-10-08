// The nightly report: counts yesterday's jobs and mails the summary.
import { db } from "./db.mjs";
export async function main() {
  const rows = await db.from("jobs").select("count");
  await db.query("insert into reports (day, total) values ($1, $2)", [new Date(), rows.length]);
}
main();
