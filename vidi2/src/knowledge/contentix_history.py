"""
contentix_history.py — Contentix History Wrapper für Vidi 2.0.

Reads Dirk's recent videos / kanban entries from Contentix to compute
saturation scores — so Vidi doesn't suggest topics Dirk already
covered. This is Phase 3 source-3 of the discovery pipeline.
"""

import os
import re
import json
import httpx
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional, Set


DEFAULT_CONTENTIX_URL = os.environ.get("CONTENTIX_URL", "http://localhost:3038")
SATURATION_DAYS = 30  # Look at the last 30 days of contentix history


def get_recent_videos(days: int = SATURATION_DAYS) -> List[Dict]:
    """
    Fetch videos from Contentix that were planned or published in the
    last `days`. Used to compute saturation scores.
    """
    try:
        with httpx.Client(timeout=10) as client:
            r = client.get(f"{DEFAULT_CONTENTIX_URL}/api/videos")
            if r.status_code != 200:
                return []
            videos = r.json() if isinstance(r.json(), list) else []
    except Exception:
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    recent = []
    for v in videos:
        # Use planned_date, published_date, or created_at as fallback.
        date_str = v.get("published_date") or v.get("planned_date") or v.get("created_at", "")
        try:
            dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            continue
        # Bug-Fix v2: ensure offset-aware so we can compare with cutoff.
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if dt < cutoff:
            continue
        recent.append({
            "id": v.get("id", ""),
            "title": v.get("title", ""),
            "status": v.get("status", ""),
            "date": date_str,
        })
    return recent


def extract_topic_keywords(videos: List[Dict]) -> Counter:
    """
    Pull out candidate keywords from titles. We deliberately keep
    this simple (whitelist of gaming/Linux terms) so the saturation
    check is fast.
    """
    keyword_whitelist = [
        # Deutsch
        "linux", "gaming", "spiele", "spielen", "gamescope", "proton",
        "cachyos", "fedora", "ubuntu", "arch", "wayland", "hdr",
        "steam deck", "controller", "grafikkarte", "gpu", "treiber",
        "benchmark", "fps", "performance", "wlan", "bluetooth",
        # English
        "steam", "nvidia", "amd", "intel", "rtx", "wayland",
        "benchmark", "performance", "driver", "kernel",
        "comfyui", "ollama", "open source", "rust", "python",
    ]
    counter = Counter()
    for v in videos:
        title_lower = v.get("title", "").lower()
        for kw in keyword_whitelist:
            # Use word boundaries to avoid "ubuntu" matching inside "ubuntouch".
            if re.search(rf"\b{re.escape(kw)}\b", title_lower):
                counter[kw] += 1
    return counter


def saturation_for_topic(topic_signal: str, history_keywords: Counter) -> float:
    """
    Compute a 0.0-1.0 saturation score for a candidate topic signal
    based on how many of its keywords were already used.

    Closer to 1.0 = Dirk has covered this topic a lot lately.
    Closer to 0.0 = fresh / underexplored.
    """
    topic_lower = topic_signal.lower()
    total = 0
    for kw, count in history_keywords.items():
        # Word boundary match for the keyword inside the topic.
        if re.search(rf"\b{re.escape(kw)}\b", topic_lower):
            total += count
    # Normalize: assume 8 hits = fully saturated.
    return min(1.0, total / 8.0)


def recent_topic_strings(videos: List[Dict]) -> List[str]:
    """Just titles — useful for prompt context. Limited to 15 most recent."""
    return [v.get("title", "") for v in videos[:15]]


def get_history_summary() -> Dict:
    """
    Convenience method — returns everything the discovery pipeline needs in
    one call. Caches no state (caller can call repeatedly).
    """
    videos = get_recent_videos()
    keywords = extract_topic_keywords(videos)
    return {
        "recent_videos": videos,
        "recent_count": len(videos),
        "topic_keywords": dict(keywords),
        "recent_titles": recent_topic_strings(videos),
    }


if __name__ == "__main__":
    summary = get_history_summary()
    print(f"Contentix recent videos (30d): {summary['recent_count']}")
    print(f"Top keywords: {sorted(summary['topic_keywords'].items(), key=lambda x: -x[1])[:5]}")
    print(f"\nLatest 5 titles:")
    for t in summary['recent_titles'][:5]:
        print(f"  - {t[:60]}")
