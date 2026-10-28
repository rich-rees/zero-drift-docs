import { createBrowserRouter } from "react-router";
import Home from "./pages/Home";
import Thing from "./pages/Thing";

export const router = createBrowserRouter([
  { path: "/dashboard", element: <Home /> },
  { path: "/dashboard/things/:id", element: <Thing /> },
]);
