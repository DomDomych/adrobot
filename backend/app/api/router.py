from fastapi import APIRouter

from app.api.campaigns import router as campaigns_router
from app.api.health import router as health_router
from app.api.offers import router as offers_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(campaigns_router)
api_router.include_router(offers_router)
