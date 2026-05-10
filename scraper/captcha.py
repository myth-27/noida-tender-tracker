import asyncio
import base64
import logging
import os
import re

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

_client: AsyncOpenAI | None = None

_PROMPT = (
    "This is a CAPTCHA image from a government tender portal. "
    "The CAPTCHA contains only standard ASCII letters (A-Z, a-z) and digits (0-9). "
    "Some characters may have lines or marks through them — read them as their closest "
    "ASCII letter or digit equivalent. "
    "Return ONLY those characters as a single unbroken string with no spaces, "
    "no punctuation, no hyphens, no explanation. Nothing else."
)


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        api_key = os.getenv("OPENAI_API_KEY", "")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set in environment")
        _client = AsyncOpenAI(api_key=api_key)
    return _client


async def solve_image_captcha(image_bytes: bytes, max_retries: int = 3) -> str:
    """Send CAPTCHA image bytes to GPT-4o mini, return solved text. Retries up to max_retries times."""
    client = _get_client()
    b64 = base64.b64encode(image_bytes).decode()

    for attempt in range(1, max_retries + 1):
        try:
            logger.info("CAPTCHA solve attempt %d/%d (gpt-4o)", attempt, max_retries)
            response = await client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{b64}",
                                },
                            },
                            {
                                "type": "text",
                                "text": _PROMPT,
                            },
                        ],
                    }
                ],
                max_tokens=20,
            )
            raw = response.choices[0].message.content.strip()
            # Keep only ASCII alphanumeric — model sometimes returns Greek/symbols for
            # distorted characters with crossing lines
            text = re.sub(r"[^A-Za-z0-9]", "", raw)
            logger.info("CAPTCHA solved: raw='%s' cleaned='%s'", raw, text)
            return text
        except Exception as exc:
            logger.warning("CAPTCHA attempt %d failed: %s", attempt, exc)
            if attempt == max_retries:
                raise RuntimeError(
                    f"CAPTCHA solving failed after {max_retries} attempts"
                ) from exc
            await asyncio.sleep(2)

    raise RuntimeError("Unreachable")
