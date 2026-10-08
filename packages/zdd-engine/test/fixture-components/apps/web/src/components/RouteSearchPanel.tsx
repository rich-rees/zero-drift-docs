import { useState } from "react";
import { Badge } from "./Badge";
import { useServices } from "../services";

// A row of the result list: declared here, not exported, so not a record.
function Row({ name }: { name: string }) {
  return <li>{name}</li>;
}

/**
 * Search a job's candidate fixed routes and choose one.
 * Calls the search and the choose endpoints.
 */
export function RouteSearchPanel({ jobId, onChosen }: { jobId: string; onChosen?: (routeId: string) => void }) {
  const { api } = useServices();
  const [rows, setRows] = useState<string[]>([]);
  const search = () => setRows(api.post(`/jobs/${jobId}/route-search`, {}) as string[]);
  const choose = (routeId: string) => {
    api.post(`/jobs/${jobId}/route`, { routeId });
    onChosen?.(routeId);
  };
  // api.post("/jobs/commented-out/route") — a comment is not a call
  return (
    <section>
      <Badge tone="info">{rows.length}</Badge>
      <button onClick={search}>Search</button>
      <ul>{rows.map((r) => <Row key={r} name={r} />)}</ul>
      <button onClick={() => choose(rows[0])}>Choose</button>
    </section>
  );
}
