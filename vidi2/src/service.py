#!/usr/bin/env python3
"""
service.py — Vidi 2.0 Main Service

FastAPI-Service der auf Port 8191 läuft. Stellt Endpoints für:
  • /status          (Health-Check für Contentix-Detection)
  • /run/discovery   (manuell oder cron-triggered)
  • /runs            (Observability)
  • /settings        (Config)

Discovery-Pipeline ist in discovery.py — wird hier getriggert.
"""

import os
import sys
import json
import time
import uuid
import logging
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# ──────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "info").upper(),
    format="%(asctime)s [%(levelname)s] vidi: %(message)s",
)
log = logging.getLogger("vidi")

# ──────────────────────────────────────────────────────────────
# Config (env-loaded, with sensible defaults)
# ──────────────────────────────────────────────────────────────

CONTENTIX_URL = os.environ.get("CONTENTIX_URL", "http://localhost:3038")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:12434")
OLLAMA_PRIMARY_MODEL = os.environ.get("OLLAMA_PRIMARY_MODEL", "qwen3.5:latest")
OLLAMA_REASONING_MODEL = os.environ.get("OLLAMA_REASONING_MODEL", "gemma4:12b")
OLLAMA_AGENT_MODEL = os.environ.get("OLLAMA_AGENT_MODEL", "ornith-1.5:9b")
CLOUD_FALLBACK_ENABLED = os.environ.get("CLOUD_FALLBACK_ENABLED", "true").lower() == "true"
M3_API_URL = os.environ.get("M3_API_URL", "")
M3_API_KEY = os.environ.get("M3_API_KEY", "")
DISCOVERY_CRON = os.environ.get("DISCOVERY_CRON", "0 9 * * *")
DISCOVERY_ENABLED = os.environ.get("DISCOVERY_ENABLED", "true").lower() == "true"
SERVICE_VERSION = "2.0.0-alpha"

# Paths
SERVICE_DIR = Path(__file__).parent
DATA_DIR = SERVICE_DIR.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# ──────────────────────────────────────────────────────────────
# Settings (in-memory cache, persisted via Contentix on POST)
# ──────────────────────────────────────────────────────────────

class Settings:
    def __init__(self):
        self.ollama_url = OLLAMA_URL
        self.ollama_primary = OLLAMA_PRIMARY_MODEL
        self.ollama_reasoning = OLLAMA_REASONING_MODEL
        self.ollama_agent = OLLAMA_AGENT_MODEL
        self.cloud_fallback = CLOUD_FALLBACK_ENABLED
        self.m3_api_url = M3_API_URL
        self.m3_api_key = M3_API_KEY
        self.discovery_cron = DISCOVERY_CRON
        self.discovery_enabled = DISCOVERY_ENABLED

    def to_dict(self):
        return {
            "ollamaUrl": self.ollama_url,
            "ollamaPrimaryModel": self.ollama_primary,
            "ollamaReasoningModel": self.ollama_reasoning,
            "ollamaAgentModel": self.ollama_agent,
            "cloudFallbackEnabled": self.cloud_fallback,
            "discoveryCron": self.discovery_cron,
            "discoveryEnabled": self.discovery_enabled,
        }

settings = Settings()

# ──────────────────────────────────────────────────────────────
# App
# ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="Vidi 2.0 — Local Content-Buddy for Contentix",
    version=SERVICE_VERSION,
    description=(
        "Proactive topic discovery + script drafting. "
        "Standalone service that integrates with Contentix via HTTP. "
        "See vidi2/SPEC.md for the full architecture."
    ),
)


# ──────────────────────────────────────────────────────────────
# Models
# ──────────────────────────────────────────────────────────────

class DiscoveryRequest(BaseModel):
    brief: Optional[str] = None
    targetChannelId: Optional[str] = None
    maxItems: Optional[int] = 5  # 3-5 per spec
    minConfidence: Optional[float] = 0.6
    dryRun: Optional[bool] = False


class SettingsUpdate(BaseModel):
    ollamaUrl: Optional[str] = None
    ollamaPrimaryModel: Optional[str] = None
    ollamaReasoningModel: Optional[str] = None
    ollamaAgentModel: Optional[str] = None
    cloudFallbackEnabled: Optional[bool] = None
    discoveryCron: Optional[str] = None
    discoveryEnabled: Optional[bool] = None


# ──────────────────────────────────────────────────────────────
# State (in-memory, for the running session)
# ──────────────────────────────────────────────────────────────

last_run_at: Optional[str] = None
last_run_items: int = 0
queue_depth: int = 0
models_available: list[str] = []


# ──────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────

async def check_ollama_models() -> list[str]:
    """Check which models are actually pulled in Ollama."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{settings.ollama_url}/api/tags")
            if r.status_code == 200:
                data = r.json()
                return [m["name"] for m in data.get("models", [])]
    except Exception as e:
        log.debug(f"ollama not reachable: {e}")
    return []


async def post_to_contentix(path: str, body: dict) -> Optional[dict]:
    """POST to Contentix API. Returns parsed JSON or None on failure."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(f"{CONTENTIX_URL}{path}", json=body)
            r.raise_for_status()
            return r.json()
    except Exception as e:
        log.error(f"Contentix POST {path} failed: {e}")
        return None


# ──────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "service": "vidi2",
        "version": SERVICE_VERSION,
        "phase": "skeleton",
        "endpoints": ["/status", "/run/discovery", "/runs", "/settings"],
    }


