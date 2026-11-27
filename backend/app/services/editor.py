from app.core.errors import EditorError
from app.db.editor import EditorRepository, EditorTransaction
from app.db.models import StreamEditorState
from app.db.operations import OperationJournal, OperationStatus
from app.integrations.keitaro.client import KeitaroClient
from app.integrations.keitaro.exceptions import KeitaroError
from app.integrations.keitaro.schemas import Offer, Stream, StreamOffer
from app.schemas.editor import (
    CampaignEditor,
    EditorAction,
    EditorOffer,
    EditorStream,
    FetchRequest,
)
from app.services.shares import rebalance, total_share, validation_error


def dump(offers: list[EditorOffer]) -> list[dict[str, object]]:
    return [offer.model_dump(mode="json") for offer in offers]


def load(data: list[dict[str, object]]) -> list[EditorOffer]:
    return [EditorOffer.model_validate(item) for item in data]


def signature(stream: Stream) -> dict[str, object]:
    data = stream.model_dump(mode="json", by_alias=True)
    data["offers"] = [
        o.model_dump(mode="json")
        for o in sorted(stream.offers, key=lambda o: o.offer_id)
    ]
    return data


def editable(stream: Stream) -> bool:
    return stream.schema_type == "landings"


def current(state: StreamEditorState) -> list[EditorOffer]:
    return load(state.draft if state.draft is not None else state.published)


def view(state: StreamEditorState, *, missing: bool = False) -> EditorStream:
    offers = current(state)
    return EditorStream(
        stream=Stream.model_validate(state.baseline),
        editable=not missing,
        offers=offers,
        published_offers=load(state.published),
        dirty=state.draft is not None,
        revision=state.revision,
        total_share=float(total_share(offers)),
        validation_error=validation_error(offers),
        missing=missing,
    )


def remote_offers(
    stream: Stream, history: list[EditorOffer], catalog: dict[int, Offer]
) -> list[EditorOffer]:
    old = {o.offer_id: o for o in history}
    result: list[EditorOffer] = []
    seen: set[int] = set()
    for remote in stream.offers:
        if remote.offer_id in seen or not 0 <= remote.share <= 100:
            raise EditorError("invalid_upstream", "Invalid offer data in Keitaro", 502)
        seen.add(remote.offer_id)
        prior = old.get(remote.offer_id)
        offer = catalog.get(remote.offer_id)
        active = remote.state == "active"
        name = offer.name if offer else prior.name if prior else f"#{remote.offer_id}"
        result.append(
            EditorOffer(
                offer_id=remote.offer_id,
                name=name,
                share=remote.share if active else 0,
                active=active,
                pinned=bool(active and prior and prior.active and prior.pinned),
            )
        )
    result.extend(
        o.model_copy(update={"active": False, "share": 0.0, "pinned": False})
        for o in history
        if o.offer_id not in seen
    )
    return result


def apply_remote(
    state: StreamEditorState, stream: Stream, catalog: dict[int, Offer]
) -> None:
    published = remote_offers(stream, load(state.published), catalog)
    state.baseline = signature(stream)
    state.published = dump(published)
    state.draft = None
    # A fetch is read-only upstream. Normalize an invalid nonempty distribution
    # in a draft; impossible pinned configurations remain visible and blocked.
    if validation_error(published) and any(o.active for o in published):
        try:
            fixed = rebalance(published)
        except EditorError:
            pass
        else:
            state.draft = dump(fixed)
    state.revision += 1


def outbound(offers: list[EditorOffer]) -> list[StreamOffer]:
    return [StreamOffer(offer_id=o.offer_id, share=o.share) for o in offers if o.active]


def offer_signature(offers: list[StreamOffer]) -> list[dict[str, object]]:
    return [o.model_dump(mode="json") for o in sorted(offers, key=lambda o: o.offer_id)]


