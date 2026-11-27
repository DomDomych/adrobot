import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Select,
  Space,
} from "antd";
import { ArrowLeftOutlined, CheckCircleOutlined } from "@ant-design/icons";
import { Link, useBeforeUnload, useBlocker } from "react-router-dom";
import { api, ApiError, isUncertainCreation } from "../api/client";
import { campaignKeys } from "../api/queries";
import type { CreateCampaignRequest, Offer } from "../api/types";
import { countries, normalizeName, validateName } from "../lib/countries";
import { OfferSelect } from "../components/OfferSelect";
import { ErrorNotice } from "../components/ErrorNotice";
import { CampaignSummary } from "../components/CampaignSummary";

// Survives reload/navigation so a lost response does not invite a duplicate POST.
const recoveryKey = "adrobot:unconfirmed-creation";
function readRecovery(): string | null {
  try {
    return sessionStorage.getItem(recoveryKey);
  } catch {
    return null;
  }
}
function saveRecovery(name: string | null) {
  try {
    if (name === null) sessionStorage.removeItem(recoveryKey);
    else sessionStorage.setItem(recoveryKey, name);
  } catch {
    /* Storage may be unavailable; the in-memory guard still applies. */
  }
}
export function CreateCampaignPage() {
  const [form] = Form.useForm<CreateCampaignRequest>();
  const queryClient = useQueryClient();
  const submitting = useRef(false);
  const [recovery, setRecovery] = useState(readRecovery);
  const [selectedOffer, setSelectedOffer] = useState<Offer>();
  const [verified, setVerified] = useState(false);
  const name = Form.useWatch("name", form) as string | undefined;
  const geo = Form.useWatch("geo", form) as string | undefined;
  const offerId = Form.useWatch("offer_id", form) as number | undefined;
  const mutation = useMutation({
    mutationKey: ["create-campaign"],
    mutationFn: api.createCampaign,
    retry: false,
    onSuccess: (details) => {
      saveRecovery(null);
      setRecovery(null);
      queryClient.setQueryData(
        campaignKeys.detail(details.campaign.id),
        details,
      );
      void queryClient.invalidateQueries({ queryKey: campaignKeys.lists });
    },
    onError: (error, variables) => {
      if (isUncertainCreation(error)) {
        setRecovery(normalizeName(variables.name));
        saveRecovery(normalizeName(variables.name));
      } else saveRecovery(null);
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const pending = mutation.isPending;
  const blocker = useBlocker(pending);
  useEffect(() => {
    if (blocker.state === "blocked") blocker.reset();
  }, [blocker]);
  useBeforeUnload((event) => {
    if (pending) event.preventDefault();
  });
  const uncertain =
    Boolean(recovery) ||
    (mutation.isError && isUncertainCreation(mutation.error));
  const submit = (values: CreateCampaignRequest) => {
    if (
      submitting.current ||
      pending ||
      (uncertain && !verified) ||
      mutation.isSuccess
    )
      return;
    submitting.current = true;
    setVerified(false);
    setRecovery(null);
    saveRecovery(normalizeName(values.name));
    mutation.mutate({
      name: normalizeName(values.name),
      geo: values.geo,
      offer_id: values.offer_id,
    });
  };
  if (mutation.isSuccess)
    return (
      <div className="stack">
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          title="Кампания создана"
          description={`#${mutation.data.campaign.id} · ${mutation.data.campaign.name}`}
        />
        <CampaignSummary details={mutation.data} selectedOffer={selectedOffer} />
        <Space wrap>
          <Link to="/campaigns">
            <Button type="primary">К списку кампаний</Button>
          </Link>
          <Link to={`/campaigns/${mutation.data.campaign.id}`}>
            <Button>Открыть кампанию</Button>
          </Link>
          <Button
            onClick={() => {
              mutation.reset();
              form.resetFields();
            }}
          >
            Создать ещё одну
          </Button>
        </Space>
      </div>
    );
  return (
    <div className="stack">
      <div>
        <Link
          className="back-link"
          to="/campaigns"
          onClick={(event) => {
            if (pending) event.preventDefault();
          }}
          aria-disabled={pending}
        >
          <ArrowLeftOutlined /> Кампании
        </Link>
        <div className="page-heading">
          <div>
            <h1>Создать кампанию</h1>
            <p className="muted">
              Задайте название, страну и оффер. Остальную настройку выполнит
              Adrobot.
            </p>
          </div>
        </div>
      </div>
      {mutation.isError && <ErrorNotice error={mutation.error} />}
      {uncertain && (
        <Alert
          type="warning"
          showIcon
          role="alert"
          title="Сначала проверьте кампанию в Keitaro"
          description={
            <div className="stack-small">
              <p>
                Результат создания не подтверждён. Кампания{" "}
                {recovery ? `«${recovery}» ` : ""}могла быть создана полностью
                или частично. Проверьте её наличие и потоки в Keitaro перед
                повторной отправкой, чтобы не создать дубликат.
              </p>
              {mutation.error instanceof ApiError &&
                mutation.error.campaignId !== null && (
                  <Link to={`/campaigns/${mutation.error.campaignId}`}>
                    Проверить кампанию #{mutation.error.campaignId}
                  </Link>
                )}
              <Checkbox
                checked={verified}
                onChange={(event) => setVerified(event.target.checked)}
              >
                Я проверил Keitaro: новую кампанию можно создать
              </Checkbox>
            </div>
          }
        />
      )}
      {mutation.error instanceof ApiError &&
        mutation.error.code === "creation_rolled_back" && (
          <Alert
            type="info"
            showIcon
            title="Неполная кампания удалена"
            description="Потоки создать не удалось. Можно повторить отправку после устранения причины ошибки."
          />
        )}
      <div className="creation-grid">
        <Card title="Параметры" size="small">
          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            onFinish={submit}
            disabled={pending}
            scrollToFirstError
          >
            <Form.Item
              name="name"
              label="Название кампании"
              validateTrigger="onBlur"
              rules={[
                {
                  validator: (_, value: string | undefined) => {
                    const error = validateName(value ?? "");
                    return error
                      ? Promise.reject(new Error(error))
                      : Promise.resolve();
                  },
                },
              ]}
              extra={
                <span>
                  Имя в Keitaro:{" "}
                  <span className="mono name-preview">
                    {normalizeName(name ?? "") || "test_panesh_…"}
                  </span>
                </span>
              }
            >
              <Input placeholder="Например, summer_au" autoComplete="off" />
            </Form.Item>
            <Form.Item
              name="geo"
              label="GEO — страна"
              rules={[{ required: true, message: "Выберите страну." }]}
            >
              <Select
                showSearch={{ optionFilterProp: "label" }}
                options={countries}
                placeholder="Найдите страну или код, например AU"
                virtual={false}
              />
            </Form.Item>
            <Form.Item
              name="offer_id"
              label="Оффер Keitaro"
              rules={[
                {
                  required: true,
                  type: "number",
                  min: 1,
                  message: "Выберите оффер из результатов поиска.",
                },
              ]}
            >
              <OfferSelect disabled={pending} onSelectOffer={setSelectedOffer} />
            </Form.Item>
            <div className="form-actions">
              <Button
                type="primary"
                htmlType="submit"
                loading={pending}
                disabled={uncertain && !verified}
              >
                {pending ? "Создание кампании…" : "Создать кампанию"}
              </Button>
              {!pending && <Link to="/campaigns">Отмена</Link>}
            </div>
            {pending && (
              <p className="field-hint pending-hint" role="status">
                Настраиваем кампанию и два потока. Дождитесь результата;
                повторная отправка заблокирована.
              </p>
            )}
          </Form>
        </Card>
        <aside className="stack">
          <Card size="small" title="Как пойдёт трафик">
            <ol className="routing-preview">
              <li>
                <strong>Из страны {geo ?? "GEO"}</strong>
                <p>
                  Переход на <span className="mono">https://google.com</span>
                </p>
              </li>
              <li>
                <strong>Остальной трафик</strong>
                <p>
                  {offerId ? `Оффер #${offerId}` : "Выбранный оффер"} · 100%
                </p>
                <span className="field-hint">Замыкающий поток</span>
              </li>
            </ol>
          </Card>
          <div className="info-note">
            <strong>Настраивается автоматически</strong>
            <p>
              Домен, группа и источник — из настроек сервера. Потоки
              обрабатываются по позиции.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
