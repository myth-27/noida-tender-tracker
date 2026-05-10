import logging
import re
from datetime import date, datetime
from typing import Any

from bs4 import BeautifulSoup, Tag

logger = logging.getLogger(__name__)

# Actual NIC eProcurement "Search by Location" results table columns (0-based):
#   0: S.No   1: e-Published Date   2: Closing Date   3: Opening Date
#   4: Title and Ref.No./Tender ID (contains <a> link to detail page)
#   5: Organisation Chain
_COL_SNO = 0
_COL_CLOSE = 2
_COL_OPEN = 3
_COL_TITLE = 4
_COL_ORG = 5
_EXPECTED_COLS = 6

_DATE_FORMATS = (
    "%d-%b-%Y %I:%M %p",   # 08-May-2026 06:55 PM
    "%d-%m-%Y %I:%M %p",
    "%d/%m/%Y %I:%M %p",
    "%d-%b-%Y",
    "%d-%m-%Y",
    "%d/%m/%Y",
    "%d %b %Y",
)

_BASE_URL = "https://etender.up.nic.in"


def _parse_date(raw: str) -> str | None:
    raw = raw.strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def _find_results_table(soup: BeautifulSoup) -> Tag | None:
    """
    Find the table that holds tender data rows.
    The correct table has rows of exactly 6 <td> cells where col-0 matches 'N.'
    """
    for table in soup.find_all("table"):
        trs = table.find_all("tr")
        data_rows = [
            tr for tr in trs
            if len(tr.find_all("td")) == _EXPECTED_COLS
            and re.match(r"^\d+\.$", tr.find_all("td")[_COL_SNO].get_text(strip=True))
        ]
        if data_rows:
            return table
    return None


def extract_rows(html: str, location: str = "Noida") -> list[dict[str, Any]]:
    """
    Parse results page HTML. Returns list of tender dicts.
    Each dict has a '_detailUrl' key (absolute URL) for the scraper to visit
    to retrieve the tender amount.
    """
    today = date.today().isoformat()
    soup = BeautifulSoup(html, "lxml")
    table = _find_results_table(soup)

    if table is None:
        logger.warning("Could not find results table in page HTML")
        return []

    rows: list[dict[str, Any]] = []
    for tr in table.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) != _EXPECTED_COLS:
            continue
        sno = tds[_COL_SNO].get_text(strip=True)
        if not re.match(r"^\d+\.$", sno):
            continue

        raw_close = tds[_COL_CLOSE].get_text(strip=True)
        raw_open = tds[_COL_OPEN].get_text(strip=True)
        close_date = _parse_date(raw_close)
        open_date = _parse_date(raw_open)

        if close_date is None:
            logger.warning("Unparseable closeDate '%s'", raw_close)
        if open_date is None:
            logger.warning("Unparseable openDate '%s'", raw_open)

        title_td = tds[_COL_TITLE]
        title = title_td.get_text(separator=" ", strip=True).lstrip("[").strip()
        a_tag = title_td.find("a", href=True)
        detail_url = (_BASE_URL + a_tag["href"]) if a_tag else None

        org = tds[_COL_ORG].get_text(separator=" ", strip=True)

        rows.append({
            "name": title,
            "org": org,
            "amount": "",           # filled later by visiting the detail page
            "openDate": open_date or raw_open,
            "closeDate": close_date or raw_close,
            "addedOn": today,
            "location": location,
            "_detailUrl": detail_url,
        })

    return rows


# ── Detail page amount extraction ─────────────────────────────────────────────

# Ordered by preference — first match wins; "emd" is excluded intentionally
_AMOUNT_LABELS_ORDERED = (
    "tender value in",          # exact NIC label: "Tender Value in ₹"
    "tender value",
    "estimated value",
    "approx bid value",
    "approximate bid value",
    "work estimate",
    "contract value",
)

_EXCLUDE_LABELS = ("emd", "earnest money", "tender fee", "processing fee")


def extract_amount_from_detail_html(html: str) -> str:
    """
    Scan a tender detail page for the tender value.
    Returns cleaned numeric string (digits only, no commas/₹) or "" if not found.
    The NIC portal label is 'Tender Value in ₹' — we match that first.
    """
    soup = BeautifulSoup(html, "lxml")

    for cell in soup.find_all(["td", "th"]):
        label = cell.get_text(separator=" ", strip=True).lower()

        # Skip EMD / fee rows
        if any(ex in label for ex in _EXCLUDE_LABELS):
            continue

        if any(kw in label for kw in _AMOUNT_LABELS_ORDERED):
            sibling = cell.find_next_sibling(["td", "th"])
            if sibling:
                raw = sibling.get_text(separator=" ", strip=True)
                cleaned = re.sub(r"[₹,\s]", "", raw)
                if re.search(r"\d", cleaned):
                    return cleaned

    return ""
