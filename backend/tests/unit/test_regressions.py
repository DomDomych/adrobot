import re
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest
from pydantic import ValidationError
from test_editor import Fixture, make_stream

from app.api.dependencies import get_campaign_service, get_keitaro
from app.core.config import Settings
from app.core.countries import ISO_COUNTRIES
from app.core.errors import EditorError
from app.integrations.keitaro.exceptions import KeitaroError
from app.integrations.keitaro.schemas import Stream, StreamOffer
from app.main import app
from app.schemas.campaigns import CreateCampaignRequest
from app.schemas.editor import FetchRequest


@pytest.mark.parametrize("geo", ["AU", "au", " au ", "DE", "AX"])
def test_iso_normalization(geo):
    assert (
        CreateCampaignRequest(name=" demo ", geo=geo, offer_id=1).geo
        == geo.strip().upper()
    )


@pytest.mark.parametrize("geo", ["ZZ", "UK", "", "USA", None, 23, True])
async def test_invalid_geo_never_calls_service(geo):
    service = AsyncMock()
    app.dependency_overrides[get_campaign_service] = lambda: service
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/v1/campaigns", json={"name": "demo", "geo": geo, "offer_id": 1}
            )
        assert response.status_code == 422
        service.create_campaign.assert_not_called()
    finally:
        app.dependency_overrides.clear()


def test_iso_list_matches_ui():
    source = (Path(__file__).parents[3] / "frontend/src/lib/countries.ts").read_text()
    assert set(re.search(r"`([A-Z ]+)`", source)[1].split()) == ISO_COUNTRIES
    assert len(ISO_COUNTRIES) == 249


@pytest.mark.parametrize("name", ["", "  ", "test_panesh_", "x" * 244])
def test_invalid_names(name):
    with pytest.raises(ValidationError):
        CreateCampaignRequest(name=name, geo="AU", offer_id=1)


def test_name_boundary_and_prefix():
    data = CreateCampaignRequest(name="x" * 243, geo="AU", offer_id=1)
    assert len(data.name) == 255
    assert CreateCampaignRequest(name=data.name, geo="AU", offer_id=1).name == data.name


@pytest.mark.parametrize("share", [float("nan"), float("inf"), -1, 101])
def test_invalid_remote_share(share):
    with pytest.raises(ValidationError):
        StreamOffer(offer_id=1, share=share)


async def test_pin_only_publish_cancel_and_edit_pinned_share():
    f = Fixture()
    f.remote = make_stream((1, 40), (2, 60))
    state = await f.get()
    state = await f.change(state, "pin", 1)
    state = await f.service.cancel(5, 12, state.revision)
    assert not state.offers[0].pinned and not state.dirty
    state = await f.change(state, "pin", 1)
    state = await f.service.publish(5, 12, state.revision)
    f.client.replace_stream_offers.assert_not_awaited()
    assert (await f.get()).published_offers[0].pinned
    state = await f.change(state, "share", 1, share=70)
    assert [o.share for o in state.offers] == [70, 30]
    assert state.offers[0].pinned
    state = await f.service.cancel(5, 12, state.revision)
    assert [o.share for o in state.offers] == [40, 60]
    assert state.offers[0].pinned


@pytest.mark.parametrize("operation", ["cancel", "publish", "fetch"])
async def test_stale_revision_preserves_draft(operation):
    f = Fixture()
    old = await f.get()
    state = await f.change(old, "add", 2)
    with pytest.raises(EditorError) as error:
        if operation == "fetch":
            await f.service.fetch(
                5, FetchRequest(discard_drafts=True, revisions={12: old.revision})
            )
        else:
            await getattr(f.service, operation)(5, 12, old.revision)
    assert error.value.status == 409
    assert (await f.get()).offers == state.offers


@pytest.mark.parametrize("change", ["deleted", "schema", "campaign", "id"])
async def test_direct_actions_reject_unavailable_stream(change):
    f = Fixture()
    state = await f.get()
    if change == "deleted":
        f.client.get_stream.side_effect = KeitaroError("missing", upstream_status=404)
    else:
        attr, value = {
            "schema": ("schema_type", "redirect"),
            "campaign": ("campaign_id", 7),
            "id": ("id", 13),
        }[change]
        f.remote = f.remote.model_copy(update={attr: value})
    with pytest.raises(EditorError):
        await f.change(state, "pin", 1)
    assert f.repository.states[0].draft is None
    assert f.repository.states[0].revision == state.revision


async def test_schema_changed_draft_has_no_duplicate_row_and_can_cancel():
    f = Fixture()
    state = await f.change(await f.get(), "add", 2)
    f.remote = f.remote.model_copy(update={"schema_type": "redirect"})
    result = await f.service.get(5)
    rows = [s for s in result.streams if s.stream.id == 12]
    assert len(rows) == 1 and rows[0].missing
    await f.service.cancel(5, 12, state.revision)
    rows = [s for s in (await f.service.get(5)).streams if s.stream.id == 12]
    assert len(rows) == 1 and not rows[0].editable and not rows[0].dirty


@pytest.mark.parametrize(
    "field,value",
    [
        ("filters", [{"name": "country", "mode": "accept", "payload": ["DE"]}]),
        ("weight", 20),
        ("schema", "redirect"),
    ],
)
async def test_routing_conflict_even_when_offers_match_desired(field, value):
    f = Fixture()
    state = await f.change(await f.get(), "add", 2)
    remote = f.remote.model_dump(by_alias=True)
    remote["offers"] = [{"offer_id": 1, "share": 50}, {"offer_id": 2, "share": 50}]
    remote[field] = value
    f.remote = Stream.model_validate(remote)
    with pytest.raises(EditorError) as error:
        await f.service.publish(5, 12, state.revision)
    assert error.value.code == "upstream_conflict"
    assert f.repository.states[0].draft is not None
    f.client.replace_stream_offers.assert_not_awaited()


