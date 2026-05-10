import json
import logging
import os
from datetime import date, datetime
from pathlib import Path
from typing import Any

import aiofiles

logger = logging.getLogger(__name__)


def _daily_path(output_dir: Path) -> Path:
    return output_dir / f"tenders_{date.today().isoformat()}.json"


def _active_path(output_dir: Path) -> Path:
    return output_dir / "tenders_active.json"


async def write_daily(tenders: list[dict[str, Any]], output_dir: str) -> Path:
    """Write today's tender list to a dated JSON file."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    path = _daily_path(out)

    async with aiofiles.open(path, "w", encoding="utf-8") as f:
        await f.write(json.dumps(tenders, ensure_ascii=False, indent=2))

    logger.info("Wrote %d tenders to %s", len(tenders), path)
    return path


async def rebuild_active(output_dir: str, location: str) -> Path:
    """
    Scan all tenders_YYYY-MM-DD.json files, keep rows where closeDate >= today,
    and write tenders_active.json with a metadata envelope.
    """
    out = Path(output_dir)
    today = date.today().isoformat()
    active: list[dict[str, Any]] = []

    for daily_file in sorted(out.glob("tenders_????-??-??.json")):
        try:
            async with aiofiles.open(daily_file, encoding="utf-8") as f:
                rows: list[dict[str, Any]] = json.loads(await f.read())
            for row in rows:
                close = row.get("closeDate", "")
                if isinstance(close, str) and close >= today:
                    active.append(row)
        except Exception as exc:
            logger.warning("Could not read %s: %s", daily_file, exc)

    # Deduplicate by (name, org, closeDate)
    seen: set[tuple] = set()
    deduped: list[dict[str, Any]] = []
    for row in active:
        key = (row.get("name"), row.get("org"), row.get("closeDate"))
        if key not in seen:
            seen.add(key)
            deduped.append(row)

    payload: dict[str, Any] = {
        "lastFetched": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "location": location,
        "totalActive": len(deduped),
        "tenders": deduped,
    }

    active_path = _active_path(out)
    async with aiofiles.open(active_path, "w", encoding="utf-8") as f:
        await f.write(json.dumps(payload, ensure_ascii=False, indent=2))

    logger.info(
        "Rebuilt tenders_active.json — %d active tenders (pruned expired)", len(deduped)
    )
    return active_path
