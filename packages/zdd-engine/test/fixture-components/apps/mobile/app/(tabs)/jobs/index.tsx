// The job list, the same endpoint the web page reads.
import { FlatList } from "react-native";
import { Button } from "../../../../../packages/ui/src/Button";
import { api } from "../../../src/api";
export default function JobsScreen() {
  const jobs = api.get("/jobs");
  return <FlatList data={jobs} renderItem={() => <Button label="Open" onPress={() => {}} />} />;
}
