// What the administration screens read and change, all through the API.
import { useServices } from "../services";
const PAGE = 50;
export function useUsers() {
  const { api } = useServices();
  return api.get("/users");
}
export function useInvite() {
  const { api } = useServices();
  return (body: unknown) => api.post("/users/invite", body);
}
export function useTenants() {
  const { api } = useServices();
  return api.get(`/tenants?limit=${PAGE}`);
}
