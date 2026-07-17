"""Generic markdown-table parser for community job-tracker READMEs that
follow the same general shape as SimplifyJobs' lists (one row per job, one
company/title/location column, one cell holding the apply link) but each
with its own column order and link markup — speedyapply, zapplyjobs, and
hanzili all differ here. A shared column-indexed parser avoids writing a
near-identical regex per repo.

scripts/simplify_jobs_parser.py is intentionally untouched and kept separate:
its pipe-table + HTML-table dual parsing is specific to how SimplifyJobs'
own lists are built, not a generic shape.
"""

from __future__ import annotations

import re

from simplify_jobs_parser import clean_html_text

AGE_CELL_RE = re.compile(r"^\d+\s*(d|day|days|w|week|weeks|mo|month|months|y|year|years)$", re.I)


def clean_cell_text(cell: str) -> str:
    text = clean_html_text(cell)
    return re.sub(r"\*\*([^*]+)\*\*", r"\1", text).strip()


def extract_cell_url(cell: str) -> str:
    """Find the first job-posting URL in a table cell, however it's marked
    up: a markdown link `[...](url)` (optionally with the url wrapped in
    `<...>`, which CommonMark allows for URLs with special characters), a
    raw `href="url"` attribute, or a bare URL as a last resort.
    """
    match = re.search(r"\]\(<?(https?://[^()<>]+)>?\)", cell)
    if match:
        return match.group(1).strip()
    match = re.search(r'href="(https?://[^"]+)"', cell)
    if match:
        return match.group(1).strip()
    match = re.search(r"(https?://\S+)", cell)
    if match:
        return match.group(1).strip().rstrip("|")
    return ""


def parse_job_table(content, *, company_idx, title_idx, location_idx):
    """Parse a markdown pipe-table of jobs into (company, title, location, url, age) tuples.

    Company/title/location are pinned by column position since that's stable
    across rows in every source seen so far — but the trailing columns
    (salary, apply button, age/posted) are NOT: some of these repos drop an
    empty trailing cell (and its pipe) entirely rather than leaving it blank,
    which shifts every index after it. So the apply URL and the age are each
    found by scanning cells for their *shape* (a link, a "Nd"/"Nmo"-style or
    relative-date cell) rather than trusting a fixed position.
    """
    entries = []
    min_cells = max(company_idx, title_idx, location_idx) + 1
    relative_age_words = {"today", "yesterday", "recently"}

    for line in content.splitlines():
        line = line.strip()
        if not line.startswith("|") or "http" not in line or "---" in line:
            continue

        cells = [c.strip() for c in line.split("|")[1:-1]]
        if len(cells) < min_cells:
            continue

        company = clean_cell_text(cells[company_idx])
        title = clean_cell_text(cells[title_idx])
        location = clean_cell_text(cells[location_idx]) or "Remote"

        url = ""
        age = ""
        for cell in reversed(cells):
            if not url:
                url = extract_cell_url(cell)
            if not age:
                candidate = clean_cell_text(cell)
                if AGE_CELL_RE.match(candidate) or candidate.lower() in relative_age_words:
                    age = candidate
            if url and age:
                break

        if company and title and url:
            entries.append((company, title, location, url, age))

    return entries
