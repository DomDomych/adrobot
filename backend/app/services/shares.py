from decimal import Decimal

from app.core.errors import EditorError
from app.schemas.editor import EditorOffer


def decimal_share(value: float) -> Decimal:
    return Decimal(str(value))


def total_share(offers: list[EditorOffer]) -> Decimal:
    return sum((decimal_share(o.share) for o in offers if o.active), Decimal(0))


def validation_error(offers: list[EditorOffer]) -> str | None:
    if not any(o.active for o in offers):
        return "At least one active offer is required"
    if total_share(offers) != 100:
        return "Active offer shares must sum to 100%"
    if any(not o.active and (o.share != 0 or o.pinned) for o in offers):
        return "Removed offers must have zero share and cannot be pinned"
    return None


def rebalance(
    offers: list[EditorOffer], *, edited_id: int | None = None
) -> list[EditorOffer]:
    active = [o for o in offers if o.active]
    if not active:
        raise EditorError("last_offer", "At least one active offer is required")
    fixed = [o for o in active if o.pinned or o.offer_id == edited_id]
    free = sorted(
        (o for o in active if not o.pinned and o.offer_id != edited_id),
        key=lambda o: o.offer_id,
    )
    remaining = Decimal(100) - total_share(fixed)
    if remaining < 0 or (not free and remaining != 0):
        raise EditorError(
            "invalid_distribution", "Distribution conflicts with fixed shares"
        )
    allocations: dict[int, float] = {}
    if free:
        # Whole percentages for normal edits; preserve fractional upstream pins.
        places = max(0, -remaining.normalize().as_tuple().exponent)
        scale = Decimal(10) ** places
        units = int(remaining * scale)
        base, extra = divmod(units, len(free))
        allocations = {
            o.offer_id: float(Decimal(base + (i < extra)) / scale)
            for i, o in enumerate(free)
        }
    result = [
        o.model_copy(update={"share": 0.0, "pinned": False})
        if not o.active
        else o.model_copy(update={"share": allocations[o.offer_id]})
        if o.offer_id in allocations
        else o
        for o in offers
    ]
    error = validation_error(result)
    if error:
        raise EditorError("invalid_distribution", error)
    return result
