import { createBrowserRouter, Link, Navigate } from "react-router-dom";
import { Button, Result } from "antd";
import { AppLayout } from "./components/AppLayout";
export const routes = [
  {
    element: <AppLayout />,
    hydrateFallbackElement: <p role="status">Загрузка страницы…</p>,
    errorElement: (
      <Result
        status="error"
        title="Не удалось открыть страницу"
        subTitle="Обновите страницу. Если ошибка повторяется, проверьте доступность API."
        extra={<Button href="/campaigns">К кампаниям</Button>}
      />
    ),
    children: [
      { index: true, element: <Navigate to="/campaigns" replace /> },
      { path: "campaigns", lazy: async () => ({ Component: (await import("./pages/CampaignsPage")).CampaignsPage }) },
      { path: "campaigns/new", lazy: async () => ({ Component: (await import("./pages/CreateCampaignPage")).CreateCampaignPage }) },
      { path: "campaigns/:campaignId", lazy: async () => ({ Component: (await import("./pages/CampaignPage")).CampaignPage }) },
      {
        path: "*",
        element: (
          <Result
            status="404"
            title="Страница не найдена"
            extra={<Link to="/campaigns">К кампаниям</Link>}
          />
        ),
      },
    ],
  },
];
export const router = createBrowserRouter(routes);
