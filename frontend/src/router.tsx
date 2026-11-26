import { createBrowserRouter, Link, Navigate } from "react-router-dom";
import { Button, Result } from "antd";
import { AppLayout } from "./components/AppLayout";
import { CampaignsPage } from "./pages/CampaignsPage";
import { CreateCampaignPage } from "./pages/CreateCampaignPage";
import { CampaignPage } from "./pages/CampaignPage";
export const routes = [
  {
    element: <AppLayout />,
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
      { path: "campaigns", element: <CampaignsPage /> },
      { path: "campaigns/new", element: <CreateCampaignPage /> },
      { path: "campaigns/:campaignId", element: <CampaignPage /> },
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
