import asyncio
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest
from pydantic import TypeAdapter, ValidationError

from app.core.errors import EditorError
from app.db.operations import OperationJournal
from app.integrations.keitaro.client import KeitaroClient
from app.integrations.keitaro.exceptions import KeitaroTimeout
from app.integrations.keitaro.schemas import Campaign, Offer, Stream, StreamOffer
from app.schemas.editor import EditorAction, EditorOffer, FetchRequest
from app.services.editor import EditorService
from app.services.shares import rebalance


def offer(offer_id: int, share: float, pinned: bool = False) -> EditorOffer:
    return EditorOffer(
        offer_id=offer_id, name=f"Offer {offer_id}", share=share, pinned=pinned
    )


def test_rounding_and_pins() -> None:
    items = [offer(3, 25, True), offer(2, 25), offer(1, 25)]
    assert {o.offer_id: o.share for o in rebalance(items)} == {3: 25, 2: 37, 1: 38}
    items = [offer(1, 25, True), offer(2, 45), offer(3, 25), offer(4, 25)]
    assert [o.share for o in rebalance(items, edited_id=2)] == [25, 45, 15, 15]
    fractional = [offer(1, 25.5, True), offer(2, 0), offer(3, 0)]
    assert [o.share for o in rebalance(fractional)] == [25.5, 37.3, 37.2]


@pytest.mark.parametrize("value", [-1, 101, 1.5, "10", True])
def test_invalid_share(value: object) -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(EditorAction).validate_python(
            {"action": "share", "offer_id": 1, "revision": 1, "share": value}
        )


class MemoryRepository:
    def __init__(self) -> None:
        self.states = []

    @asynccontextmanager
    async def locked(self, campaign_id: int):
        yield self

    async def list(self, campaign_id: int):
        return [s for s in self.states if s.campaign_id == campaign_id]

    def add(self, state) -> None:
        self.states.append(state)


def make_stream(*shares: tuple[int, float]) -> Stream:
    return Stream(
        id=12,
        name="Offers",
        campaign_id=5,
        type="default",
        schema="landings",
        offers=[StreamOffer(offer_id=i, share=s) for i, s in shares],
    )


class Fixture:
    def __init__(self) -> None:
        self.remote = make_stream((1, 100))
        self.client = AsyncMock(spec=KeitaroClient)
        self.client.get_campaign.return_value = Campaign(id=5, name="test_panesh_demo")
        self.client.get_stream.side_effect = self.read_stream
        self.client.list_streams.side_effect = self.read_streams
        self.client.list_offers.return_value = [self.catalog(i) for i in range(1, 5)]
        self.client.get_offer.side_effect = self.catalog
        self.client.replace_stream_offers.side_effect = self.write
        self.journal = AsyncMock(spec=OperationJournal)
        self.journal.start.return_value = 1
        self.repository = MemoryRepository()
        self.service = EditorService(self.client, self.repository, self.journal)

    def catalog(self, i: int) -> Offer:
        return Offer(
            id=i,
            name=f"Offer {i}",
            country=["CL"],
            state="active",
            payout_value=30,
            payout_currency="USD",
        )

    async def read_stream(self, stream_id: int) -> Stream:
        return self.remote

    async def read_streams(self, campaign_id: int) -> list[Stream]:
        geo = Stream(
            id=11, name="Geo", campaign_id=5, type="regular", schema="redirect"
        )
        return [geo, self.remote]

    async def write(self, stream_id: int, offers: list[StreamOffer]) -> Stream:
        self.remote = self.remote.model_copy(update={"offers": offers})
        return self.remote

    async def get(self):
        return (await self.service.get(5)).streams[0]

    async def change(self, state, action: str, offer_id: int, **kwargs):
        data = TypeAdapter(EditorAction).validate_python(
            dict(revision=state.revision, action=action, offer_id=offer_id, **kwargs)
        )
        return await self.service.change(5, 12, data)


def test_draft_publish_remove_restore_cancel() -> None:
    async def run():
        f = Fixture()
        state = await f.get()
        assert state.stream.id == 12 and not state.dirty
        state = await f.change(state, "add", 2)
        assert state.dirty and [o.share for o in state.offers] == [50, 50]
        assert (await f.get()).offers == state.offers
        assert f.client.replace_stream_offers.await_count == 0
        with pytest.raises(EditorError, match="discard"):
            await f.service.fetch(5, FetchRequest())
        state = await f.service.publish(5, 12, state.revision)
        assert not state.dirty and len(f.remote.offers) == 2
        state = await f.change(state, "remove", 2)
        assert [o.share for o in state.offers] == [100, 0]
        state = await f.service.publish(5, 12, state.revision)
        assert len(f.remote.offers) == 1 and not state.offers[1].active
        state = await f.change(state, "restore", 2)
        assert [o.share for o in state.offers] == [50, 50]
        state = await f.service.cancel(5, 12, state.revision)
        assert not state.dirty and not state.offers[1].active
        state = await f.change(state, "add", 3)
        state = await f.service.cancel(5, 12, state.revision)
        assert [o.offer_id for o in state.offers] == [1, 2]

    asyncio.run(run())


def test_conflicts_and_external_normalization() -> None:
    async def run():
        f = Fixture()
        f.remote = make_stream((1, 25), (2, 25), (3, 25), (4, 25))
        state = await f.get()
        state = await f.change(state, "pin", 1)
        state = await f.service.publish(5, 12, state.revision)
        f.remote = make_stream((1, 25), (2, 25))
        result = await f.service.fetch(5, FetchRequest())
        state = result.streams[0]
        assert state.dirty and [o.share for o in state.offers] == [25, 75, 0, 0]
        assert f.remote.offers[1].share == 25
        old = state
        state = await f.change(state, "restore", 3)
        with pytest.raises(EditorError) as error:
            await f.change(old, "restore", 4)
        assert error.value.code == "revision_conflict"
        f.remote = make_stream((1, 40), (2, 60))
        with pytest.raises(EditorError) as error:
            await f.service.publish(5, 12, state.revision)
        assert error.value.code == "upstream_conflict"
        assert (await f.get()).dirty
        with pytest.raises(EditorError):
            await f.service.fetch(5, FetchRequest(discard_drafts=True))
        request = FetchRequest(discard_drafts=True, revisions={12: state.revision})
        state = (await f.service.fetch(5, request)).streams[0]
        assert not state.dirty and [o.share for o in state.offers] == [40, 60, 0, 0]

    asyncio.run(run())


def test_no_free_share_and_last_offer() -> None:
    async def run():
        f = Fixture()
        state = await f.get()
        with pytest.raises(EditorError) as error:
            await f.change(state, "remove", 1)
        assert error.value.code == "last_offer"
        state = await f.change(state, "pin", 1)
        with pytest.raises(EditorError) as error:
            await f.change(state, "add", 2)
        assert error.value.code == "no_free_share"
        assert (await f.get()).revision == state.revision
        state = await f.change(state, "unpin", 1)
        state = await f.change(state, "add", 2)
        state = await f.change(state, "share", 1, share=70)
        assert [o.share for o in state.offers] == [70, 30]
        state = await f.change(state, "pin", 1)
        with pytest.raises(EditorError):
            await f.change(state, "share", 2, share=40)
        assert (await f.get()).offers == state.offers

    asyncio.run(run())


def test_lost_publish_response_reconciles_without_second_write() -> None:
    async def run():
        f = Fixture()
        state = await f.get()
        state = await f.change(state, "add", 2)

        async def lose_response(stream_id, offers):
            await f.write(stream_id, offers)
            raise KeitaroTimeout("timeout")

        f.client.replace_stream_offers.side_effect = lose_response
        with pytest.raises(EditorError) as error:
            await f.service.publish(5, 12, state.revision)
        assert error.value.code == "publication_unknown"
        assert (await f.get()).dirty
        state = await f.service.publish(5, 12, state.revision)
        assert not state.dirty and f.client.replace_stream_offers.await_count == 1

    asyncio.run(run())
