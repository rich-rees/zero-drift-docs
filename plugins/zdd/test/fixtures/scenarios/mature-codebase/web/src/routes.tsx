import { Fleet } from "./pages/Fleet";
import { Vehicle } from "./pages/Vehicle";
export const routes = [
  { path: "/", element: <Fleet /> },
  { path: "/vehicles/:id", element: <Vehicle /> },
];
