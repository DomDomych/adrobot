import { useQuery } from "@tanstack/react-query";
import { Button, Skeleton } from "antd";
import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import { Link, useParams } from "react-router-dom";
import { campaignQuery } from "../api/queries";
import { CampaignSummary } from "../components/CampaignSummary";
import { ErrorNotice } from "../components/ErrorNotice";
export function CampaignPage() {
  const id = Number(useParams().campaignId);
  const valid = Number.isSafeInteger(id) && id > 0;
  const query = useQuery({ ...campaignQuery(id), enabled: valid });
  return (
    <div className="stack">
      <Link className="back-link" to="/campaigns">
        <ArrowLeftOutlined /> Кампании
      </Link>
      {!valid ? (
        <ErrorNotice error={new Error("Некорректный ID кампании.")} />
      ) : (
        <>
          <div className="page-heading">
            <div>
              <div className="eyebrow">Кампания #{id}</div>
              <h1>{query.data?.campaign.name ?? "Просмотр кампании"}</h1>
              <p className="muted">Конфигурация и потоки из Keitaro.</p>
            </div>
            <Button
              icon={<ReloadOutlined />}
              loading={query.isFetching}
              onClick={() => {
                void query.refetch();
              }}
            >
              Обновить
            </Button>
          </div>
          {query.isError && (
            <ErrorNotice
              error={query.error}
              retry={() => {
                void query.refetch();
              }}
            />
          )}
          {query.isError && query.data && (
            <p className="muted">Показана ранее загруженная конфигурация.</p>
          )}
          {query.isPending && <Skeleton active />}
          {query.data && <CampaignSummary details={query.data} />}
        </>
      )}
    </div>
  );
}
