// The tripwire list both border tests read (decision 0036 for the core,
// decision 0039 for the plugin): the stack, framework, library, platform and
// vendor names ZDD has met. A finite list catches the names ZDD knows, not
// every name; it lives in the tests because neither the core nor the plugin
// may hold it.
export const STACK_WORDS = [
  "next.js", "nextjs", "react", "react-router", "expo", "expo-router", "vue", "nuxt", "svelte", "sveltekit", "angular", "remix", "astro", "gatsby", "solidjs",
  "fastapi", "django", "flask", "rails", "laravel", "express", "nestjs", "hono", "spring", "deno",
  "supabase", "supabase-js", "supabase-py", "postgres", "postgresql", "mysql", "sqlalchemy", "prisma", "drizzle", "mongodb", "firebase", "redis",
  "vercel", "railway", "cloudflare", "wrangler", "procfile", "heroku", "netlify", "docker", "fly.io", "aws", "azure", "gcp",
  "sentry", "resend", "mailgun", "stripe", "twilio", "bullmq", "inngest", "trigger.dev", "sqs", "kafka", "rabbitmq", "pg_cron",
];
const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A word ends at anything that is not a letter or digit, so `adapter-react`,
// `vendor.react` and `next_js`-style joins are still words (CR-004).
export const WORD_RE = () => new RegExp(`(^|[^a-z0-9])(${STACK_WORDS.map(escape).join("|")})(?=$|[^a-z0-9])`, "gi");
