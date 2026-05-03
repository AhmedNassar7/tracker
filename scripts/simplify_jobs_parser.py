from __future__ import annotations

import html
import re


def clean_html_text(value: str) -> str:
    value = re.sub(r"<br\s*/?>", " ", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def extract_markdown_link(value: str) -> str:
    match = re.search(r"\[[^\]]*\]\((https?://[^)]+)\)", value)
    if match:
        return match.group(1).strip()
    match = re.search(r"(https?://\S+)", value)
    if match:
        return match.group(1).strip().rstrip("|")
    return ""


def extract_location_details(value: str):
    match = re.search(
        r"<details[^>]*>\s*<summary><strong>(\d+)\s+locations?</strong></summary>(.*?)</details>",
        value,
        flags=re.I | re.S,
    )
    if not match:
        return clean_html_text(value), []

    inner = match.group(2)
    inner = re.sub(r"<br\s*/?>|</br>", "\n", inner, flags=re.I)
    inner = re.sub(r"<[^>]+>", " ", inner)
    inner = html.unescape(inner)
    locations = [part.strip(" \t\r\n-•") for part in inner.split("\n")]
    locations = [part for part in locations if part]
    location_text = " ".join(locations)
    return location_text or clean_html_text(value), locations


def format_location_display(location: str, location_details=None) -> str:
    clean_location = re.sub(r"\s+", " ", location.strip())
    if location_details:
        count = len(location_details)
        summary = f"{count} location" if count == 1 else f"{count} locations"
        body = "<br>".join(html.escape(item) for item in location_details)
        return f"<details><summary><strong>{summary}</strong></summary>{body}</details>"

    count_match = re.match(r"^(?P<count>\d+)\s+locations?\s+(?P<rest>.+)$", clean_location, flags=re.I)
    if count_match:
        count = int(count_match.group("count"))
        summary = f"{count} location" if count == 1 else f"{count} locations"
        body = html.escape(count_match.group("rest").strip())
        return f"<details><summary><strong>{summary}</strong></summary>{body}</details>"

    return clean_location


def parse_simplify_entries(content: str):
    entries = []

    inactive_match = re.search(r"🗃️\s*Inactive roles", content, flags=re.I)
    if inactive_match:
        content = content[:inactive_match.start()]

    for line in content.splitlines():
        line = line.strip()
        if not line.startswith("|") or "http" not in line:
            continue
        parts = [part.strip() for part in line.split("|")[1:-1]]
        if len(parts) < 4:
            continue
        company = clean_html_text(parts[0])
        title = clean_html_text(parts[1])
        location = clean_html_text(parts[2]) or "Remote"
        url = extract_markdown_link(parts[3])
        if company and title and url:
            entries.append((company, title, location, url, "", []))

    for row_html in re.findall(r"<tr[^>]*>(.*?)</tr>", content, flags=re.I | re.S):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row_html, flags=re.I | re.S)
        if len(cells) < 3:
            continue

        texts = [clean_html_text(cell) for cell in cells]
        company = texts[0]
        title = texts[1] if len(texts) > 1 else ""
        location_cell = cells[2] if len(cells) > 2 else "Remote"
        location, location_details = extract_location_details(location_cell)
        if not location:
            location = texts[2] if len(texts) > 2 else "Remote"
        age = clean_html_text(cells[4]) if len(cells) > 4 else ""

        hrefs = re.findall(r"href=\"(https?://[^\"]+)\"", row_html, flags=re.I)
        url = ""
        for href in hrefs:
            if "simplify.jobs/c/" in href:
                continue
            if "simplify.jobs/p/" in href:
                continue
            url = href
            break
        if not url and hrefs:
            url = hrefs[0]

        if company and title and url:
            entries.append((company, title, location, url, age, location_details))

    deduped = []
    seen = set()
    for item in entries:
        key = (item[0].lower(), item[1].lower(), item[3])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped
