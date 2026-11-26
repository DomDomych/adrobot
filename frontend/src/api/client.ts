import type {
  Campaign,
  CampaignDetails,
  CreateCampaignRequest,
  Offer,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly campaignId: number | null;
  constructor(
    message: string,
    status = 0,
    code = "network_error",
    campaignId: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.campaignId = campaignId;
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
export function parseApiError(body: unknown, status: number): ApiError {
  let message = `Сервер вернул ошибку HTTP ${status}.`;
  if (isRecord(body)) {
    if (typeof body.detail === "string") message = body.detail;
    else if (Array.isArray(body.detail)) {
      const messages = body.detail
        .filter(isRecord)
        .map((item) => {
          const field = Array.isArray(item.loc)
            ? item.loc.filter((part) => part !== "body").join(".")
            : "";
          return typeof item.msg === "string"
            ? `${field ? `${field}: ` : ""}${item.msg}`
            : "";
        })
        .filter(Boolean);
      if (messages.length) message = messages.join("; ");
    }
    return new ApiError(
      message,
      status,
      typeof body.code === "string" ? body.code : "http_error",
      typeof body.campaign_id === "number" ? body.campaign_id : null,
    );
  }
  return new ApiError(message, status, "http_error");
}
// An interrupted POST may already have committed on the server. Never retry automatically.
export function isUncertainCreation(error: Error): boolean {
  if (!(error instanceof ApiError)) return true;
  if (
    [
      "creation_unknown",
      "cleanup_failed",
      "network_error",
      "invalid_response",
    ].includes(error.code)
  )
    return true;
  return (
    error.status >= 500 &&
    ![
      "creation_rolled_back",
      "inactive_offer",
      "journal_unavailable",
      "keitaro_error",
      "keitaro_timeout",
      "keitaro_unavailable",
    ].includes(error.code)
  );
}
const baseUrl = (import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(
  /\/$/,
  "",
);
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  // Creation can perform several sequential upstream requests and compensation.
  const timeout = window.setTimeout(
    () => controller.abort(),
    options.method === "POST" ? 120_000 : 30_000,
  );
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw parseApiError(body, response.status);
    if (body === null)
      throw new ApiError(
        "Сервер вернул некорректный ответ.",
        response.status,
        "invalid_response",
      );
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      controller.signal.aborted
        ? "Ожидание ответа прервано. Проверьте соединение и доступность сервера."
        : "Не удалось связаться с сервером. Проверьте соединение.",
    );
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}
export const api = {
  campaigns: (offset: number, limit: number, signal?: AbortSignal) =>
    request<Campaign[]>(
      `/campaigns?${new URLSearchParams({ offset: String(offset), limit: String(limit) })}`,
      { signal },
    ),
  campaign: (id: number, signal?: AbortSignal) =>
    request<CampaignDetails>(`/campaigns/${id}`, { signal }),
  offers: (q: string, signal?: AbortSignal) =>
    request<Offer[]>(`/offers?${new URLSearchParams({ q, limit: "20" })}`, {
      signal,
    }),
  createCampaign: async (
    data: CreateCampaignRequest,
  ): Promise<CampaignDetails> => {
    const result = await request<CampaignDetails>("/campaigns", {
      method: "POST",
      body: JSON.stringify(data),
    });
    // Keep recovery protection until the server has returned an identifiable result.
    if (
      !isRecord(result) ||
      !isRecord(result.campaign) ||
      typeof result.campaign.id !== "number" ||
      typeof result.campaign.name !== "string" ||
      !Array.isArray(result.streams)
    ) {
      throw new ApiError(
        "Сервер не подтвердил параметры созданной кампании.",
        201,
        "invalid_response",
      );
    }
    return result;
  },
};
