import { Navigate, type RouteObject } from "react-router";
import { SignInPage } from "./pages/SignInPage";
import { Shell } from "./pages/Shell";
import { LandingPage } from "./pages/LandingPage";
import { ActivityPage } from "./pages/ActivityPage";
import { AdminOnly } from "./pages/admin/AdminOnly";
import { UsersPage } from "./pages/admin/UsersPage";
import { TenantsPage } from "./pages/admin/TenantsPage";
import { NotFoundPage } from "./pages/NotFoundPage";

// React Router in library mode: one page outside sign-in, the rest behind
// the shell. A comment like this one is not a route's description.
export const routes: RouteObject[] = [
  { path: "/sign-in", element: <SignInPage /> },
  {
    element: <Shell />,
    children: [
      { index: true, element: <LandingPage /> },
      // Everyone signed in: the audit trail as a live feed.
      { path: "activity", element: <ActivityPage /> },
      // Where the trail lived before: a bookmark still lands.
      { path: "admin/audit", element: <Navigate to="/activity" replace /> },
      // An administrator's screens; anyone else sees not-found.
      {
        element: <AdminOnly />,
        children: [
          { path: "admin/users", element: <UsersPage /> },
          { path: "admin/tenants/:tenantId", element: <TenantsPage /> },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
