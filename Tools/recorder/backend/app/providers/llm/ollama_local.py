from __future__ import annotations
import httpx
from ...config import get_settings
from .base import LLMProvider, LLMResult


class OllamaLocalProvider(LLMProvider):
    name = "ollama_local"

    def complete(self, system: str, user: str) -> LLMResult:
        s = get_settings()
        url = f"{s.ollama_base_url.rstrip('/')}/api/chat"
        payload = {
            "model": s.ollama_model,
            "stream": False,
            "options": {"temperature": 0.2},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        with httpx.Client(timeout=300.0) as client:
            r = client.post(url, json=payload)
            r.raise_for_status()
            data = r.json()
        return LLMResult(text=data["message"]["content"], model=s.ollama_model)