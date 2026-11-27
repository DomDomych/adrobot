# Local browser verification

`keitaro_stub.py` is an in-memory HTTP test double with synthetic catalog data.
It never forwards requests to an external tracker. It implements only the
creation/editor endpoints needed for browser regression; allocation math remains
in the actual application backend. Do not deploy it as a production service.

From the repository root, with an unused UI port:

```bash
POSTGRES_PASSWORD=test_only KEITARO_API_KEY=unused-test-placeholder APP_PORT=18080 \
  docker compose -p adrobot-e2e -f compose.yaml -f compose.test.yaml up --build -d --wait
```

Open `http://127.0.0.1:18080`, create a synthetic campaign and follow the editor
workflow in `docs/OPERATIONS.md`. The tracker admin link intentionally targets
`example.test`; it is only useful for checking URL construction. The stub catalog
contains Alpha/Beta/Gamma offers. It is reachable only inside the Docker network.
`GET /_test/requests` on the stub records methods, paths and bodies (no headers)
for verifying that pin-only Push and draft actions do not send PUT.

Stop and remove **only this disposable stack** when finished:

```bash
POSTGRES_PASSWORD=test_only KEITARO_API_KEY=unused-test-placeholder APP_PORT=18080 \
  docker compose -p adrobot-e2e -f compose.yaml -f compose.test.yaml down --volumes
```

The stub loses its data on restart; the app database persists until the explicit
test teardown. Start a fresh test project/volume for a new independent run. Never
attach a real editor database to the stub.

The repository screenshots were captured from this application using synthetic
fixture data. They do not contain company screenshots or production credentials.
