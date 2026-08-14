// src/middleware.ts
// Session gate for everything except the hooks endpoints and static assets.
export { auth as middleware } from "./lib/auth";

export const config = {
  matcher: ["/((?!api/hooks|login|_next).*)"],
};
