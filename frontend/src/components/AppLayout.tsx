import { useIsMutating } from "@tanstack/react-query";
import { AppstoreOutlined, PlusOutlined } from "@ant-design/icons";
import { NavLink, Outlet } from "react-router-dom";
export function AppLayout() {
  const pending = useIsMutating({ mutationKey: ["create-campaign"] }) > 0;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        К содержимому
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-symbol">a</span>
          <span>
            adrobot<span className="brand-caption">Управление кампаниями</span>
          </span>
        </div>
        <nav aria-label="Основная навигация">
          <NavLink
            to="/campaigns"
            end
            onClick={(event) => {
              if (pending) event.preventDefault();
            }}
            aria-disabled={pending}
          >
            <AppstoreOutlined /> Кампании
          </NavLink>
          <NavLink
            to="/campaigns/new"
            onClick={(event) => {
              if (pending) event.preventDefault();
            }}
            aria-disabled={pending}
          >
            <PlusOutlined /> Создать кампанию
          </NavLink>
        </nav>
        <div className="sidebar-note">Keitaro workspace</div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>Рабочее пространство</span>
          <span className="topbar-label">Adrobot / Keitaro</span>
        </header>
        <main id="main" className="content">
          <Outlet />
        </main>
        <footer>Adrobot · Управление конфигурацией кампаний</footer>
      </div>
    </div>
  );
}
