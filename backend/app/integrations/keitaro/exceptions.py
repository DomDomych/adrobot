class KeitaroError(Exception):
    def __init__(self, message: str, *, upstream_status: int | None = None) -> None:
        super().__init__(message)
        self.upstream_status = upstream_status


class KeitaroTimeout(KeitaroError):
    pass


class KeitaroUnavailable(KeitaroError):
    pass


class KeitaroContractError(KeitaroError):
    pass
