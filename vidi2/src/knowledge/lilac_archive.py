"""
lilac_archive.py — LILAC Newsletter Archive Wrapper.

Read scored LILAC items (Linux/OSS news) from the newsletter archive.
This is Phase 3 source-1 of the discovery pipeline.
"""

import os
import json
import re
import httpx
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional


# LILAC newsletter files live at:
#   /home/dirk/reverse-proxy/html/apricot/*.html  (human-readable)
#   /home/dirk/reverse-proxy/html/apricot/*.meta.json  (scored metadata)
#
# We prefer the meta.json files because they contain the YouTube relevance score
# (set by the MiniMax-based scorer in lilac.py).

DEFAULT_ARCHIVE_DIR = Path("/home/dirk/reverse-proxy/html/newsletter")
LILAC_NEWSLETTER_URL = os.environ.get(
    "LILAC_NEWSLETTER_URL",
    "http://localhost:8182/newsletter/lilac-archive.json"
)


def parse_lilac_date(filename: str) -> Optional[datetime]:
    """Extract date from filename like 'apricot-2026-04-14.meta.json'."""
    m = re.search(r"(\d{4}-\d{2}-\d{2})", filename)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _extract_articles_from_html(html_path: Path) -> List[Dict[str, str]]:
    """
    Extract article metadata from a LILAC newsletter HTML.
    Each <h3> in the body is one article; the <a href> inside is the URL,
    and the visible text is the title (may have emoji prefix like 🎬).
    Returns a list ordered as they appear in the document (same order
    as youtube_indices in the matching meta.json).
    """
    import re
    try:
        html = html_path.read_text(encoding="utf-8")
    except OSError:
        return []

    # Match each <h3>...</h3> block, then extract first <a href> and title text.
    # The title may contain a <span class="scored">🎬 ...</span> or be plain text.
    article_re = re.compile(r"<h3>.*?</h3>", re.DOTALL)
    link_re = re.compile(r'<a href="([^"]+)"[^>]*>(.*?)</a>', re.DOTALL)
    span_re = re.compile(r"<span[^>]*>(.*?)</span>", re.DOTALL)
    tag_re = re.compile(r"<[^>]+>")
    articles: List[Dict[str, str]] = []
    for block in article_re.findall(html):
        link_match = link_re.search(block)
        if not link_match:
            continue
        url, raw_title = link_match.group(1), link_match.group(2)
        # If the title contains a <span class="scored">, that's the visible title;
        # otherwise strip all tags to get the text.
        span_match = span_re.search(raw_title)
        title = span_match.group(1) if span_match else raw_title
        title = tag_re.sub("", title).strip()
        # Drop the 🎬 prefix that LILAC adds to YT-scored articles — keeps title clean.
        if title.startswith("🎬"):
            title = title[1:].strip()
        if title and url:
            articles.append({"title": title, "url": url})
    return articles


def load_recent_items(hours: int = 24, min_score: int = 3) -> List[Dict]:
    """
    Load YouTube-scored LILAC items from the archive that are within the
    last N hours. min_score is kept for backwards-compat with the old
    API but currently not used (the new meta.json format only marks an
    item as YT-relevant or not).

    Schema (current, post-April-2026):
      meta.json: { youtube: bool, youtube_indices: [int, ...], ... }
      matching <date>.html: <h3>...</h3> per article, in order.
    Returns a list of dicts with keys:
      - title: str
      - url: str
      - source: "lilac"
      - date: iso-date
      - score: int (5 for YT-relevant, derived from the indicator)
      - snippet: "" (no summary in current schema — could be enriched later)
      - language: "de" | "en"
    """
    if not DEFAULT_ARCHIVE_DIR.exists():
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    items: List[Dict] = []

    for meta_path in DEFAULT_ARCHIVE_DIR.glob("*.meta.json"):
        date = parse_lilac_date(meta_path.name)
        if date is None or date < cutoff:
            continue
        try:
            data = json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        # New schema: youtube_indices is the list of article positions.
        if not isinstance(data, dict):
            continue
        if not data.get("youtube"):
            continue  # no YT-relevant articles in this newsletter
        yt_indices = data.get("youtube_indices") or []
        if not isinstance(yt_indices, list) or not yt_indices:
            continue

        # The corresponding HTML file has the same date in its name.
        html_path = meta_path.with_suffix("").with_suffix(".html")
        if not html_path.exists():
            # Fall back to the default filename pattern.
            html_path = meta_path.parent / meta_path.name.replace(".meta.json", ".html")
        if not html_path.exists():
            continue

        articles = _extract_articles_from_html(html_path)
        if not articles:
            continue

        for idx in yt_indices:
            if not isinstance(idx, int) or idx < 0 or idx >= len(articles):
                continue
            article = articles[idx]
            title = article["title"]
            if not title:
                continue
            items.append({
                "title": title,
                "url": article.get("url", ""),
                "source": "lilac",
                "date": date.isoformat(),
                "score": 5,  # YT-relevant per the meta.json indicator
                "snippet": "",  # not available in current schema
                "language": detect_language(title),
            })

    # Sort by date desc (newest first) — score is constant 5 in current schema.
    items.sort(key=lambda x: x["date"], reverse=True)
    return items


def detect_language(text: str) -> str:
    """
    Heuristic DE/EN detection based on character distribution.
    DE has more umlauts + longer average word length + typical stopwords.
    """
    de_markers = ["ß", "ä", "ö", "ü", " für ", " und ", " der ", " die "]
    en_markers = [" the ", " and ", " for ", " with "]
    de_score = sum(1 for m in de_markers if m in text.lower())
    en_score = sum(1 for m in en_markers if m in " " + text.lower() + " ")
    return "de" if de_score >= en_score else "en"


def load_via_http(url: str = LILAC_NEWSLETTER_URL, hours: int = 24) -> List[Dict]:
    """Fallback: pull LILAC archive via HTTP if file-system access fails."""
    try:
        with httpx.Client(timeout=10) as client:
            r = client.get(url)
            if r.status_code != 200:
                return []
            data = r.json()
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        items = []
        for entry in data if isinstance(data, list) else []:
            try:
                entry_date = datetime.fromisoformat(entry.get("date", "")).replace(tzinfo=timezone.utc)
            except (ValueError, TypeError):
                continue
            if entry_date < cutoff:
                continue
            items.append({
                "title": entry.get("title", ""),
                "url": entry.get("url", ""),
                "source": "lilac",
                "date": entry_date.isoformat(),
                "score": entry.get("score", 0),
                "snippet": (entry.get("snippet") or "")[:200],
                "language": detect_language(entry.get("title", "")),
            })
        items.sort(key=lambda x: (-x["score"], x["date"]), reverse=True)
        return items
    except Exception:
        return []


if __name__ == "__main__":
    items = load_recent_items(hours=24, min_score=3)
    print(f"LILAC items (24h, score≥3): {len(items)}")
    for it in items[:5]:
        print(f"  [{it['score']}] [{it['language']}] {it['title'][:60]}")
