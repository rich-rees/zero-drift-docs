import { useServices } from "../services";
export function ActivityPage() {
  const { api } = useServices();
  const events = api.get("/activity");
  return <main>{String(events)}</main>;
}
