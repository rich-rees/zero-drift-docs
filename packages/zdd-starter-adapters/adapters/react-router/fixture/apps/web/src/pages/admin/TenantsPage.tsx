import { useTenants } from "../../admin/api";
export function TenantsPage() { return <main>{String(useTenants())}</main>; }