@pytest.mark.parametrize(
    "field,value",
    [("id", 999), ("campaign_id", 999), ("schema_type", "redirect"), ("offers", [])],
)
async def test_bad_put_response_preserves_draft(field, value):
    f = Fixture()
    state = await f.change(await f.get(), "add", 2)

    async def write(stream_id, offers):
        return (await f.write(stream_id, offers)).model_copy(update={field: value})

    f.client.replace_stream_offers.side_effect = write
    with pytest.raises(EditorError) as error:
        await f.service.publish(5, 12, state.revision)
    assert error.value.code == "publication_unknown"
    assert f.repository.states[0].draft is not None
    assert f.journal.finish.await_args.args[1] == "unknown"


async def test_empty_remote_add_zero_active_and_impossible_pins():
    f = Fixture()
    f.remote = make_stream()
    state = await f.get()
    assert state.editable and state.validation_error
    state = await f.change(state, "add", 1)
    assert state.total_share == 100
    state = await f.change(state, "add", 2)
    state = await f.change(state, "share", 1, share=0)
    assert state.offers[0].active and state.offers[0].share == 0
    state = await f.change(state, "pin", 1)
    state = await f.change(state, "pin", 2)
    await f.service.publish(5, 12, state.revision)
    f.remote = make_stream((1, 20), (2, 90))
    state = (await f.service.fetch(5, FetchRequest())).streams[0]
    assert state.validation_error and not state.dirty
    state = await f.change(state, "unpin", 2)
    assert state.total_share == 100 and state.dirty


async def test_duplicate_remote_offers_rejected():
    f = Fixture()
    f.remote = make_stream((1, 50), (1, 50))
    with pytest.raises(EditorError, match="Invalid offer"):
        await f.get()


async def test_references_partial_failure_falls_back_without_secrets():
    from app.integrations.keitaro.schemas import Reference

    client = AsyncMock()
    client.list_domains.return_value = [Reference(id=1, name="example.test")]
    client.list_groups.side_effect = KeitaroError("Unavailable")
    client.list_traffic_sources.return_value = []
    app.state.settings = Settings(
        database_url="postgresql+asyncpg://unused",
        keitaro_api_key="secret-never-public",
        _env_file=None,
    )
    app.dependency_overrides[get_keitaro] = lambda: client
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://test"
        ) as http:
            response = await http.get("/api/v1/references")
        assert response.status_code == 200
        assert response.json()["unavailable"] == ["groups"]
        assert response.json()["domains"][0]["name"] == "example.test"
        assert "secret-never-public" not in response.text
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize("resource", ["offers", "campaigns"])
async def test_client_rejects_wrong_entity_identity(resource):
    from app.integrations.keitaro.client import KeitaroClient
    from app.integrations.keitaro.exceptions import KeitaroContractError

    body = dict(
        id=2,
        name="Wrong entity",
        country=[],
        state="active",
        payout_value=0,
        payout_currency="USD",
    )
    async with httpx.AsyncClient(
        base_url="https://example.test/",
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=body)),
    ) as http:
        client = KeitaroClient(http)
        with pytest.raises(KeitaroContractError):
            await (
                client.get_offer(1) if resource == "offers" else client.get_campaign(1)
            )


async def test_client_rejects_wrong_created_stream_campaign():
    from app.integrations.keitaro.client import KeitaroClient
    from app.integrations.keitaro.exceptions import KeitaroContractError
    from app.integrations.keitaro.schemas import StreamCreate

    async with httpx.AsyncClient(
        base_url="https://example.test/",
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                201, json=make_stream((1, 100)).model_dump(by_alias=True)
            )
        ),
    ) as http:
        with pytest.raises(KeitaroContractError):
            await KeitaroClient(http).create_stream(
                StreamCreate(
                    campaign_id=99, name="Offers", type="default", schema="landings"
                )
            )


async def test_connection_refused_readiness_and_journal_are_safe():
    from contextlib import asynccontextmanager
    from types import SimpleNamespace

    from app.core.errors import JournalUnavailable
    from app.db.editor import EditorRepository
    from app.db.operations import OperationJournal, OperationStatus

    @asynccontextmanager
    async def disconnected():
        raise ConnectionRefusedError("connection unavailable")
        yield  # establishes the async context manager protocol

    sessions = SimpleNamespace(begin=disconnected)
    journal = OperationJournal(sessions)
    with pytest.raises(JournalUnavailable):
        await journal.start("create", "test")
    # A successful remote write must not become an unclassified retryable failure.
    await journal.finish(1, OperationStatus.SUCCESS, 1, "test")
    with pytest.raises(EditorError) as error:
        async with EditorRepository(sessions).locked(1):
            pytest.fail("Disconnected repository unexpectedly entered")
    assert error.value.code == "editor_storage_unavailable"
    app.state.database = SimpleNamespace(engine=SimpleNamespace(connect=disconnected))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test"
    ) as client:
        assert (await client.get("/api/v1/health")).status_code == 200
        response = await client.get("/api/v1/ready")
        assert response.status_code == 503
        assert response.json() == {"status": "unavailable"}
