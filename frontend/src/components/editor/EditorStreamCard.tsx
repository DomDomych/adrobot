import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Space,
  Table,
  Tag,
  Tooltip,
} from "antd";
import {
  PushpinFilled,
  PushpinOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import type { EditorOffer, EditorStream, OfferAction } from "../../api/types";
import { offerLabel, streamType } from "../../lib/labels";
import { distributionMessage } from "../../lib/errors";
import { OfferSelect } from "../OfferSelect";
import { EditorError } from "./EditorError";
import type { EditorOperation } from "./useCampaignEditor";

function ShareCell({
  offer,
  disabled,
  save,
}: {
  offer: EditorOffer;
  disabled: boolean;
  save: (share: number) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(offer.share));
  const [error, setError] = useState("");
  async function submit() {
    const share = Number(value);
    if (!value.trim() || !Number.isInteger(share) || share < 0 || share > 100) {
      setError("Введите целое число от 0 до 100.");
      return;
    }
    if (await save(share)) setEditing(false);
  }
  if (!offer.active) return <span>0%</span>;
  if (!editing)
    return (
      <button
        type="button"
        className="share-button"
        disabled={disabled}
        aria-label={`Доля оффера ${offer.offer_id}: ${offer.share}%`}
        onClick={() => {
          setValue(String(offer.share));
          setError("");
          setEditing(true);
        }}
      >
        {offer.share}%
      </button>
    );
  return (
    <div className="share-input">
      <Input
        autoFocus
        size="small"
        type="number"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={`Доля оффера ${offer.offer_id}`}
        aria-invalid={Boolean(error)}
        status={error ? "error" : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          setError("");
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
          if (e.key === "Enter") {
            e.preventDefault();
            if (!disabled) void submit();
          }
        }}
      />
      <span className="field-hint">0–100 · Enter — сохранить · Esc — отменить</span>
      {error && (
        <span role="alert" className="input-error">
          {error}
        </span>
      )}
    </div>
  );
}

interface Props {
  data: EditorStream;
  disabled: boolean;
  execute: (operation: EditorOperation) => Promise<boolean>;
  error?: Error;
  operation?: EditorOperation;
  success?: boolean;
}
export function EditorStreamCard({
  data,
  disabled,
  execute,
  error,
  operation,
  success,
}: Props) {
  const [offerId, setOfferId] = useState<number>();
  const activeIds = data.offers.filter((o) => o.active).map((o) => o.offer_id);
  const unavailable =
    disabled || data.missing || !data.editable || data.revision === null;
  const action = (value: OfferAction) =>
    execute({ kind: "action", streamId: data.stream.id, action: value });
  return (
    <section aria-label={`Поток ${data.stream.id}`}>
      <Card
        size="small"
        className={`editor-stream${data.dirty ? " editor-stream-dirty" : ""}`}
        title={
          <Space wrap>
            <span>{data.stream.name}</span>
            <span className="muted">#{data.stream.id}</span>
            <Tag color={data.dirty ? "gold" : "default"}>
              {data.dirty ? "Черновик" : "Сохранено"}
            </Tag>
          </Space>
        }
        extra={
          <Tag>
            {streamType(data.stream.type)}
          </Tag>
        }
      >
        <div className="stack">
          {data.missing && (
            <Alert
              type="warning"
              showIcon
              title="Поток отсутствует или больше не редактируется в Keitaro"
              description="Черновик сохранён для просмотра. Доступна только отмена через Cancel."
            />
          )}
          {error && (
            <EditorError
              error={error}
              publishing={operation?.kind === "publish"}
            />
          )}
          {success && operation?.kind === "publish" && (
            <Alert type="success" showIcon title="Публикация подтверждена" />
          )}
          {success && operation?.kind === "cancel" && (
            <Alert type="success" showIcon title="Черновик отменён" />
          )}
          <Table<EditorOffer>
            size="small"
            rowKey="offer_id"
            pagination={false}
            dataSource={data.offers}
            scroll={{ x: 640 }}
            rowClassName={(o) => (o.active ? "" : "removed-offer")}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="В потоке нет офферов. Добавьте первый оффер."
                />
              ),
            }}
            columns={[
              {
                title: "Оффер",
                key: "offer",
                render: (_, offer) => (
                  <div className="editor-offer-name">
                    {offerLabel(offer.offer_id, offer.name)}
                    {!offer.active && (
                      <span className="removed-label">Удалён</span>
                    )}
                  </div>
                ),
              },
              {
                title: "Доля",
                key: "share",
                width: 180,
                render: (_, offer) => (
                  <ShareCell
                    key={`${offer.offer_id}:${data.revision}`}
                    offer={offer}
                    disabled={unavailable}
                    save={(share) =>
                      action({
                        action: "share",
                        offer_id: offer.offer_id,
                        share,
                      })
                    }
                  />
                ),
              },
              {
                title: "Pin",
                key: "pin",
                width: 64,
                render: (_, offer) =>
                  offer.active && (
                    <Tooltip
                      title={
                        offer.pinned ? "Снять закрепление" : "Закрепить долю"
                      }
                    >
                      <Button
                        type="text"
                        className="pin-button"
                        aria-label={`${offer.pinned ? "Unpin" : "Pin"} ${offer.offer_id}`}
                        aria-pressed={offer.pinned}
                        disabled={unavailable}
                        icon={
                          offer.pinned ? <PushpinFilled /> : <PushpinOutlined />
                        }
                        onClick={() => {
                          void action({
                            action: offer.pinned ? "unpin" : "pin",
                            offer_id: offer.offer_id,
                          });
                        }}
                      />
                    </Tooltip>
                  ),
              },
              {
                title: "Действие",
                key: "action",
                width: 130,
                render: (_, offer) => (
                  <Button
                    size="small"
                    disabled={unavailable}
                    onClick={() => {
                      void action({
                        action: offer.active ? "remove" : "restore",
                        offer_id: offer.offer_id,
                      });
                    }}
                  >
                    {offer.active ? "Remove" : "Bring Back"}
                  </Button>
                ),
              },
            ]}
          />
          <div className="editor-add">
            <OfferSelect
              id={`offer-add-${data.stream.id}`}
              value={offerId}
              onChange={setOfferId}
              disabled={unavailable}
              excludedIds={activeIds}
            />
            <Button
              disabled={
                unavailable ||
                offerId === undefined ||
                activeIds.includes(offerId)
              }
              onClick={async () => {
                if (
                  offerId !== undefined &&
                  (await action({ action: "add", offer_id: offerId }))
                )
                  setOfferId(undefined);
              }}
            >
              Add
            </Button>
          </div>
          <div className="editor-footer">
            <strong>Сумма долей: {data.total_share}%</strong>
            <Space wrap>
              <Button
                type="primary"
                aria-label="Push to KT"
                icon={<UploadOutlined aria-hidden /> }
                disabled={
                  unavailable || !data.dirty || data.validation_error !== null
                }
                onClick={() => {
                  void execute({ kind: "publish", streamId: data.stream.id });
                }}
              >
                Push to KT
              </Button>
              <Button
                disabled={disabled || !data.dirty || data.revision === null}
                onClick={() => {
                  void execute({ kind: "cancel", streamId: data.stream.id });
                }}
              >
                Cancel
              </Button>
            </Space>
          </div>
          {data.validation_error !== null && (
            <Alert
              type="warning"
              showIcon
              title="Публикация недоступна"
              description={distributionMessage(data.validation_error)}
            />
          )}
        </div>
      </Card>
    </section>
  );
}
