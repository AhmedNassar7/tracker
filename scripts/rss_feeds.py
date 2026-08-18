"""Static preset RSS feeds — the realistic no-backend alternative to a true
per-user saved-filter feed. A static site can't compute arbitrary filtered
XML on demand (that needs a server, which this project deliberately doesn't
have), so instead a handful of the most useful fixed filters are rendered
to their own .xml file every hourly run, from data/site-index.json's
already-flattened items. Uses xml.etree.ElementTree (stdlib) rather than
hand-building XML strings, so text content is escaped correctly by
construction instead of by a hand-rolled escape() call.
"""

from __future__ import annotations

import datetime
import xml.etree.ElementTree as ET
from email.utils import format_datetime
from pathlib import Path
from typing import Callable

SITE_URL = "https://ahmednassar7.github.io/tracker/"

FEED_PRESETS: list[dict] = [
    {
        "id": "all-jobs",
        "title": "All Jobs",
        "description": "Every open software engineering job tracker currently tracks, merged hourly from 15+ sources.",
        "matches": lambda item: item.get("kind") == "job",
    },
    {
        "id": "internships",
        "title": "Internships",
        "description": "Software engineering internships tracker currently tracks.",
        "matches": lambda item: item.get("kind") == "job" and item.get("level") == "internship",
    },
    {
        "id": "new-grad",
        "title": "New Grad Roles",
        "description": "New-grad software engineering roles tracker currently tracks.",
        "matches": lambda item: item.get("kind") == "job" and item.get("level") == "new_grad",
    },
    {
        "id": "hackathons",
        "title": "Hackathons",
        "description": "Hackathons tracker is currently tracking.",
        "matches": lambda item: item.get("kind") == "hackathon",
    },
    {
        "id": "events",
        "title": "Events",
        "description": "Tech events tracker is currently tracking.",
        "matches": lambda item: item.get("kind") == "event",
    },
]


def _parse_generated_at(generated_at: str) -> datetime.datetime:
    return datetime.datetime.strptime(generated_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)


def _rss_item(entry: dict) -> ET.Element:
    item = ET.Element("item")
    ET.SubElement(item, "title").text = f"{entry.get('company', '')} — {entry.get('title', '')}"
    ET.SubElement(item, "link").text = entry.get("url", "")
    guid = ET.SubElement(item, "guid")
    guid.set("isPermaLink", "false")
    guid.text = entry.get("id", "")

    description_parts = [part for part in (entry.get("location"), entry.get("level"), entry.get("age")) if part]
    ET.SubElement(item, "description").text = " · ".join(description_parts)

    posted_at = entry.get("posted_at") or ""
    if posted_at:
        try:
            posted_dt = datetime.datetime.strptime(posted_at, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc)
            ET.SubElement(item, "pubDate").text = format_datetime(posted_dt, usegmt=True)
        except ValueError:
            pass  # posted_at is documented as "" or a strict YYYY-MM-DD — an unparseable value just skips pubDate

    return item


def build_feed_xml(preset: dict, items: list[dict], generated_at: str) -> str:
    """Render one preset's matching items as an RSS 2.0 document. Pure —
    takes the already-flattened site-index items rather than reading a
    file, so it's testable without disk I/O.
    """
    matches: Callable[[dict], bool] = preset["matches"]
    matched = [item for item in items if matches(item)]
    # Newest first. posted_at is "" for some public-layer rows (Workday's
    # fuzzy-date case, see config/job-entry.schema.json) — those sort last
    # rather than crashing, via the empty-string fallback.
    matched.sort(key=lambda item: item.get("posted_at") or "", reverse=True)

    rss = ET.Element("rss", version="2.0")
    channel = ET.SubElement(rss, "channel")
    ET.SubElement(channel, "title").text = f"tracker — {preset['title']}"
    ET.SubElement(channel, "link").text = SITE_URL
    ET.SubElement(channel, "description").text = preset["description"]
    ET.SubElement(channel, "lastBuildDate").text = format_datetime(_parse_generated_at(generated_at), usegmt=True)

    for entry in matched:
        channel.append(_rss_item(entry))

    ET.indent(rss, space="  ")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(rss, encoding="unicode") + "\n"


def write_feeds(items: list[dict], generated_at: str, out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for preset in FEED_PRESETS:
        xml_text = build_feed_xml(preset, items, generated_at)
        path = out_dir / f"{preset['id']}.xml"
        path.write_text(xml_text, encoding="utf-8")
        written.append(path)
    return written
