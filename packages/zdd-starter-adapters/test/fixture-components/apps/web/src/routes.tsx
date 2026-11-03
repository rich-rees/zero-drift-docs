import type { RouteObject } from "react-router";
import { JobsPage } from "./pages/JobsPage";
import { ActivityPage } from "./pages/ActivityPage";

export const routes: RouteObject[] = [
  // The job list and its route search.
  { path: "/jobs", element: <JobsPage /> },
  // The audit trail as a live feed.
  { path: "/activity", element: <ActivityPage /> },
];
