// The web app's error monitor: the same Sentry project, browser SDK.
import * as Sentry from "@sentry/react";
export function start() {
  Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN });
  const maps = process.env.MAPBOX_TOKEN;
  return maps;
}
