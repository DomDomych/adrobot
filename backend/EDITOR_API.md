# Adrobot campaign editor — backend contract

The existing campaign creation and offer search API remains unchanged. The editor
uses the configured Keitaro account, one PostgreSQL database and existing HTTPX
client. Apply migration `0002_editor_state` before opening the editor.

## HTTP endpoints

Base: `/api/v1/campaigns/{campaign_id}/editor`.

| Method | Path relative to base | Body | Result |
| --- | --- | --- | --- |
| GET | empty | none | CampaignEditor |
| POST | `/fetch` | FetchRequest | CampaignEditor |
| POST | `/streams/{stream_id}/actions` | EditorAction | EditorStream |
| POST | `/streams/{stream_id}/cancel` | RevisionRequest | EditorStream |
| POST | `/streams/{stream_id}/publish` | RevisionRequest | EditorStream |

`GET /api/v1/offers?q=...&limit=20` remains the catalog autocomplete endpoint.
See `/docs` or `/openapi.json` for authoritative request/response types.

## Responses

CampaignEditor: `{campaign, streams: EditorStream[]}`.
EditorStream: `{stream, editable, offers, published_offers, dirty, revision,
total_share, validation_error, missing}`. `stream` is the last confirmed remote
stream, with its existing shape (including `schema`). For editable streams,
render `offers` rather than `stream.offers`, which is the published remote
snapshot. Each editor offer is `{offer_id, name, share, active, pinned}`.
`published_offers` contains the confirmed local history including removed rows.
`revision` is an integer for editable streams, null for read-only streams.
`validation_error` is null if publication is mathematically valid. `missing`
marks a retained draft whose stream no longer exists/is editable remotely.
Do not enable actions or publication on missing rows; cancellation is available.

GET initializes new stream snapshots and preserves existing drafts and snapshots.
Fetch explicitly refreshes remote values. Offer-bearing (`landings`) streams
are editable even when empty; redirect streams are read-only and displayed below.

## Draft operations

Send the latest `revision` from the stream response with every mutation. Replace
that stream in frontend state/cache with the returned object, not a speculative
recalculation. Serialize mutations per stream in the UI. Do not automatically
retry mutating requests. Re-fetch editor GET after uncertain local failures.

Examples (replace revision with the latest value):

```json
{"revision": 1, "action": "add", "offer_id": 18002}
{"revision": 2, "action": "remove", "offer_id": 18002}
{"revision": 3, "action": "restore", "offer_id": 18002}
{"revision": 4, "action": "pin", "offer_id": 18002}
{"revision": 5, "action": "unpin", "offer_id": 18002}
{"revision": 6, "action": "share", "offer_id": 18002, "share": 40}
```

Each line is a separate body. Add and restore validate the catalog offer. Removed
rows have share 0 and no pin; restoration re-enters automatic distribution.
Pinned shares are preserved on automatic redistribution. Explicit share editing
may also change a pinned offer's share. Editing does not implicitly pin a row.
Pin preserves current distribution; unpin redistributes. Manual input must be an
integer from 0 to 100; other free offers divide the remainder. Rounding remainder
is allocated by ascending offer ID. Fractional external pins are preserved with
the corresponding fractional precision. Adding/restoring is refused if no
positive allocation is possible. Removing the last active offer is refused.
An explicitly set zero share remains an active association, not a removed row.

`dirty=true` means show yellow draft status, Push and Cancel. Removed rows are
muted and show Bring Back. No external write happens until Publish.

Cancel and Publish both accept `{"revision": 7}`. Cancel restores confirmed
local history, shares and pins; unsaved additions disappear. Publish sends only
active rows to `PUT /streams/{id}`; pins are local metadata. A pin-only update
requires no remote write. The confirmed local state is committed after success.

## Fetch and conflicts

Default fetch body: `{}`. If drafts exist, backend returns 409 `draft_conflict`.
After user confirms discard, send e.g.
`{"discard_drafts": true, "revisions": {"992": 7}}` with the latest revisions
of every dirty stream. Fetch merges published history with remote offers, marks
missing offers removed, preserves pins for still-active rows, and trusts actual
remote shares when those were explicitly changed. If the total is invalid and
possible to normalize, it creates a corrected draft automatically. Fetch never
writes to Keitaro. If pins prevent normalization, the invalid remote state is
shown with validation_error; unpin/edit to make it publishable. If all offers
were removed externally, add a new one before publication.

Publish reads the current Keitaro stream before PUT. If it differs from the
baseline, returns `upstream_conflict` (409), keeping the draft. User may fetch
and explicitly discard or keep the draft while deciding. There is no atomic CAS
in upstream API, so the narrow race between GET and PUT cannot be eliminated.
PostgreSQL transaction advisory locks serialize Adrobot changes across workers;
revision checks reject stale requests from another tab. These are not upstream
locks. A lost PUT response is reconciled on explicit publish retry when remote
already equals the desired configuration, without sending another PUT.

Errors use `{code, detail}` except standard FastAPI validation errors. Key codes:
`no_free_share`, `last_offer`, `duplicate_offer`, `invalid_distribution`,
`offer_not_found`, `inactive_offer`, `revision_conflict`, `draft_conflict`,
`upstream_conflict`, `publication_unknown`, `publication_failed`,
`editor_storage_unavailable`. For uncertain publication, inspect Keitaro or
explicitly retry after checking state; never auto-retry.

## Frontend scope

Reuse existing layout, offer autocomplete, API client and query cache. Add the
editor to campaign details, use clickable percentages (inline editing), pin icon,
Add/Remove/Bring Back, Fetch, View in KT, Push, Cancel. Show a total and compact
error message, preserve removed rows. No fake Stats/Trends. No standalone Edit
Share button, no separate normalization action. Link to the emulator campaign:
`https://keitaro-for-tests.etolegko.com/admin/#!/campaign.editor/{campaign_id}`.
The browser may redirect to `#!/campaign/{id}/main` as observed on the stand.

## Install / verify

From backend: `uv run alembic upgrade head`, `uv run ruff format .`,
`uv run ruff check --fix .`, `uv run python -m pytest -q`,
`uv run uvicorn app.main:app --reload`. No added third-party packages.
Tested locally using mocked Keitaro and in-memory editor repository, OpenAPI and
PostgreSQL offline migration SQL. Live PostgreSQL and Keitaro write integration
must be verified in the project environment. Single-account deployment is
assumed; do not reuse the same local database for a different Keitaro account.
