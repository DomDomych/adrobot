import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { ConfigProvider } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../router";
import { campaignKeys } from "../api/queries";
import type { Campaign, CampaignDetails } from "../api/types";
import {
  api,
  ApiError,
  isUncertainCreation,
  parseApiError,
} from "../api/client";
import { normalizeName, validateName } from "../lib/countries";

const campaign = (id: number): Campaign => ({
  id,
  name: `test_panesh_campaign_${id}`,
  alias: `alias-${id}`,
  domain_id: 1813,
  group_id: 10332,
  traffic_source_id: 836,
  state: "active",
});
const details: CampaignDetails = {
  campaign: campaign(500),
  streams: [
    {
      id: 885,
      name: "Geo AU",
      campaign_id: 500,
      type: "regular",
      schema: "redirect",
      position: 1,
      action_type: "http",
      action_payload: "https://google.com",
      filters: [{ name: "country", mode: "accept", payload: ["AU"] }],
      offers: [],
    },
    {
      id: 886,
      name: "Offers",
      campaign_id: 500,
      type: "default",
      schema: "landings",
      position: 2,
      action_type: "http",
      action_payload: null,
      filters: [],
      offers: [{ offer_id: 18001, share: 100, state: "active" }],
    },
  ],
};
const offer = {
  id: 18001,
  name: "Detoxin test offer",
  country: ["CL"],
  state: "active",
  payout_value: 30,
  payout_currency: "USD",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.includes("/offers?")) return json([offer]);
    if (url.includes("/campaigns?")) return json([]);
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
function mount(path = "/campaigns") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ConfigProvider>,
  );
  return { client, router, ...view };
}
async function fillForm() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Название кампании"), "  summer  ");
  const geo = screen.getByLabelText("GEO — страна");
  await user.click(geo);
  await user.type(geo, "AU");
  await user.click(await screen.findByText("Австралия · AU"));
  const select = screen.getByRole("combobox", { name: "Оффер" });
  await user.click(select);
  await user.type(select, "18001");
  await user.click(await screen.findByText("#18001 · Detoxin test offer"));
  return user;
}
const posts = () =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

