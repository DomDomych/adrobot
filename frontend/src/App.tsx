import { App as AntApp, ConfigProvider } from "antd";
import ruRU from "antd/locale/ru_RU";
import { RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./api/queries";
import { router } from "./router";
import "./App.css";

export default function App() {
  return (
    <ConfigProvider
      locale={ruRU}
      theme={{
        token: {
          colorPrimary: "#2563eb",
          borderRadius: 6,
          fontSize: 14,
          fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif",
        },
      }}
    >
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}
