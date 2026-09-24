"""
discovery.py — Discovery Orchestrator für Vidi 2.0.

Phase 3 end-to-end: Pull → Classify → Trend → Synthesize → Push.

Pipeline stages:
  1. Pull candidate items (knowledge/lilac_archive.py + knowledge/yt_search.py).
     Max ~40 items: 12 from LILAC (24h, score>=3) + 30 from YT-trending.
  2. Classify via qwen3.5 (models/classifier.py) — bulk-classify by language,
     filter to channel_fit >= 0.5. Target: ~10-15 items.
  3. Trend-rank via gemma4:12b (models/reasoner.stage_trend) by language.
  4. Synthesize top-N (≤5 per language) via gemma4:12b (models/reasoner.stage_synthesize).
  5. Combine DE + EN cards, cap to 3-5 total, push via Contentix API.

Returns: (list_of_cards, summary_dict_for_log)
"""

import os
import time
import uuid
import logging
import httpx
from typing import List, Dict, Optional

from knowledge import lilac_archive, contentix_history, yt_search
from models import classifier, reasoner


log = logging.getLogger("vidi.discovery")

CONTENTIX_URL = os.environ.get("CONTENTIX_URL", "http://localhost:3038")

# Limits (Phase 3 v1 — tunen nach ersten echten Runs)
MAX_LILAC_ITEMS = 12          # 24h-Linux-News
MAX_YT_ITEMS = 24             # trending, 7d, dedup
MIN_CHANNEL_FIT = 0.5         # bulk-classifier filter
MAX_TREND_TOP = 8             # how many go into synthesise
MAX_SYNTH_PER_LANG = 3        # how many cards per language
MAX_TOTAL_CARDS = 5           # overall cap pushed to Contentix
HISTORY_DAYS = 30             # saturation window


# ────────────────────────────────────────────────────────────
# Stage 1: Pull candidate items
# ────────────────────────────────────────────────────────────

def stage_pull() -> List[Dict]:
    """Stage 1: gather items from LILAC + YouTube trending + Contentix history."""
    candidates: List[Dict] = []

    # 1a. LILAC (24h scored items)
    try:
        lilac_items = lilac_archive.load_recent_items(hours=24, min_score=3)
        for it in lilac_items[:MAX_LILAC_ITEMS]:
            candidates.append({
                "topic_signal": it.get("title", ""),
                "title": it.get("title", ""),
                "language": it.get("language", "unknown"),
                "source": "lilac",
                "url": it.get("url", ""),
                "score": it.get("score", 0),
                "snippet": it.get("snippet", ""),
            })
        log.info(f"[stage1] LILAC pulled: {len(lilac_items[:MAX_LILAC_ITEMS])}")
    except Exception as e:
        log.warning(f"[stage1] LILAC failed: {e}")

    # 1b. YouTube trending (Linux gaming, 7d)
    try:
        yt_signals = yt_search.load_trending_signals(max_per_query=6)
        for s in yt_signals[:MAX_YT_ITEMS]:
            candidates.append({
                "topic_signal": s.get("topic_signal", ""),
                "title": s.get("title", ""),
                "language": s.get("language", "unknown"),
                "source": "yt_search",
                "video_id": s.get("video_id", ""),
                "views": s.get("views", 0),
                "published_at": s.get("published_at", ""),
            })
        log.info(f"[stage1] YT pulled: {len(yt_signals[:MAX_YT_ITEMS])}")
    except Exception as e:
        log.warning(f"[stage1] YT failed: {e}")

    log.info(f"[stage1] Total candidates: {len(candidates)}")
    return candidates


# ────────────────────────────────────────────────────────────
# Stage 2-4: Classify + Trend + Synthesize (bilingual)
# ────────────────────────────────────────────────────────────

def stage_classify(candidates: List[Dict], recent_titles: List[str]) -> List[Dict]:
    """Stage 2: bulk-classify with qwen3.5, filter to channel_fit."""
    fitted = classifier.run(candidates, recent_titles, min_fit=MIN_CHANNEL_FIT)
    log.info(f"[stage2] Classified+fitted: {len(fitted)}")
    return fitted


