from app.core.config import Settings
from app.core.errors import CampaignCreationError, InactiveOfferError
from app.db.operations import OperationJournal, OperationStatus
from app.integrations.keitaro.client import KeitaroClient
from app.integrations.keitaro.exceptions import KeitaroError
from app.integrations.keitaro.schemas import (
    Campaign,
    CampaignCreate,
    StreamCreate,
    StreamFilter,
    StreamOffer,
)
from app.schemas.campaigns import CampaignDetails, CreateCampaignRequest


class CampaignService:
    def __init__(
        self, client: KeitaroClient, settings: Settings, journal: OperationJournal
    ) -> None:
        self._client = client
        self._settings = settings
        self._journal = journal

    async def list_campaigns(self, offset: int, limit: int) -> list[Campaign]:
        return await self._client.list_campaigns(offset=offset, limit=limit)

    async def get_campaign(self, campaign_id: int) -> CampaignDetails:
        campaign = await self._client.get_campaign(campaign_id)
        streams = await self._client.list_streams(campaign_id)
        return CampaignDetails(campaign=campaign, streams=streams)

    async def create_campaign(self, data: CreateCampaignRequest) -> CampaignDetails:
        try:
            offer = await self._client.get_offer(data.offer_id)
        except KeitaroError as exc:
            if exc.upstream_status == 404:
                raise InactiveOfferError("Selected offer does not exist") from exc
            raise
        if offer.state != "active":
            raise InactiveOfferError("Selected offer is not active")

        operation_id = await self._journal.start("create", "Campaign creation")
        try:
            campaign = await self._client.create_campaign(
                CampaignCreate(
                    name=data.name,
                    domain_id=self._settings.keitaro_domain_id,
                    group_id=self._settings.keitaro_group_id,
                    traffic_source_id=self._settings.keitaro_traffic_source_id,
                )
            )
        except KeitaroError as exc:
            # Without a returned ID, a timed-out POST cannot safely be undone.
            # Even a server error may have occurred after the remote write.
            rejected = (
                exc.upstream_status is not None and 400 <= exc.upstream_status < 500
            )
            status = OperationStatus.FAILED if rejected else OperationStatus.UNKNOWN
            await self._journal.finish(operation_id, status, None, "Campaign creation")
            if rejected:
                raise
            raise CampaignCreationError(
                "creation_unknown",
                "Campaign creation outcome is unknown; check Keitaro before retrying",
            ) from exc

        try:
            geo_stream = await self._client.create_stream(
                StreamCreate(
                    campaign_id=campaign.id,
                    name=f"Geo {data.geo}",
                    type="regular",
                    schema="redirect",
                    action_type="http",
                    action_payload="https://google.com",
                    filters=[
                        StreamFilter(name="country", mode="accept", payload=[data.geo])
                    ],
                )
            )
            offer_stream = await self._client.create_stream(
                StreamCreate(
                    campaign_id=campaign.id,
                    name="Offers",
                    type="default",
                    schema="landings",
                    offers=[StreamOffer(offer_id=offer.id, share=100, state="active")],
                )
            )
        except KeitaroError as exc:
            try:
                await self._client.delete_campaign(campaign.id)
            except KeitaroError as cleanup:
                if cleanup.upstream_status != 404:
                    await self._journal.finish(
                        operation_id,
                        OperationStatus.CLEANUP_FAILED,
                        campaign.id,
                        "Manual verification required",
                    )
                    raise CampaignCreationError(
                        "cleanup_failed",
                        "Campaign may be incomplete; check Keitaro before retrying",
                        campaign_id=campaign.id,
                    ) from cleanup
            await self._journal.finish(
                operation_id,
                OperationStatus.ROLLED_BACK,
                campaign.id,
                "Stream creation failed",
            )
            raise CampaignCreationError(
                "creation_rolled_back",
                "Stream creation failed; the incomplete campaign was removed",
                campaign_id=campaign.id,
            ) from exc

        await self._journal.finish(
            operation_id, OperationStatus.SUCCESS, campaign.id, "Campaign creation"
        )
        return CampaignDetails(campaign=campaign, streams=[geo_stream, offer_stream])
