"""
reasoner.py — Trend-Detection + Final-Synthesis (gemma4:12b).

Stage 3-4 der Discovery-Pipeline:
  Stage 3 (Trend):  classify → trend-ranked list (Why-Now-Score).
  Stage 4 (Synth):  trend-ranked list → finished Vorschlags-Cards.

Why two stages with the same model? Same model, different prompts:
- Trend-prompt = comparative ranking (sortiert durch alle Topics).
- Synth-prompt  = content-creation (baut Cards aus Top-N).
We keep gemma4:12b for both because reasoning quality matters more
than speed here. qwen3.5 stayed at bulk-classification.
"""

import os
import json
from pathlib import Path
from typing import List, Dict

from models.ollama_client import chat_json, OllamaError


PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"
REASONING_MODEL = os.environ.get("OLLAMA_REASONING_MODEL", "gemma4:12b")
TEMPERATURE_TREND = 0.4
TEMPERATURE_SYNTH = 0.7
MAX_TOKENS_TREND = 2048
MAX_TOKENS_SYNTH = 4096


def _load_prompt(stage: str, language: str, items: List[Dict]) -> str:
    """stage: 'trend' | 'synth'. language: 'de' | 'en'."""
    fname = f"{stage}_{language}.txt"
    p = PROMPTS_DIR / fname
    if not p.exists():
        raise FileNotFoundError(f"missing prompt: {p}")
    template = p.read_text(encoding="utf-8")
    placeholder = "{RANKED_JSON}" if stage == "trend" else "{RANKED_JSON}"
    placeholder = "{ITEMS_JSON}" if stage == "trend" else placeholder
    if "{ITEMS_JSON}" in template and stage == "trend":
        rendered = template.replace("{N}", str(len(items)))
        rendered = rendered.replace("{ITEMS_JSON}", json.dumps(items, ensure_ascii=False))
        # synth's RANKED placeholder not used in trend.
        rendered = rendered.replace("{RANKED_JSON}", "")
    else:
        rendered = template.replace("{ITEMS_JSON}", "")
        rendered = rendered.replace("{RANKED_JSON}", json.dumps(items, ensure_ascii=False))
    return rendered


def stage_trend(scored: List[Dict], language: str, model: str = REASONING_MODEL) -> List[Dict]:
    """
    Stage 3 — trend-ranking with why-now reasoning.
    Returns the ranked list (with why_now_score, reason, hook, keywords, saturation).
    """
    if not scored:
        return []
    prompt = _load_prompt("trend", language, scored)
    try:
        result = chat_json(
            model,
            [{"role": "user", "content": prompt}],
            temperature=TEMPERATURE_TREND,
            max_tokens=MAX_TOKENS_TREND,
        )
    except OllamaError as e:
        print(f"[reasoner.trend] Ollama error: {e}", flush=True)
        return []
    if not isinstance(result, dict):
        return []
    return result.get("ranked", []) if isinstance(result.get("ranked"), list) else []


def stage_synthesize(ranked: List[Dict], language: str, model: str = REASONING_MODEL) -> List[Dict]:
    """
    Stage 4 — synthesis into finished Vorschlags-Cards.
    Returns list with title, hook_line, why_now, script_skeleton, etc.
    """
    if not ranked:
        return []
    prompt = _load_prompt("synth", language, ranked)
    try:
        result = chat_json(
            model,
            [{"role": "user", "content": prompt}],
            temperature=TEMPERATURE_SYNTH,
            max_tokens=MAX_TOKENS_SYNTH,
        )
    except OllamaError as e:
        print(f"[reasoner.synth] Ollama error: {e}", flush=True)
        return []
    if not isinstance(result, dict):
        return []
    return result.get("cards", []) if isinstance(result.get("cards"), list) else []


def cap_top_n(items: List[Dict], n: int) -> List[Dict]:
    """Take top-N — preserve order (assumed already ranked)."""
    return items[:n]


if __name__ == "__main__":
    sample = [
        {"title": "CachyOS Gaming Test 2026", "channel_fit": 0.85, "freshness": 0.7, "language": "de"},
        {"title": "Linux-Wayland HDR Test", "channel_fit": 0.78, "freshness": 0.9, "language": "de"},
    ]
    ranked = stage_trend(sample, "de")
    print(f"Ranked: {len(ranked)} items")
    cards = stage_synthesize(ranked[:3], "de")
    print(f"Cards: {len(cards)}")
    for c in cards:
        print(f"  - {c.get('title', '?')}")
