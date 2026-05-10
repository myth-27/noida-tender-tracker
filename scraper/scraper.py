"""
Noida Tender Scraper
Usage:
  python scraper.py              # run on daily 11:00 AM IST schedule
  python scraper.py --run-now   # run immediately once
"""

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from dotenv import load_dotenv
from playwright.async_api import async_playwright, Page, Playwright

import captcha as captcha_mod
import exporter
import parser as tender_parser

# ── Bootstrap ─────────────────────────────────────────────────────────────────

load_dotenv()

OUTPUT_DIR = os.getenv("OUTPUT_DIR", "./tender_data")
SEARCH_LOCATION = os.getenv("SEARCH_LOCATION", "Noida")
HEADLESS = os.getenv("HEADLESS", "true").lower() not in ("false", "0", "no")
SCHEDULE_HOUR = int(os.getenv("SCHEDULE_HOUR", "11"))
SCHEDULE_MINUTE = int(os.getenv("SCHEDULE_MINUTE", "0"))

TARGET_URL = (
    "https://etender.up.nic.in/nicgep/app"
    "?page=FrontEndTendersByLocation&service=page"
)

_CAPTCHA_SELECTORS = [
    "img[id*='captcha']",
    "img[src*='captcha']",
    "img[alt*='captcha']",
]
_CAPTCHA_INPUT_SELECTORS = [
    "input[name*='captcha']",
    "input[id*='captcha']",
]

# ── Logging setup ──────────────────────────────────────────────────────────────

def _setup_logging() -> None:
    fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    # Force UTF-8 on Windows console to avoid cp1252 errors with non-ASCII chars
    sys.stdout.reconfigure(encoding="utf-8")
    handlers = [
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("scraper.log", encoding="utf-8"),
    ]
    logging.basicConfig(level=logging.INFO, format=fmt, handlers=handlers)


logger = logging.getLogger("scraper")

# ── Helpers ────────────────────────────────────────────────────────────────────

async def _find_captcha_element(page: Page):
    for sel in _CAPTCHA_SELECTORS:
        el = page.locator(sel).first
        if await el.count() > 0:
            logger.info("Found CAPTCHA element via selector: %s", sel)
            return el
    return None


async def _fill_captcha_input(page: Page, text: str) -> bool:
    for sel in _CAPTCHA_INPUT_SELECTORS:
        el = page.locator(sel).first
        if await el.count() > 0:
            await el.fill(text)
            logger.info("Filled CAPTCHA input via selector: %s", sel)
            return True
    logger.warning("Could not find CAPTCHA input field")
    return False


async def _screenshot_element(page: Page, selector_or_locator) -> bytes:
    """Return screenshot bytes of a given element."""
    return await selector_or_locator.screenshot()


async def _get_page_html(page: Page) -> str:
    return await page.content()


async def _go_next_page(page: Page) -> bool:
    """
    Click the NIC eProcurement 'next page' link (href contains TablePages.linkFwd).
    Returns False when the link is absent (we are on the last page).
    """
    el = page.locator("a[href*='TablePages.linkFwd']").first
    if await el.count() == 0:
        return False
    await el.click()
    await page.wait_for_load_state("networkidle")
    return True


# ── Core scrape logic ──────────────────────────────────────────────────────────