@app.get("/status")
async def status():
    """Health-Check + capabilities."""
    global last_run_at, last_run_items, queue_depth, models_available
    # Refresh model list (cheap, cached in scope)
    models_available = await check_ollama_models()
    return {
        "version": SERVICE_VERSION,
        "ollamaUrl": settings.ollama_url,
        "modelsAvailable": models_available,
        "discoveryEnabled": settings.discovery_enabled,
        "discoveryCron": settings.discovery_cron,
        "cloudFallbackEnabled": settings.cloud_fallback,
        "lastRun": last_run_at,
        "lastRunItems": last_run_items,
        "queueDepth": queue_depth,
        "contentixUrl": CONTENTIX_URL,
        "now": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


@app.get("/runs")
async def list_runs():
    """List recent discovery-runs. Pulls from Contentix /api/vidi/runs."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{CONTENTIX_URL}/api/vidi/runs?limit=20")
            r.raise_for_status()
            return r.json()
    except Exception as e:
        log.warning(f"Contentix unreachable, returning empty: {e}")
        return []


@app.post("/run/discovery")
async def run_discovery(req: DiscoveryRequest):
    """
    Trigger a discovery-run manually (or via cron).
    Pipeline:
      1. Pull LILAC + YouTube + Contentix-History
      2. Local classification (qwen3.5)
      3. Trend-detection (gemma4:12b)
      4. Synthesis
      5. Push to Contentix /api/vidi/inbox
    """
    global last_run_at, last_run_items, queue_depth

    if not settings.discovery_enabled:
        raise HTTPException(status_code=503, detail="discovery disabled in settings")

    queue_depth += 1
    run_id = str(uuid.uuid4())
    started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    start_ms = int(time.time() * 1000)

    log.info(f"discovery-run {run_id[:8]} started (queue={queue_depth})")

    # Log run start to Contentix
    await post_to_contentix("/api/vidi/runs", {
        "id": run_id,
        "started_at": started_at,
        "status": "running",
        "mode": "discovery",
        "metadata": json.dumps({"trigger": "manual" if req.brief else "cron"}),
    })

    try:
        # ─── Phase 3: real discovery pipeline (replaces the Phase-2 stub) ───
        import asyncio
        from discovery import run_discovery

        max_items = req.maxItems if req.maxItems is not None else 5
        summary = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: run_discovery(
                target_channel_id=req.targetChannelId,
                max_items=max_items,
                dry_run=req.dryRun,
            ),
        )
        items = summary["cards"]
        items_pushed = summary["cards_pushed"]
        items_found = summary["candidates_fitted"]

        # Push each item to Contentix (auch im dry-run, aber dann werden sie nicht
        # persistiert weil maxItems caps und dry-run-Flag die Pushes ueberspringt).
        for item in items:
            await post_to_contentix("/api/vidi/inbox", item)

        last_run_items = len(items)

        # Log run done
        duration_ms = int(time.time() * 1000) - start_ms
        await post_to_contentix("/api/vidi/runs", {
            "id": run_id,
            "started_at": started_at,
            "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "status": "done",
            "mode": "discovery",
            "items_found": items_found,
            "items_pushed": items_pushed,
            "duration_ms": duration_ms,
        })

        last_run_at = started_at
        return {
            "runId": run_id,
            "itemsFound": items_found,
            "itemsPushed": items_pushed,
            "durationMs": duration_ms,
            "items": items,
        }
    except Exception as e:
        log.error(f"discovery-run {run_id[:8]} failed: {e}")
        await post_to_contentix("/api/vidi/runs", {
            "id": run_id,
            "started_at": started_at,
            "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "status": "failed",
            "mode": "discovery",
            "error": str(e),
        })
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        queue_depth = max(0, queue_depth - 1)


async def _discovery_stub(req: DiscoveryRequest) -> list[dict]:
    """
    DEPRECATED — Phase 3 now uses discovery.py:run_discovery() directly.
    Kept as a no-op stub for backwards-compat with old callers (none expected).
    """
    log.warning("called deprecated _discovery_stub")
    return []


@app.get("/settings")
async def get_settings():
    return settings.to_dict()


@app.post("/settings")
async def update_settings(update: SettingsUpdate):
    if update.ollamaUrl is not None:
        settings.ollama_url = update.ollamaUrl
    if update.ollamaPrimaryModel is not None:
        settings.ollama_primary = update.ollamaPrimaryModel
    if update.ollamaReasoningModel is not None:
        settings.ollama_reasoning = update.ollamaReasoningModel
    if update.ollamaAgentModel is not None:
        settings.ollama_agent = update.ollamaAgentModel
    if update.cloudFallbackEnabled is not None:
        settings.cloud_fallback = update.cloudFallbackEnabled
    if update.discoveryCron is not None:
        settings.discovery_cron = update.discoveryCron
    if update.discoveryEnabled is not None:
        settings.discovery_enabled = update.discoveryEnabled
    return settings.to_dict()


# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("VIDI_PORT", "8191"))
    log.info(f"starting Vidi 2.0 service on port {port}")
    log.info(f"  ollama: {settings.ollama_url}")
    log.info(f"  contentix: {CONTENTIX_URL}")
    log.info(f"  models: {settings.ollama_primary} / {settings.ollama_reasoning}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level=os.environ.get("LOG_LEVEL", "info").lower())
