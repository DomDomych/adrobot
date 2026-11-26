import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { campaignKeys } from "../api/queries";
import { Alert, Button, Card, Empty, Modal, Skeleton, Space, Tag } from "antd";
import {
  ArrowLeftOutlined,
  ExportOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Link, useBeforeUnload, useBlocker, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import type { CampaignEditor, FetchEditorRequest } from "../api/types";
import { CampaignParameters } from "../components/CampaignSummary";
import { ErrorNotice } from "../components/ErrorNotice";
import { EditorStreamCard } from "../components/editor/EditorStreamCard";
import { EditorError } from "../components/editor/EditorError";
import { useCampaignEditor } from "../components/editor/useCampaignEditor";

export function CampaignPage() {
  const id = Number(useParams().campaignId);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647)
    return (
      <div className="stack">
        <Link to="/campaigns">Кампаниям</Link>
        <ErrorNotice error={new Error("Некорректный ID кампании.")} />
      </div>
    );
  return <CampaignEditorPage key={id} id={id} />;
}
function CampaignEditorPage({ id }: { id: number }) {
  const client = useQueryClient();
  const { query, mutation, execute, busy, needsReload } = useCampaignEditor(id);
  const [discard, setDiscard] = useState<FetchEditorRequest | null>(null);
  const blocker = useBlocker(busy);
  useEffect(() => {
    if (blocker.state === "blocked") blocker.reset();
  }, [blocker]);
  useBeforeUnload((event) => {
    if (busy) event.preventDefault();
  });
  const data = query.data;
  const disabled = busy || query.isFetching || query.isError || needsReload || Boolean(discard);
  const operation = mutation.variables;
  async function fetchStreams(body: FetchEditorRequest = {}) {
    const ok = await execute({ kind: "fetch", body }, (error) => {
      if (
        error instanceof ApiError &&
        error.code === "draft_conflict" &&
        client.getQueryState(campaignKeys.editor(id))?.status === "success"
      ) {
        const current = client.getQueryData<CampaignEditor>(
          campaignKeys.editor(id),
        );
        const revisions: Record<string, number> = {};
        for (const stream of current?.streams ?? []) {
          if (stream.dirty && stream.revision !== null)
            revisions[String(stream.stream.id)] = stream.revision;
        }
        // Snapshot the revisions the user confirms; conflicts require a new confirmation.
        setDiscard({ discard_drafts: true, revisions });
      }
    });
    if (ok) setDiscard(null);
  }
  const streamErrorId =
    mutation.isError && operation && "streamId" in operation
      ? operation.streamId
      : null;
  const streamExists = data?.streams.some(
    (s) => s.stream.id === streamErrorId && (s.editable || s.missing),
  );
  return (
    <div className="stack">
      <Link
        className="back-link"
        to="/campaigns"
        aria-disabled={busy}
        onClick={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <ArrowLeftOutlined /> Кампании
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Кампания #{id}</div>
          <h1>{data?.campaign.name ?? "Редактор кампании"}</h1>
          <p className="muted">
            Изменения сохраняются в черновике. Push to KT публикует выбранный
            поток.
          </p>
        </div>
        <Space wrap>
          <Button
            icon={<ReloadOutlined />}
            disabled={disabled || !data}
            loading={busy && operation?.kind === "fetch"}
            onClick={() => {
              void fetchStreams();
            }}
          >
            Fetch Streams from KT
          </Button>
          <Button
            href={`https://keitaro-for-tests.etolegko.com/admin/#!/campaign.editor/${id}`}
            target="_blank"
            rel="noopener noreferrer"
            icon={<ExportOutlined />}
          >
            View in KT
          </Button>
        </Space>
      </div>
      {query.isError && (
        <ErrorNotice
          error={query.error}
          retry={
            !busy
              ? () => {
                  void execute({ kind: "reload" });
                }
              : undefined
          }
        />
      )}
      {needsReload && (
        <Alert
          type="warning"
          showIcon
          title="Нужно уточнить состояние редактора"
          description="Черновик остаётся на экране. Изменения заблокированы до успешной загрузки актуального состояния."
          action={
            <Button
              disabled={busy}
              onClick={() => {
                void execute({ kind: "reload" });
              }}
            >
              Загрузить состояние
            </Button>
          }
        />
      )}
      {mutation.isError && !streamExists && (
        <EditorError
          error={mutation.error}
          publishing={operation?.kind === "publish"}
        />
      )}
      {busy && (
        <p role="status" className="muted">
          Выполняется запрос. Дождитесь результата.
        </p>
      )}
      {query.isPending && <Skeleton active />}
      {data && (
        <>
          <CampaignParameters campaign={data.campaign} />
          <section className="stack" aria-label="Редактор офферов">
            <h2>Потоки с офферами</h2>
            {!data.streams.some((s) => s.editable || s.missing) && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Нет потоков для редактирования"
              />
            )}
            {data.streams
              .filter((s) => s.editable || s.missing)
              .map((stream) => (
                <EditorStreamCard
                  key={stream.stream.id}
                  data={stream}
                  disabled={disabled}
                  execute={execute}
                  error={
                    streamErrorId === stream.stream.id
                      ? (mutation.error ?? undefined)
                      : undefined
                  }
                  operation={
                    operation &&
                    "streamId" in operation &&
                    operation.streamId === stream.stream.id
                      ? operation
                      : undefined
                  }
                  success={
                    mutation.isSuccess &&
                    operation &&
                    "streamId" in operation &&
                    operation.streamId === stream.stream.id
                  }
                />
              ))}
          </section>
          {data.streams.some((s) => !s.editable && !s.missing) && (
            <section aria-label="Остальные потоки" className="stack">
              <h2>Остальные потоки</h2>
              {data.streams
                .filter((s) => !s.editable && !s.missing)
                .map(({ stream }) => (
                  <Card
                    key={stream.id}
                    size="small"
                    title={`${stream.position ?? "—"}. ${stream.name}`}
                    extra={<span className="muted">#{stream.id}</span>}
                  >
                    <Space wrap>
                      <Tag>{stream.schema}</Tag>
                      <span className="muted">Только просмотр</span>
                    </Space>
                    {stream.action_payload && <p>{stream.action_payload}</p>}
                    {stream.filters?.map((filter, i) => (
                      <p key={i}>
                        {filter.name} · {filter.mode}:{" "}
                        {filter.payload.join(", ")}
                      </p>
                    ))}
                  </Card>
                ))}
            </section>
          )}
        </>
      )}
      <Modal
        title="Отбросить черновики и получить потоки из Keitaro?"
        open={Boolean(discard)}
        okText="Отбросить и получить"
        cancelText="Оставить черновики"
        confirmLoading={busy}
        closable={!busy}
        keyboard={!busy}
        mask={{ closable: false }}
        cancelButtonProps={{ disabled: busy }}
        onCancel={() => setDiscard(null)}
        onOk={async () => {
          if (!discard || busy) return;
          const body = discard;
          setDiscard(null);
          await fetchStreams(body);
        }}
      >
        <p>
          Неопубликованные изменения всех перечисленных потоков будут потеряны.
          Опубликованные данные в Keitaro не изменятся.
        </p>
        <ul>
          {Object.entries(discard?.revisions ?? {}).map(
            ([streamId, revision]) => (
              <li key={streamId}>
                Поток #{streamId} · ревизия {revision}
              </li>
            ),
          )}
        </ul>
      </Modal>
    </div>
  );
}
