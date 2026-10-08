import { Badge } from "../components/Badge";
import { useServices } from "../services";

export function ActivityPage() {
  const { api } = useServices();
  const events = api.get("/activity");
  return (
    <main>
      <Badge tone="warn">live</Badge>
      {String(events)}
    </main>
  );
}