def stage_trend_synth(fitted: List[Dict]) -> List[Dict]:
    """Stages 3+4: trend-rank then synthesise cards per language."""
    cards: List[Dict] = []
    by_lang: Dict[str, List[Dict]] = {"de": [], "en": [], "unknown": []}
    for it in fitted:
        by_lang.setdefault(it.get("language", "unknown"), []).append(it)

    for lang, items in by_lang.items():
        if not items or lang == "unknown":
            continue
        ranked = reasoner.stage_trend(items, lang)
        if not ranked:
            log.info(f"[stage3+4] {lang}: trend-empty, skipping synth")
            continue
        ranked = reasoner.cap_top_n(ranked, MAX_TREND_TOP)
        synthesised = reasoner.stage_synthesize(ranked, lang)
        if synthesised:
            cards.extend(synthesised[:MAX_SYNTH_PER_LANG])
        log.info(f"[stage3+4] {lang}: ranked={len(ranked)} cards={len(synthesised[:MAX_SYNTH_PER_LANG])}")

    cards.sort(key=lambda c: -float(c.get("confidence_score", 0.0)))
    return cards[:MAX_TOTAL_CARDS]


# ────────────────────────────────────────────────────────────
# Stage 5: Push to Contentix
# ────────────────────────────────────────────────────────────

def push_to_contentix(card: Dict, run_id: str) -> bool:
    """POST one synthesised card to Contentix /api/vidi/inbox."""
    payload = {
        "title": card.get("title", "(ohne Titel)"),
        "hook_line": card.get("hook_line", ""),
        "why_now": card.get("why_now", ""),
        "research_cites": [],  # synth-prompt doesn't emit them; could be enriched later
        "script_skeleton": card.get("script_skeleton", ""),
        "confidence_score": float(card.get("confidence_score", 0.0)),
        "source": f"discovery_run:{run_id}",
        "metadata": {
            "language": card.get("language", "unknown"),
            "search_keywords": card.get("search_keywords", []),
        },
    }
    try:
        with httpx.Client(timeout=10) as client:
            r = client.post(f"{CONTENTIX_URL}/api/vidi/inbox", json=payload)
        return r.status_code == 200
    except Exception as e:
        log.warning(f"[stage5] push failed: {e}")
        return False


# ────────────────────────────────────────────────────────────
# Public API
# ────────────────────────────────────────────────────────────

def run_discovery(target_channel_id: Optional[str] = None,
                  max_items: int = MAX_TOTAL_CARDS,
                  dry_run: bool = False) -> Dict:
    """
    Full pipeline. Returns a summary dict:
      {
        "runId": uuid,
        "candidates_total": int,
        "candidates_fitted": int,
        "cards_pushed": int,
        "duration_ms": int,
        "cards": [...],   # the actual cards before push (for log / debug)
      }
    """
    run_id = str(uuid.uuid4())
    started_ms = int(time.time() * 1000)

    # 1) Pull
    candidates = stage_pull()
    cand_total = len(candidates)

    # 2) Get recent titles for saturation context (early so it's ready before Stage 2)
    history = contentix_history.get_history_summary()
    recent_titles = history["recent_titles"]

    # 3) Classify
    fitted = stage_classify(candidates, recent_titles)
    fitted_count = len(fitted)

    # 4) Trend + Synth
    cards = stage_trend_synth(fitted)
    cards = cards[:max_items]

    # 5) Push (unless dry_run)
    pushed = 0
    if not dry_run:
        for c in cards:
            # Tag cards with channel if provided (Phase 5 spec mentioned multi-channel)
            if target_channel_id:
                c.setdefault("metadata", {})["target_channel_id"] = target_channel_id
            if push_to_contentix(c, run_id):
                pushed += 1

    duration_ms = int(time.time() * 1000) - started_ms

    summary = {
        "runId": run_id,
        "candidates_total": cand_total,
        "candidates_fitted": fitted_count,
        "cards_pushed": pushed,
        "duration_ms": duration_ms,
        "cards": cards,
    }
    log.info(
        f"[run:{run_id}] candidates={cand_total} fitted={fitted_count} "
        f"cards={len(cards)} pushed={pushed} duration={duration_ms}ms"
    )
    return summary


if __name__ == "__main__":
    # Quick smoke (dry-run, smaller limits).
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    out = run_discovery(dry_run=True)
    print(f"\n=== Dry-run summary ===")
    print(f"  runId: {out['runId']}")
    print(f"  candidates: {out['candidates_total']}")
    print(f"  fitted:     {out['candidates_fitted']}")
    print(f"  cards:      {len(out['cards'])}")
    print(f"  cards_pushed: {out['cards_pushed']}")
    for c in out["cards"][:3]:
        print(f"   - {c.get('title','?')}")
