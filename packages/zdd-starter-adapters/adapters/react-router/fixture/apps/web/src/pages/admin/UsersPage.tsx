import { useInvite, useUsers } from "../../admin/api";
export function UsersPage() {
  const users = useUsers();
  const invite = useInvite();
  return <main>{String(users)}{String(invite)}</main>;
}
