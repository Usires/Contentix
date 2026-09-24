"""
yt_search.py — YouTube MCP Wrapper für Vidi 2.0 Discovery Pipeline.

Calls the YouTube MCP server (http://localhost:8190) to fetch trending
Linux-gaming videos from the last 7 days. This is Phase 3 source-2 of
the discovery pipeline. Bilingual: DE + EN queries.
"""

import os
import json
import httpx
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional


YOUTUBE_MCP_URL = os.environ.get("YOUTUBE_MCP_URL", "http://localhost:8190")
QUERY_WINDOW_DAYS = 7

# Bilingual queries covering Dirk's niche: Linux gaming + content-creator topics.
SEARCH_QUERIES = [
    # Deutsch (YouTube Gaming DE)
    {"query": "Linux Gaming 2026", "lang": "de", "region": "DE"},
    {"query": "Steam Deck Reviews Deutsch", "lang": "de", "region": "DE"},
    {"query": "CachyOS Gaming Benchmarks", "lang": "de", "region": "DE"},
    {"query": "Proton Spiele Deutsch", "lang": "de", "region": "DE"},
    {"query": "Gamescope HDR Linux", "lang": "de", "region": "DE"},
    # English (broader reach)
    {"query": "Linux gaming benchmarks 2026", "lang": "en", "region": "US"},
    {"query": "Steam Deck OLED review", "lang": "en", "region": "US"},
    {"query": "Proton gaming Linux", "lang": "en", "region": "US"},
    {"query": "Wayland gaming HDR", "lang": "en", "region": "US"},
    {"query": "Ollama local AI assistant", "lang": "en", "region": "US"},
]


def call_mcp_search(query: str, max_results: int = 10, region: str = "US") -> List[Dict]:
    """
    Call the YouTube MCP server's search endpoint. Returns videos with
    title, view count, published date.

    The MCP server exposes tools via POST /tool/<tool-name> (Contentix
    HTTP shortcut) with JSON body {arguments: {...}}. The wrapper below
    adapts our (tool, params) shape into that format.

    Returns videos normalised to snake_case keys (video_id, published_at,
    view_count, title, description, channel_id, channel_title, thumbnail).
    """
    try:
        with httpx.Client(timeout=15) as client:
            r = client.post(
                f"{YOUTUBE_MCP_URL}/tool/youtube_search_videos",
                json={
                    "query": query,
                    "maxResults": max_results,
                    "order": "date",  # Latest first — matches QUERY_WINDOW_DAYS intent.
                },
            )
            if r.status_code != 200:
                return []
            data = r.json()
            # MCP returns {content: [{type: "text", text: "<json-string>"}]}
            # Unwrap the inner JSON array of videos.
            content = data.get("content", [])
            raw = []
            if content and isinstance(content, list):
                first = content[0]
                if isinstance(first, dict) and first.get("type") == "text":
                    try:
                        raw = json.loads(first.get("text", "[]"))
                    except (json.JSONDecodeError, TypeError):
                        raw = []
            if not raw:
                raw = data.get("result", data.get("videos", [])) if isinstance(data, dict) else []
            if not isinstance(raw, list):
                return []
            # Normalise CamelCase → snake_case so downstream code doesn't need to care.
            normalised = []
            for v in raw:
                if not isinstance(v, dict):
                    continue
                normalised.append({
                    "video_id": v.get("videoId") or v.get("video_id") or v.get("id") or "",
                    "title": v.get("title", ""),
                    "description": v.get("description", ""),
                    "published_at": v.get("publishedAt") or v.get("published_at") or "",
                    "view_count": int(v.get("viewCount") or v.get("view_count") or 0),
                    "channel_id": v.get("channelId") or v.get("channel_id") or "",
                    "channel_title": v.get("channelTitle") or v.get("channel_title") or "",
                    "thumbnail": v.get("thumbnail", ""),
                })
            return normalised
    except Exception:
        return []


def call_search_via_contentix_proxy(query: str, max_results: int = 10) -> List[Dict]:
    """
    Fallback: Contentix has a /api/youtube/search-style proxy.
    Or we go via /api/youtube/* if MCP unreachable.
    """
    # (kept as stub for future extraction; not yet wired)
    return []


def is_recent(item: Dict, days: int = QUERY_WINDOW_DAYS) -> bool:
    """True if publishedAt is within the last `days`."""
    pub = item.get("publishedAt") or item.get("published_at") or ""
    try:
        pub_dt = datetime.fromisoformat(pub.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return True  # if we can't parse, keep it
    # Bug-Fix v2: ensure pub_dt is timezone-aware so we can compare with
    # datetime.now(timezone.utc). Most YouTube MCP timestamps already include
    # "+00:00" but defensively handle naive strings too.
    if pub_dt.tzinfo is None:
        pub_dt = pub_dt.replace(tzinfo=timezone.utc)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    return pub_dt >= cutoff


def extract_topic_signal(video: Dict) -> Optional[str]:
    """
    Extract a topic-signal from video metadata — title + tags + description start.
    """
    title = video.get("title", "").strip()
    description = video.get("description", "").strip()
    if not title:
        return None
    snippet = description[:200] if description else ""
    return f"{title}. {snippet}".strip()


def load_trending_signals(max_per_query: int = 8) -> List[Dict]:
    """
    Run all SEARCH_QUERIES against the YouTube MCP, filter to recent (last 7d),
    deduplicate by video_id, return signals sorted by view count desc.

    Returns list of dicts:
      - topic_signal: str  (title + description snippet)
      - video_id: str
      - title: str
      - views: int
      - published_at: iso-date
      - source: "yt_search"
      - language: "de" | "en"
      - region: str
    """
    seen_ids = set()
    results: List[Dict] = []
    for qcfg in SEARCH_QUERIES:
        videos = call_mcp_search(qcfg["query"], max_results=max_per_query, region=qcfg["region"])
        for v in videos:
            vid = v.get("video_id") or v.get("id") or ""
            if not vid or vid in seen_ids:
                continue
            if not is_recent(v, days=QUERY_WINDOW_DAYS):
                continue
            seen_ids.add(vid)
            signal = extract_topic_signal(v)
            if not signal:
                continue
            results.append({
                "topic_signal": signal,
                "video_id": vid,
                "title": v.get("title", ""),
                "views": v.get("view_count", 0) or 0,
                "published_at": v.get("published_at", "") or v.get("publishedAt", ""),
                "source": "yt_search",
                "language": qcfg["lang"],
                "region": qcfg["region"],
            })
    results.sort(key=lambda x: -x["views"])
    return results


if __name__ == "__main__":
    signals = load_trending_signals()
    print(f"YT trending signals (7d): {len(signals)}")
    for s in signals[:5]:
        print(f"  [{s['language']}] [{s['views']} views] {s['title'][:60]}")
