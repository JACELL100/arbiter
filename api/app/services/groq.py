"""Minimal LLM client for Groq (default) and OpenRouter (model ids prefixed ``openrouter/``).

Both are OpenAI-compatible. Shared concurrency limit, retries on 429/5xx honoring retry-after,
60 s timeout, and a 10 minute model-list cache.
"""
from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Any

import httpx

from ..config import settings

log = logging.getLogger("arbiter.llm")

GROQ_URL = "https://api.groq.com/openai/v1"
OPENROUTER_URL = "https://openrouter.ai/api/v1"
OPENROUTER_PREFIX = "openrouter/"
TIMEOUT = 60.0
MAX_RETRIES = 5
SEMAPHORE = asyncio.Semaphore(4)

FALLBACK_MODELS = [
    {"id": "llama-3.1-8b-instant", "owned_by": "Meta"},
    {"id": "llama-3.3-70b-versatile", "owned_by": "Meta"},
    {"id": "openai/gpt-oss-20b", "owned_by": "OpenAI"},
    {"id": "openai/gpt-oss-120b", "owned_by": "OpenAI"},
]
_EXCLUDE = ("whisper", "tts", "guard", "embed", "playai", "orpheus", "prompt-guard", "distil-whisper")
MODELS_TTL = 600.0
_models_cache: dict[str, tuple[float, list[dict]]] = {}
_clients: dict[str, httpx.AsyncClient] = {}


class GroqError(Exception):
    pass


class _ClientError(GroqError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def has_key() -> bool:
    """True when at least one provider is configured."""
    return bool(settings.groq_api_key or settings.openrouter_api_key)


def _provider(model: str) -> tuple[str, str]:
    """(provider, model id as the provider expects it)."""
    if model.startswith(OPENROUTER_PREFIX):
        return "openrouter", model[len(OPENROUTER_PREFIX):]
    return "groq", model


def _get_client(provider: str) -> httpx.AsyncClient:
    client = _clients.get(provider)
    if client is None or client.is_closed:
        if provider == "openrouter":
            key, base = settings.openrouter_api_key, OPENROUTER_URL
            extra = {"X-Title": "Arbiter"}
        else:
            key, base = settings.groq_api_key, GROQ_URL
            extra = {}
        if not key:
            name = "OPENROUTER_API_KEY" if provider == "openrouter" else "GROQ_API_KEY"
            raise GroqError(f"{name} is not configured")
        client = httpx.AsyncClient(base_url=base, timeout=TIMEOUT,
                                   headers={"Authorization": f"Bearer {key}", **extra})
        _clients[provider] = client
    return client


async def close_client() -> None:
    for c in list(_clients.values()):
        await c.aclose()
    _clients.clear()


def _retry_delay(attempt: int, resp: httpx.Response | None) -> float:
    if resp is not None:
        ra = resp.headers.get("retry-after")
        if ra:
            try:
                return min(float(ra), 60.0) + random.uniform(0, 0.5)
            except ValueError:
                pass
    return min(2 ** attempt, 30) + random.uniform(0, 0.5)


async def _request(provider: str, method: str, path: str, json: Any = None) -> dict:
    client = _get_client(provider)
    last_err = "unknown error"
    for attempt in range(MAX_RETRIES + 1):
        resp: httpx.Response | None = None
        try:
            resp = await client.request(method, path, json=json)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_err = f"network error: {exc}"
        else:
            if resp.status_code < 400:
                data = resp.json()
                # OpenRouter may return 200 with an error object
                if isinstance(data, dict) and data.get("error") and not data.get("choices") and not data.get("data"):
                    err = data["error"]
                    code = err.get("code") if isinstance(err, dict) else None
                    msg = f"{provider} error: {str(err)[:500]}"
                    if isinstance(code, int) and (code == 429 or code >= 500):
                        last_err = msg
                    else:
                        raise _ClientError(code if isinstance(code, int) else 400, msg)
                else:
                    return data
            else:
                last_err = f"{provider} {resp.status_code}: {resp.text[:500]}"
                if resp.status_code != 429 and resp.status_code < 500:
                    raise _ClientError(resp.status_code, last_err)
        if attempt < MAX_RETRIES:
            await asyncio.sleep(_retry_delay(attempt, resp))
    raise GroqError(last_err)


async def chat(
    model: str,
    messages: list[dict],
    *,
    temperature: float = 0.7,
    max_tokens: int = 700,
    json_mode: bool = False,
) -> str:
    provider, model_id = _provider(model)
    payload: dict[str, Any] = {
        "model": model_id,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    async with SEMAPHORE:
        try:
            data = await _request(provider, "POST", "/chat/completions", json=payload)
        except _ClientError:
            if provider != "openrouter" or "response_format" not in payload:
                raise
            # some OpenRouter models reject response_format: retry once without it
            payload.pop("response_format")
            data = await _request(provider, "POST", "/chat/completions", json=payload)
    try:
        content = data["choices"][0]["message"].get("content") or ""
    except (KeyError, IndexError, TypeError, AttributeError):
        raise GroqError("Malformed response from the model provider")
    return content.strip()


async def _groq_models() -> list[dict]:
    if not settings.groq_api_key:
        return FALLBACK_MODELS
    data = await _request("groq", "GET", "/models")
    models = []
    for m in data.get("data", []):
        mid = m.get("id") or ""
        if not mid or any(x in mid.lower() for x in _EXCLUDE) or m.get("active") is False:
            continue
        models.append({"id": mid, "owned_by": m.get("owned_by") or ""})
    return sorted(models, key=lambda x: x["id"])


async def _openrouter_models() -> list[dict]:
    if not settings.openrouter_api_key:
        return []
    data = await _request("openrouter", "GET", "/models")
    ids = sorted({m.get("id") for m in data.get("data", []) if (m.get("id") or "").endswith(":free")})
    return [{"id": OPENROUTER_PREFIX + i, "owned_by": "openrouter"} for i in ids]


async def _cached(name: str, loader) -> list[dict]:
    now = time.time()
    hit = _models_cache.get(name)
    if hit and hit[0] > now:
        return hit[1]
    try:
        models = await loader()
    except GroqError as exc:
        log.warning("listing %s models failed: %s", name, exc)
        if hit:
            return hit[1]
        return FALLBACK_MODELS if name == "groq" else []
    _models_cache[name] = (now + MODELS_TTL, models)
    return models


async def list_models() -> list[dict]:
    groq_models, or_models = await asyncio.gather(_cached("groq", _groq_models), _cached("openrouter", _openrouter_models))
    return [*groq_models, *or_models]
