class CampaignCreationError(Exception):
    def __init__(
        self, code: str, message: str, *, campaign_id: int | None = None
    ) -> None:
        super().__init__(message)
        self.code = code
        self.campaign_id = campaign_id


class InactiveOfferError(Exception):
    pass


class JournalUnavailable(Exception):
    pass


class EditorError(Exception):
    def __init__(self, code: str, message: str, status: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
