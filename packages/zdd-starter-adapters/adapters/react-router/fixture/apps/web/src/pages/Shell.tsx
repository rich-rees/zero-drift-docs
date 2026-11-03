import { Outlet } from "react-router";
import { useServices } from "../services";
export function Shell() {
  const { api } = useServices();
  const me = api.get("/me");
  return <Outlet context={me} />;
}
