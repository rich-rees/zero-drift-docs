import { RouteSearchPanel } from "../components/RouteSearchPanel";
import { Badge } from "../components/Badge";
import { Sparkline } from "../widgets/Sparkline";
import { Button } from "../../../../packages/ui/src/Button";
import { useServices } from "../services";

// A component declared in a page file is the page's own, never a record.
function JobRow({ id }: { id: string }) {
  return <li>{id}</li>;
}

export function JobsPage() {
  const { api } = useServices();
  const jobs = api.get("/jobs");
  return (
    <main>
      <Badge tone="info">{String(jobs)}</Badge>
      <Sparkline points={[1, 2]} />
      <ul>{[].map((id) => <JobRow key={id} id={id} />)}</ul>
      <RouteSearchPanel jobId="j1" />
      <Button label="Refresh" onPress={() => {}} />
    </main>
  );
}
