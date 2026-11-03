// One job: put it on a fixed route.
import { useLocalSearchParams } from "expo-router";
import { api } from "../../../src/api";
export default function JobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const choose = (routeId: string) => api.post(`/jobs/${id}/route`, { routeId });
  return null;
}
