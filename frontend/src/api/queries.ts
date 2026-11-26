import { QueryClient, queryOptions } from "@tanstack/react-query";
import { api } from "./client";
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
export const PAGE_SIZE = 20;
export const campaignKeys = {
  lists: ["campaigns", "list"] as const,
  detail: (id: number) => ["campaigns", "detail", id] as const,
};
export const campaignsQuery = (page: number) =>
  queryOptions({
    queryKey: [...campaignKeys.lists, page],
    // One extra row determines whether another page exists; the API has no total.
    queryFn: ({ signal }) =>
      api.campaigns((page - 1) * PAGE_SIZE, PAGE_SIZE + 1, signal),
  });
export const campaignQuery = (id: number) =>
  queryOptions({
    queryKey: campaignKeys.detail(id),
    queryFn: ({ signal }) => api.campaign(id, signal),
  });
