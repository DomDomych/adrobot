import { useQuery } from "@tanstack/react-query";
import { Button, Card, Empty, Space, Table } from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { Link, useSearchParams } from "react-router-dom";
import { campaignsQuery, PAGE_SIZE } from "../api/queries";
import type { Campaign } from "../api/types";
import { CampaignState } from "../components/CampaignSummary";
import { ReferenceName } from "../components/ReferenceName";
import { ErrorNotice } from "../components/ErrorNotice";
export function CampaignsPage() {
  const [params, setParams] = useSearchParams();
  const requestedPage = Number(params.get("page") ?? "1");
  const page =
    Number.isSafeInteger(requestedPage) &&
    requestedPage > 0 &&
    requestedPage <= 1_000_000
      ? requestedPage
      : 1;
  const query = useQuery(campaignsQuery(page));
  const rows = query.data?.slice(0, PAGE_SIZE) ?? [];
  const hasNext = (query.data?.length ?? 0) > PAGE_SIZE;
  return (
    <div className="stack">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Кампании</div>
          <h1>Список кампаний</h1>
          <p className="muted">
            Кампании из Keitaro и их текущая конфигурация.
          </p>
        </div>
        <Link to="/campaigns/new">
          <Button type="primary" icon={<PlusOutlined />}>
            Создать кампанию
          </Button>
        </Link>
      </div>
      {query.isError && (
        <ErrorNotice
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      )}
      <Card
        className="table-card"
        size="small"
        title="Все кампании"
        extra={
          <Button
            icon={<ReloadOutlined />}
            loading={query.isFetching}
            onClick={() => {
              void query.refetch();
            }}
          >
            Обновить
          </Button>
        }
      >
        {query.isError && query.data && (
          <p className="stale-notice">
            Показаны ранее загруженные данные. Не удалось проверить изменения.
          </p>
        )}
        <Table<Campaign>
          rowKey="id"
          size="middle"
          pagination={false}
          loading={query.isFetching}
          dataSource={rows}
          scroll={{ x: 900 }}
          locale={{
            emptyText: query.isPending ? (
              "Загрузка кампаний…"
            ) : query.isError ? (
              "Данные недоступны"
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  page === 1
                    ? "Кампаний пока нет"
                    : "На этой странице нет кампаний"
                }
              >
                {page === 1 && (
                  <Link to="/campaigns/new">
                    <Button type="primary">Создать первую кампанию</Button>
                  </Link>
                )}
              </Empty>
            ),
          }}
          columns={[
            {
              title: "ID",
              dataIndex: "id",
              width: 80,
              render: (id: number) => <span className="mono muted">{id}</span>,
            },
            {
              title: "Название",
              dataIndex: "name",
              width: 300,
              render: (name: string, record) => (
                <Link className="campaign-name" to={`/campaigns/${record.id}`}>
                  {name}
                </Link>
              ),
            },
            {
              title: "Состояние",
              dataIndex: "state",
              width: 130,
              render: (state: string | null) => <CampaignState state={state} />,
            },
            {
              title: "Алиас",
              dataIndex: "alias",
              render: (value: string | null) => (
                <span className="mono">{value ?? "—"}</span>
              ),
            },
            {
              title: "Домен",
              dataIndex: "domain_id",
              render: (value: number | null) => <ReferenceName kind="domains" id={value} />,
            },
            {
              title: "Группа",
              dataIndex: "group_id",
              render: (value: number | null) => <ReferenceName kind="groups" id={value} />,
            },
            {
              title: "Источник",
              dataIndex: "traffic_source_id",
              render: (value: number | null) => <ReferenceName kind="traffic_sources" id={value} />,
            },
          ]}
        />
        <div className="table-footer">
          <span className="muted" aria-live="polite">
            Страница {page}
            {rows.length > 0
              ? ` · Записи ${(page - 1) * PAGE_SIZE + 1}–${(page - 1) * PAGE_SIZE + rows.length}`
              : ""}
          </span>
          <Space>
            <Button
              disabled={page === 1 || query.isFetching}
              onClick={() => setParams({ page: String(page - 1) })}
            >
              Назад
            </Button>
            <Button
              disabled={!hasNext || query.isFetching || query.isError}
              onClick={() => setParams({ page: String(page + 1) })}
            >
              Далее
            </Button>
          </Space>
        </div>
      </Card>
    </div>
  );
}
