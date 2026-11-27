import { Card, Descriptions, Empty, Tag, Typography } from "antd";
import { ReferenceName } from "./ReferenceName";
import { offerLabel, streamType, streamSchema } from "../lib/labels";
import type { Campaign, CampaignDetails, Offer } from "../api/types";
export function CampaignState({ state }: { state: string | null }) {
  if (!state) return <span className="muted">—</span>;
  const labels: Record<string, string> = {
    active: "Активна",
    disabled: "Отключена",
    deleted: "Удалена",
  };
  return (
    <Tag color={state === "active" ? "green" : undefined}>
      {labels[state] ?? state}
    </Tag>
  );
}
export function CampaignSummary({ details, selectedOffer }: { details: CampaignDetails; selectedOffer?: Offer }) {
  const { campaign, streams } = details;
  return (
    <div className="stack">
      <CampaignParameters campaign={campaign} />
      <section aria-label="Потоки" className="stack">
        <h2>
          Потоки <span className="muted">{streams.length}</span>
        </h2>
        {!streams.length && (
          <Empty
            description="Потоков нет"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
        {[...streams]
          .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))
          .map((stream) => (
            <Card
              size="small"
              key={stream.id}
              title={
                <span>
                  {stream.position ?? "—"}. {stream.name}
                </span>
              }
              extra={<span className="muted">#{stream.id}</span>}
            >
              <div className="stream-meta">
                <Tag>
                  {streamType(stream.type)}
                </Tag>
                <Tag>{streamSchema(stream.schema)}</Tag>
              </div>
              {stream.action_payload && (
                <p>
                  Назначение:{" "}
                  <Typography.Text code>
                    {stream.action_payload}
                  </Typography.Text>
                </p>
              )}
              {stream.filters?.map((filter, index) => (
                <p key={index}>
                  {filter.name === "country" ? "Страна" : filter.name} ·{" "}
                  {filter.mode === "accept" ? "Принимать" : filter.mode}:{" "}
                  {Array.isArray(filter.payload) ? filter.payload.join(", ") : String(filter.payload ?? "")}
                </p>
              ))}
              {stream.offers.map((offer) => (
                <p key={offer.offer_id}>
                  <strong>{selectedOffer?.id === offer.offer_id ? offerLabel(offer.offer_id, selectedOffer.name) : `Оффер #${offer.offer_id}`}</strong>{" "}
                  <Tag color="blue">{offer.share}%</Tag>
                  <span className="muted">
                    {offer.state === "active" ? "Активен" : offer.state}
                  </span>
                </p>
              ))}
            </Card>
          ))}
      </section>
    </div>
  );
}

export function CampaignParameters({ campaign }: { campaign: Campaign }) {
  return (
    <Card size="small" title="Параметры кампании">
      <Descriptions
        size="small"
        column={{ xs: 1, sm: 2, lg: 3 }}
        items={[
          { key: "id", label: "ID", children: campaign.id },
          {
            key: "state",
            label: "Состояние",
            children: <CampaignState state={campaign.state} />,
          },
          { key: "alias", label: "Алиас", children: campaign.alias ?? "—" },
          {
            key: "domain",
            label: "Домен",
            children: <ReferenceName kind="domains" id={campaign.domain_id} />,
          },
          {
            key: "group",
            label: "Группа",
            children: <ReferenceName kind="groups" id={campaign.group_id} />,
          },
          {
            key: "source",
            label: "Источник",
            children: <ReferenceName kind="traffic_sources" id={campaign.traffic_source_id} />,
          },
        ]}
      />
    </Card>
  );
}
