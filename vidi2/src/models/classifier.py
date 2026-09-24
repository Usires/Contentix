"""
classifier.py — Bulk-Classifier (qwen3.5) für Vidi 2.0 Discovery.

Stage 2 der Discovery-Pipeline:
  1. Pull candidate items from LILAC + YouTube (via knowledge/*.py).
  2. Pre-filter: language-based dispatch (DE → classify_de.txt, EN → classify_en.txt).
  3. Batch-classify with qwen3.5 (json-mode).
  4. Filter to channel_fit >= 0.5.

Returns a list of dicts with `channel_fit`, `freshness`, `category`, `reasoning`.
"""

import os
import json
from pathlib import Path
from typing import List, Dict

from models.ollama_client import chat_json, OllamaError


PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"
PRIMARY_MODEL = os.environ.get("OLLAMA_PRIMARY_MODEL", "qwen3.5:latest")
TEMPERATURE = 0.2
MAX_TOKENS = 2048
MAX_ITEMS_PER_BATCH = 12  # qwen3.5 has big context but we cap for quality


def _load_prompt(language: str, recent_titles: List[str], items: List[Dict]) -> str:
    """Load and render the prompt template for the given language."""
    fname = "classify_de.txt" if language == "de" else "classify_en.txt"
    p = PROMPTS_DIR / fname
    if not p.exists():
        raise FileNotFoundError(f"missing prompt: {p}")
    template = p.read_text(encoding="utf-8")
    rendered = template.replace("{N}", str(len(items)))
    rendered = rendered.replace("{ITEMS_JSON}", json.dumps(items, ensure_ascii=False))
    rendered = rendered.replace(
        "{RECENT_TITLES}",
        "\n".join(f"- {t}" for t in recent_titles) or "(no history available)",
    )
    return rendered


def _split_by_language(items: List[Dict]) -> Dict[str, List[Dict]]:
    """Group candidate items by detected language."""
    bucket = {"de": [], "en": [], "unknown": []}
    for it in items:
        lang = it.get("language") or "unknown"
        if lang in bucket:
            bucket[lang].append(it)
        else:
            bucket["unknown"].append(it)
    return bucket


def _batch(items: List[Dict], size: int) -> List[List[Dict]]:
    """Yield items in batches of `size`."""
    for i in range(0, len(items), size):
        yield items[i:i + size]


def classify_batch(model: str, items: List[Dict], recent_titles: List[str], language: str) -> List[Dict]:
    """
    Classify one batch (max 12 items) with qwen3.5 in JSON mode.
    Returns a list of scored items; on parse failure returns [].
    """
    if not items:
        return []
    prompt = _load_prompt(language, recent_titles, items)
    messages = [{"role": "user", "content": prompt}]
    try:
        result = chat_json(
            model,
            messages,
            temperature=TEMPERATURE,
            max_tokens=MAX_TOKENS,
        )
    except OllamaError as e:
        # We log and return empty — caller can decide to retry or skip.
        print(f"[classifier] Ollama error: {e}", flush=True)
        return []
    if not isinstance(result, dict):
        return []
    return [s for s in result.get("items", []) if isinstance(s, dict)]


def filter_by_fit(scored: List[Dict], min_fit: float = 0.5) -> List[Dict]:
    """Drop items with channel_fit < min_fit."""
    return [s for s in scored if float(s.get("channel_fit", 0.0)) >= min_fit]


def run(candidates: List[Dict], recent_titles: List[str], min_fit: float = 0.5) -> List[Dict]:
    """
    Main entry: take raw candidates, batch-classify by language,
    filter, return enriched items with `channel_fit`, `freshness`, etc.

    Each returned item is the original dict PLUS the classifier output merged in.
    """
    if not candidates:
        return []
    by_lang = _split_by_language(candidates)
    enriched: List[Dict] = []

    for lang, items in by_lang.items():
        if not items:
            continue
        for batch_items in _batch(items, MAX_ITEMS_PER_BATCH):
            scored = classify_batch(PRIMARY_MODEL, batch_items, recent_titles, lang)
            # Match scored items back to original (by title) and merge.
            scored_by_title = {s.get("title", ""): s for s in scored}
            for orig in batch_items:
                key = orig.get("topic_signal") or orig.get("title", "")
                if not key:
                    continue
                hit = scored_by_title.get(key, {})
                merged = {**orig, **hit}
                enriched.append(merged)

    return filter_by_fit(enriched, min_fit=min_fit)


if __name__ == "__main__":
    # Smoke test: synthesize 2 candidates and check that qwen3.5 returns valid JSON.
    sample = [
        {"title": "CachyOS Gaming Test 2026", "topic_signal": "CachyOS Gaming Test 2026", "language": "de"},
        {"title": "Steam Deck OLED review", "topic_signal": "Steam Deck OLED review", "language": "en"},
    ]
    out = run(sample, ["CachyOS 2025 install guide", "Steam Deck benchmarks 2025"])
    print(f"Classified: {len(out)} items")
    for it in out:
        print(f"  [{it.get('channel_fit', 0):.2f}] [{it.get('language')}] {it.get('title')[:50]}")
