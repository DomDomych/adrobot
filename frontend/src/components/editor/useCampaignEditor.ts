import { useRef, useState } from "react";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import { campaignKeys, editorQuery } from "../../api/queries";
import type {
  CampaignEditor,
  FetchEditorRequest,
  OfferAction,
} from "../../api/types";

export type EditorOperation =
  | { kind: "action"; streamId: number; action: OfferAction }
  | { kind: "cancel" | "publish"; streamId: number }
  | { kind: "fetch"; body: FetchEditorRequest }
  | { kind: "reload" };

export function uncertainEditorError(error: Error) {
  return (
    !(error instanceof ApiError) ||
    [
      "network_error",
      "invalid_response",
      "publication_unknown",
      "editor_storage_unavailable",
    ].includes(error.code) ||
    (error.code === "http_error" && error.status >= 500)
  );
}

export function useCampaignEditor(id: number) {
  const client = useQueryClient();
  const lock = useRef(false);
  const mutationKey = ["editor-operation", id];
  const active = useIsMutating({ mutationKey }) > 0;
  const [needsReload, setNeedsReload] = useState(false);
  const query = useQuery({
    ...editorQuery(id),
    enabled: !active,
    staleTime: Infinity,
    refetchOnMount: "always",
  });
  const mutation = useMutation({
    mutationKey,
    retry: false,
    mutationFn: async (op: EditorOperation) => {
      // GET cancellation prevents an older snapshot from overwriting a mutation response.
      await client.cancelQueries({
        queryKey: campaignKeys.editor(id),
        exact: true,
      });
      if (op.kind === "reload") {
        await client.fetchQuery(editorQuery(id));
        setNeedsReload(false);
        return;
      }
      try {
        if (op.kind === "fetch") {
          const result = await api.fetchEditor(id, op.body);
          client.setQueryData(campaignKeys.editor(id), result);
        } else {
          const current = client.getQueryData<CampaignEditor>(
            campaignKeys.editor(id),
          );
          const stream = current?.streams.find(
            (s) => s.stream.id === op.streamId,
          );
          if (!stream || stream.revision === null)
            throw new ApiError(
              "Загрузите актуальное состояние редактора.",
              409,
              "revision_conflict",
            );
          const result =
            op.kind === "action"
              ? await api.editorAction(id, op.streamId, {
                  ...op.action,
                  revision: stream.revision,
                })
              : op.kind === "publish"
                ? await api.publishEditor(id, op.streamId, stream.revision)
                : await api.cancelEditor(id, op.streamId, stream.revision);
          client.setQueryData<CampaignEditor>(
            campaignKeys.editor(id),
            (old) =>
              old && {
                ...old,
                streams: old.streams.map((s) =>
                  s.stream.id === op.streamId ? result : s,
                ),
              },
          );
          // Cancel returns a regular view even for an orphan. GET removes the orphan
          // or restores its read-only remote counterpart without inventing local state.
          if (op.kind === "cancel" && stream.missing)
            await client.fetchQuery(editorQuery(id));
        }
        if (op.kind === "publish" || op.kind === "fetch") {
          await Promise.all([
            client.cancelQueries({ queryKey: campaignKeys.detail(id) }),
            client.cancelQueries({ queryKey: campaignKeys.lists }),
          ]);
          await Promise.all([
            client.invalidateQueries({ queryKey: campaignKeys.detail(id) }),
            client.invalidateQueries({ queryKey: campaignKeys.lists }),
          ]);
        }
        setNeedsReload(false);
      } catch (error) {
        const failure =
          error instanceof Error
            ? error
            : new Error("Неизвестная ошибка редактора.");
        if (
          uncertainEditorError(failure) ||
          (failure instanceof ApiError &&
            ["revision_conflict", "draft_conflict"].includes(failure.code))
        ) {
          setNeedsReload(true);
          try {
            await client.fetchQuery(editorQuery(id));
            setNeedsReload(false);
          } catch {
            /* Preserve the last displayed draft; edits stay blocked until GET succeeds. */
          }
        }
        throw failure;
      }
    },
  });
  async function execute(
    op: EditorOperation,
    onFailure?: (error: Error) => void,
  ): Promise<boolean> {
    // Synchronous guard also covers double clicks before React renders disabled controls.
    if (lock.current || client.isMutating({ mutationKey }) > 0) return false;
    lock.current = true;
    try {
      await mutation.mutateAsync(op);
      return true;
    } catch (error) {
      onFailure?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    } finally {
      lock.current = false;
    }
  }
  return {
    query,
    mutation,
    execute,
    busy: active || mutation.isPending,
    needsReload,
  };
}
