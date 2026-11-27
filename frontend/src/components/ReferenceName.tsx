import { useQuery } from "@tanstack/react-query";
import { referencesQuery } from "../api/queries";
import type { References } from "../api/types";

export function ReferenceName({ kind, id }: {
  kind: "domains" | "groups" | "traffic_sources";
  id: number | null;
}) {
  const query = useQuery(referencesQuery);
  const items: References[typeof kind] = query.data?.[kind] ?? [];
  const item = items.find((entry) => entry.id === id);
  return <>{item ? `${item.name} · #${id}` : id ?? "—"}</>;
}
