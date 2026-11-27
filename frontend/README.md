# Adrobot frontend

React/TypeScript administrative UI for campaign creation and the persistent offer
editor. Setup, deployment and verification are documented in the [root README](../README.md).

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm test
pnpm build
```

Use Node from `../.node-version` and the package manager pinned in `package.json`.
Vite serves port 5173 and proxies `/api` to `127.0.0.1:8000`. Production assets are
served by Nginx. Never place a Keitaro API key in frontend files or `VITE_*` variables.

Routes:

- `/campaigns`: pages of 20 records with a 21st lookahead row; no fictitious total.
- `/campaigns/new`: normalized name, ISO country, active offer autocomplete and
  recovery protection for uncertain creation outcomes.
- `/campaigns/:id`: draft editor; inline percentages, pins, restore, explicit Fetch,
  Push and Cancel. The backend owns allocation math and revisions.

Routes load lazily. Mutations never retry automatically. UI operations are guarded
against duplicate clicks and stale query responses; uncertain operations trigger
GET recovery while retaining the displayed draft. Offer queries debounce 350 ms
and use abort signals. Reference queries are shared/cached, not per-row requests.

The [backend contract](../backend/EDITOR_API.md) explains draft, publication,
revision conflicts and upstream limitations. Browser tests use mocked fetch;
they are not live Keitaro E2E verification.
