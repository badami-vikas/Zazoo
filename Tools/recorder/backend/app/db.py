from __future__ import annotations
from functools import lru_cache
from supabase import create_client, Client
from .config import get_settings


@lru_cache
def supabase() -> Client:
    s = get_settings()
    if not s.supabase_url or not s.supabase_service_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env"
        )
    return create_client(s.supabase_url, s.supabase_service_key)