describe("campaign list", () => {
  it("uses one lookahead record without a fictitious total or detail requests", async () => {
    fetchMock.mockImplementation(async (input) => {
      const offset = new URL(String(input), "http://local").searchParams.get(
        "offset",
      );
      return json(
        offset === "0"
          ? Array.from({ length: 21 }, (_, i) => campaign(i + 1))
          : [campaign(21)],
      );
    });
    mount();
    await screen.findByText("test_panesh_campaign_1");
    expect(
      screen.queryByText("test_panesh_campaign_21"),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Далее" }));
    await screen.findByText("test_panesh_campaign_21");
    expect(screen.getByRole("button", { name: "Далее" })).toBeDisabled();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/campaigns?offset=0&limit=21",
      "/api/v1/campaigns?offset=20&limit=21",
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Назад" }));
    await screen.findByText("test_panesh_campaign_1");
  });
  it("shows loading, error, retry and empty states", async () => {
    let respond!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    mount();
    expect(screen.getByText("Загрузка кампаний…")).toBeInTheDocument();
    await act(async () =>
      respond(
        json(
          { code: "keitaro_unavailable", detail: "Keitaro is unavailable" },
          503,
        ),
      ),
    );
    await screen.findByText("Keitaro is unavailable");
    await userEvent.click(
      screen.getByRole("button", { name: "Повторить загрузку" }),
    );
    await screen.findByText("Кампаний пока нет");
  });
  it("opens details only on explicit navigation", async () => {
    fetchMock.mockImplementation(async (input) =>
      json(String(input).includes("/campaigns?") ? [campaign(500)] : details),
    );
    mount();
    await userEvent.click(await screen.findByText("test_panesh_campaign_500"));
    await screen.findByText("1. Geo AU");
    expect(screen.getByText("https://google.com")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});

describe("creation", () => {
  it("validates required fields without sending POST", async () => {
    mount("/campaigns/new");
    await userEvent.click(
      screen.getByRole("button", { name: "Создать кампанию" }),
    );
    await screen.findByText("Введите название кампании.");
    expect(screen.getByText("Выберите страну.")).toBeInTheDocument();
    expect(
      screen.getByText("Выберите оффер из результатов поиска."),
    ).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });
  it("debounces offer searches, sends numeric ID once, displays result and invalidates lists", async () => {
    let respond!: (value: Response) => void;
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) =>
      init?.method === "POST"
        ? new Promise((resolve) => {
            respond = resolve;
          })
        : original(input, init),
    );
    const { client } = mount("/campaigns/new");
    client.setQueryData([...campaignKeys.lists, 1], []);
    const user = await fillForm();
    expect(
      fetchMock.mock.calls
        .filter(([url]) => String(url).includes("/offers?"))
        .map(([url]) => String(url)),
    ).toEqual([
      "/api/v1/offers?q=&limit=20",
      "/api/v1/offers?q=18001&limit=20",
    ]);
    const button = screen.getByRole("button", { name: "Создать кампанию" });
    await user.dblClick(button);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({
      name: "test_panesh_summer",
      geo: "AU",
      offer_id: 18001,
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "повторная отправка заблокирована",
    );
    await act(async () => respond(json(details, 201)));
    await screen.findByText("Кампания создана");
    expect(
      client.getQueryState([...campaignKeys.lists, 1])?.isInvalidated,
    ).toBe(true);
    expect(client.getQueryData(campaignKeys.detail(500))).toEqual(details);
    expect(sessionStorage.getItem("adrobot:unconfirmed-creation")).toBeNull();
    await user.click(screen.getByRole("button", { name: "К списку кампаний" }));
    await screen.findByText("Кампаний пока нет");
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/campaigns?")),
    ).toBe(true);
  });
  it.each([
    "creation_unknown",
    "cleanup_failed",
    "network_error",
    "invalid_response",
  ])("requires verification after %s and never retries POST", async (code) => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method !== "POST") return original(input, init);
      if (code === "network_error") throw new TypeError("Failed to fetch");
      if (code === "invalid_response") return json({ ok: true }, 201);
      return json({ code, detail: "Check Keitaro", campaign_id: 500 }, 502);
    });
    mount("/campaigns/new");
    const user = await fillForm();
    await user.click(screen.getByRole("button", { name: "Создать кампанию" }));
    await screen.findByText("Сначала проверьте кампанию в Keitaro");
    expect(
      screen.getByRole("button", { name: "Создать кампанию" }),
    ).toBeDisabled();
    expect(posts()).toHaveLength(1);
    expect(sessionStorage.getItem("adrobot:unconfirmed-creation")).toBe(
      "test_panesh_summer",
    );
    await user.click(screen.getByRole("checkbox"));
    expect(
      screen.getByRole("button", { name: "Создать кампанию" }),
    ).toBeEnabled();
  });
  it("preserves uncertain-operation warning after remount", async () => {
    sessionStorage.setItem("adrobot:unconfirmed-creation", "test_panesh_lost");
    mount("/campaigns/new");
    expect(screen.getByText(/test_panesh_lost/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Создать кампанию" }),
    ).toBeDisabled();
    expect(posts()).toHaveLength(0);
  });
  it("shows offer search failure and retries without losing form input", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ detail: "Offer search unavailable" }, 503),
    );
    mount("/campaigns/new");
    await screen.findByText("Offer search unavailable");
    fireEvent.change(screen.getByLabelText("Название кампании"), {
      target: { value: "draft" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Повторить загрузку" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Offer search unavailable"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Название кампании")).toHaveValue("draft");
  });
  it("does not submit free-form offer text", async () => {
    mount("/campaigns/new");
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("combobox", { name: "Оффер" }),
      "some offer",
    );
    await user.click(screen.getByRole("button", { name: "Создать кампанию" }));
    await screen.findByText("Выберите оффер из результатов поиска.");
    expect(posts()).toHaveLength(0);
  });
});

describe("API contracts", () => {
  it("parses string and FastAPI array detail, handles non-JSON error", async () => {
    expect(parseApiError({ detail: "Invalid offer" }, 422).message).toBe(
      "Invalid offer",
    );
    expect(
      parseApiError(
        {
          detail: [
            { loc: ["body", "name"], msg: "Too long" },
            { loc: ["body", "geo"], msg: "Invalid" },
          ],
        },
        422,
      ).message,
    ).toBe("name: Too long; geo: Invalid");
    fetchMock.mockResolvedValueOnce(
      new Response("<html>Bad gateway</html>", { status: 502 }),
    );
    await expect(
      api.createCampaign({ name: "x", geo: "AU", offer_id: 1 }),
    ).rejects.toMatchObject({ status: 502, code: "http_error" });
    expect(
      isUncertainCreation(new ApiError("Proxy failure", 502, "http_error")),
    ).toBe(true);
    expect(
      isUncertainCreation(
        new ApiError("Rollback", 502, "creation_rolled_back"),
      ),
    ).toBe(false);
  });
  it("validates normalized name length including prefix and Unicode code points", () => {
    expect(normalizeName(" hello ")).toBe("test_panesh_hello");
    expect(normalizeName("test_panesh_hello")).toBe("test_panesh_hello");
    expect(validateName("  ")).not.toBeNull();
    expect(validateName("test_panesh_")).not.toBeNull();
    expect(validateName("a".repeat(243))).toBeNull();
    expect(validateName("a".repeat(244))).not.toBeNull();
    expect(validateName("😀".repeat(243))).toBeNull();
  });
});