async def run_scrape(headless: bool | None = None) -> list[dict]:
    use_headless = HEADLESS if headless is None else headless
    logger.info("Starting scrape — location=%s headless=%s", SEARCH_LOCATION, use_headless)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=use_headless)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            )
        )
        page = await context.new_page()

        try:
            logger.info("Navigating to %s", TARGET_URL)
            await page.goto(TARGET_URL, wait_until="networkidle", timeout=60_000)

            # ── Fill location ──────────────────────────────────────────────────
            loc_input = page.locator("input[name='location']").first
            if await loc_input.count() == 0:
                # Fallback: try text inputs near 'location' label
                loc_input = page.locator("input[type='text']").first
            await loc_input.fill(SEARCH_LOCATION)
            logger.info("Filled location: %s", SEARCH_LOCATION)

            # ── Solve CAPTCHA + submit (retry loop on invalid captcha) ────────
            MAX_CAPTCHA_ATTEMPTS = 5
            submitted = False
            for captcha_attempt in range(1, MAX_CAPTCHA_ATTEMPTS + 1):
                captcha_el = await _find_captcha_element(page)
                if captcha_el is None:
                    logger.warning("No CAPTCHA image found — attempting submit without it")
                else:
                    img_bytes = await _screenshot_element(page, captcha_el)
                    solved_text = await captcha_mod.solve_image_captcha(img_bytes, max_retries=2)
                    captcha_input_filled = await _fill_captcha_input(page, solved_text)
                    if not captcha_input_filled:
                        logger.error("Cannot fill CAPTCHA input — aborting")
                        return []

                # Submit
                submit_selectors = [
                    "input[type='submit']",
                    "button[type='submit']",
                    "input[value*='Search']",
                    "button:has-text('Search')",
                    "input[value*='search']",
                ]
                for sel in submit_selectors:
                    el = page.locator(sel).first
                    if await el.count() > 0:
                        await el.click()
                        submitted = True
                        logger.info("Clicked submit via: %s", sel)
                        break
                if not submitted:
                    logger.error("Could not find submit button")
                    return []

                await page.wait_for_load_state("networkidle")

                # Save debug screenshot on every CAPTCHA attempt
                debug_dir = Path(OUTPUT_DIR)
                debug_dir.mkdir(parents=True, exist_ok=True)
                debug_shot = debug_dir / f"debug_attempt_{captcha_attempt}.png"
                await page.screenshot(path=str(debug_shot), full_page=True)
                logger.info("Saved screenshot -> %s", debug_shot)

                content = await page.content()
                if "invalid captcha" in content.lower() or "correct captcha" in content.lower():
                    logger.warning(
                        "Invalid CAPTCHA (attempt %d/%d) — retrying with fresh image",
                        captcha_attempt, MAX_CAPTCHA_ATTEMPTS,
                    )
                    if captcha_attempt == MAX_CAPTCHA_ATTEMPTS:
                        logger.error("CAPTCHA failed %d times — giving up", MAX_CAPTCHA_ATTEMPTS)
                        return []
                    continue
                # CAPTCHA accepted — move on
                logger.info("CAPTCHA accepted on attempt %d", captcha_attempt)
                break

            # ── No-results check ───────────────────────────────────────────────
            content = await page.content()
            if "no records found" in content.lower() or "no tender found" in content.lower():
                logger.warning("No tenders found for location '%s'", SEARCH_LOCATION)
                return []

            # ── Paginate and collect all rows ──────────────────────────────────
            all_tenders: list[dict] = []
            page_num = 1

            while True:
                html = await _get_page_html(page)
                rows = tender_parser.extract_rows(html, location=SEARCH_LOCATION)
                logger.info("Page %d: extracted %d rows", page_num, len(rows))
                all_tenders.extend(rows)

                if not await _go_next_page(page):
                    logger.info("No more pages after page %d", page_num)
                    break
                page_num += 1

            logger.info("Total rows from all pages: %d — fetching amounts from detail pages", len(all_tenders))

            # ── Visit each detail page to get tender amount ────────────────────
            detail_page = await context.new_page()
            dumped_detail = False
            for i, tender in enumerate(all_tenders):
                url = tender.pop("_detailUrl", None)
                if not url:
                    continue
                try:
                    await detail_page.goto(url, wait_until="networkidle", timeout=30_000)
                    detail_html = await detail_page.content()

                    # Dump first detail page for debugging
                    if not dumped_detail:
                        dp = Path(OUTPUT_DIR) / "debug_detail_page.html"
                        dp.write_text(detail_html, encoding="utf-8")
                        await detail_page.screenshot(path=str(Path(OUTPUT_DIR) / "debug_detail_page.png"), full_page=True)
                        logger.info("Dumped first detail page -> %s", dp)
                        dumped_detail = True

                    amount = tender_parser.extract_amount_from_detail_html(detail_html)
                    tender["amount"] = amount
                    logger.info("Row %d/%d: amount='%s' | %s", i + 1, len(all_tenders), amount, tender["name"][:60])
                except Exception as exc:
                    logger.warning("Could not fetch detail for row %d: %s", i + 1, exc)

            await detail_page.close()
            logger.info("Amount fetch complete")
            return all_tenders

        finally:
            await browser.close()


# ── Export wrapper ─────────────────────────────────────────────────────────────

async def scrape_and_export(headless: bool | None = None) -> None:
    tenders = await run_scrape(headless=headless)
    if not tenders:
        logger.warning("No tenders to export")
        return

    daily_path = await exporter.write_daily(tenders, OUTPUT_DIR)
    active_path = await exporter.rebuild_active(OUTPUT_DIR, SEARCH_LOCATION)
    logger.info("Export complete → daily: %s | active: %s", daily_path, active_path)

    # Print first 3 rows as a preview
    import json
    preview = tenders[:3]
    logger.info("Preview (first 3 rows):\n%s", json.dumps(preview, indent=2, ensure_ascii=False))


def _job() -> None:
    asyncio.run(scrape_and_export())


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> None:
    _setup_logging()

    parser = argparse.ArgumentParser(description="Noida tender scraper")
    parser.add_argument(
        "--run-now",
        action="store_true",
        help="Run the scrape immediately instead of waiting for the schedule",
    )
    parser.add_argument(
        "--headless",
        dest="headless",
        type=lambda v: v.lower() not in ("false", "0", "no"),
        default=None,
        help="Override HEADLESS env var (true/false)",
    )
    args = parser.parse_args()

    if args.run_now:
        logger.info("--run-now flag detected, executing immediately")
        asyncio.run(scrape_and_export(headless=args.headless))
        return

    scheduler = BlockingScheduler(timezone="Asia/Kolkata")
    trigger = CronTrigger(
        hour=SCHEDULE_HOUR,
        minute=SCHEDULE_MINUTE,
        timezone="Asia/Kolkata",
    )
    scheduler.add_job(_job, trigger, id="tender_scrape", name="Noida Tender Scrape")

    next_run = scheduler.get_jobs()[0].next_run_time
    logger.info(
        "Scheduler started. Next run: %s (IST %02d:%02d)",
        next_run,
        SCHEDULE_HOUR,
        SCHEDULE_MINUTE,
    )

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Scheduler stopped")


if __name__ == "__main__":
    main()