class EditorService:
    def __init__(
        self,
        client: KeitaroClient,
        repository: EditorRepository,
        journal: OperationJournal,
    ) -> None:
        self._client = client
        self._repository = repository
        self._journal = journal

    async def get(self, campaign_id: int) -> CampaignEditor:
        return await self._sync(campaign_id, None)

    async def fetch(self, campaign_id: int, data: FetchRequest) -> CampaignEditor:
        return await self._sync(campaign_id, data)

    async def _sync(
        self, campaign_id: int, data: FetchRequest | None
    ) -> CampaignEditor:
        async with self._repository.locked(campaign_id) as tx:
            campaign = await self._client.get_campaign(campaign_id)
            streams = await self._client.list_streams(campaign_id)
            states = {s.stream_id: s for s in await tx.list(campaign_id)}
            if data is not None:
                for s in states.values():
                    if s.draft is not None and (
                        not data.discard_drafts
                        or data.revisions.get(s.stream_id) != s.revision
                    ):
                        raise EditorError(
                            "draft_conflict",
                            "Fetch would discard a draft; confirm using its revision",
                            409,
                        )
            need_catalog = any(
                editable(s) and (data is not None or s.id not in states)
                for s in streams
            )
            catalog = (
                {o.id: o for o in await self._client.list_offers()}
                if need_catalog
                else {}
            )
            result = []
            for stream in streams:
                if stream.campaign_id != campaign_id:
                    raise EditorError(
                        "invalid_upstream", "Stream belongs to another campaign", 502
                    )
                if not editable(stream):
                    if (
                        data is None
                        and stream.id in states
                        and states[stream.id].draft is not None
                    ):
                        continue
                    result.append(EditorStream(stream=stream, editable=False))
                    continue
                state = states.pop(stream.id, None)
                if state is None:
                    state = StreamEditorState(
                        stream_id=stream.id,
                        campaign_id=campaign_id,
                        baseline={},
                        published=[],
                        draft=None,
                        revision=0,
                    )
                    apply_remote(state, stream, catalog)
                    tx.add(state)
                elif data is not None:
                    apply_remote(state, stream, catalog)
                result.append(view(state))
            # Keep orphaned drafts visible; never publish them.
            for state in states.values():
                if data is not None and state.draft is not None:
                    state.draft = None
                    state.revision += 1
                if state.draft is not None:
                    result.append(view(state, missing=True))
            return CampaignEditor(
                campaign=campaign,
                streams=sorted(
                    result,
                    key=lambda s: (not s.editable, s.stream.position or 0, s.stream.id),
                ),
            )

    async def _state(
        self, tx: EditorTransaction, campaign_id: int, stream_id: int, revision: int
    ) -> StreamEditorState:
        state = next(
            (s for s in await tx.list(campaign_id) if s.stream_id == stream_id), None
        )
        if state is None:
            raise EditorError("stream_not_found", "Open the campaign editor first", 404)
        if state.revision != revision:
            raise EditorError(
                "revision_conflict", "Editor changed; reload and try again", 409
            )
        return state

    async def _editable_remote(self, campaign_id: int, stream_id: int) -> Stream:
        try:
            remote = await self._client.get_stream(stream_id)
        except KeitaroError as exc:
            if exc.upstream_status == 404:
                raise EditorError(
                    "upstream_conflict", "Stream no longer exists in Keitaro", 409
                ) from exc
            raise
        if remote.campaign_id != campaign_id or not editable(remote):
            raise EditorError("upstream_conflict", "Stream changed in Keitaro", 409)
        if remote.id != stream_id:
            raise EditorError("invalid_upstream", "Unexpected stream ID", 502)
        return remote

    async def _get_offer(self, offer_id: int) -> Offer:
        try:
            offer = await self._client.get_offer(offer_id)
        except KeitaroError as exc:
            if exc.upstream_status == 404:
                raise EditorError("offer_not_found", "Offer does not exist") from exc
            raise
        if offer.state != "active":
            raise EditorError("inactive_offer", "Offer is not active")
        return offer

    async def change(
        self, campaign_id: int, stream_id: int, action: EditorAction
    ) -> EditorStream:
        async with self._repository.locked(campaign_id) as tx:
            state = await self._state(tx, campaign_id, stream_id, action.revision)
            await self._editable_remote(campaign_id, stream_id)
            offers = current(state)
            by_id = {o.offer_id: o for o in offers}
            target = by_id.get(action.offer_id)
            if action.action in ("add", "restore"):
                if target and target.active:
                    raise EditorError("duplicate_offer", "Offer is already connected")
                if action.action == "restore" and target is None:
                    raise EditorError("offer_not_found", "Removed offer not found", 404)
                if total_share([o for o in offers if o.pinned]) >= 100:
                    raise EditorError(
                        "no_free_share", "All traffic is pinned; free a share first"
                    )
                offer = await self._get_offer(action.offer_id)
                added = EditorOffer(offer_id=offer.id, name=offer.name, share=0)
                offers = [o for o in offers if o.offer_id != offer.id] + [added]
                offers = rebalance(offers)
                if next(o.share for o in offers if o.offer_id == offer.id) == 0:
                    raise EditorError(
                        "no_free_share", "No percentage available for this offer"
                    )
            else:
                if target is None or not target.active:
                    raise EditorError("offer_not_found", "Active offer not found", 404)
                updates: dict[str, object]
                if action.action == "remove":
                    updates = {"active": False, "pinned": False, "share": 0.0}
                elif action.action == "pin":
                    updates = {"pinned": True}
                elif action.action == "unpin":
                    updates = {"pinned": False}
                else:
                    updates = {"share": float(action.share)}
                offers = [
                    o.model_copy(update=updates) if o.offer_id == target.offer_id else o
                    for o in offers
                ]
                if action.action != "pin" or validation_error(offers):
                    offers = rebalance(
                        offers,
                        edited_id=target.offer_id if action.action == "share" else None,
                    )
            serialized = dump(offers)
            if serialized != dump(current(state)):
                state.draft = None if serialized == state.published else serialized
                state.revision += 1
            return view(state)

    async def cancel(
        self, campaign_id: int, stream_id: int, revision: int
    ) -> EditorStream:
        async with self._repository.locked(campaign_id) as tx:
            state = await self._state(tx, campaign_id, stream_id, revision)
            if state.draft is not None:
                state.draft = None
                state.revision += 1
            return view(state)

    async def publish(
        self, campaign_id: int, stream_id: int, revision: int
    ) -> EditorStream:
        async with self._repository.locked(campaign_id) as tx:
            state = await self._state(tx, campaign_id, stream_id, revision)
            offers = current(state)
            error = validation_error(offers)
            if error:
                raise EditorError("invalid_distribution", error)
            remote = await self._editable_remote(campaign_id, stream_id)
            desired = outbound(offers)
            remote_signature = signature(remote)
            baseline = signature(Stream.model_validate(state.baseline))
            same_offers = offer_signature(remote.offers) == offer_signature(desired)
            same_routing = {
                k: v for k, v in remote_signature.items() if k != "offers"
            } == {k: v for k, v in baseline.items() if k != "offers"}
            # If a previous PUT succeeded but its response/commit was lost, the
            # desired remote state is already present; reconcile without a write.
            if remote_signature != baseline and not (
                same_offers and same_routing and state.draft is not None
            ):
                raise EditorError(
                    "upstream_conflict", "Keitaro changed; fetch before publishing", 409
                )
            if state.draft is None:
                return view(state)
            if not same_offers:
                remote = await self._write(campaign_id, stream_id, desired, remote)
            state.baseline = signature(remote)
            state.published = dump(offers)
            state.draft = None
            state.revision += 1
            return view(state)

    async def _write(
        self,
        campaign_id: int,
        stream_id: int,
        desired: list[StreamOffer],
        remote: Stream,
    ) -> Stream:
        detail = f"stream_id={stream_id}"
        operation = await self._journal.start("update", detail)
        try:
            updated = await self._client.replace_stream_offers(stream_id, desired)
            if (
                updated.id != stream_id
                or updated.campaign_id != campaign_id
                or signature(updated) | {"offers": []}
                != signature(remote) | {"offers": []}
                or offer_signature(updated.offers) != offer_signature(desired)
            ):
                raise EditorError(
                    "publication_unknown",
                    "Keitaro returned unexpected offers; check before retrying",
                    502,
                )
        except KeitaroError as exc:
            rejected = (
                exc.upstream_status is not None and 400 <= exc.upstream_status < 500
            )
            status = OperationStatus.FAILED if rejected else OperationStatus.UNKNOWN
            await self._journal.finish(operation, status, campaign_id, detail)
            raise EditorError(
                "publication_failed" if rejected else "publication_unknown",
                "Keitaro did not confirm publication; draft retained",
                502,
            ) from exc
        except EditorError:
            await self._journal.finish(
                operation, OperationStatus.UNKNOWN, campaign_id, detail
            )
            raise
        await self._journal.finish(
            operation, OperationStatus.SUCCESS, campaign_id, detail
        )
        return updated
