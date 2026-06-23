"""Website scraping utilities using requests + BeautifulSoup."""
from __future__ import annotations

import requests
from bs4 import BeautifulSoup


def scrape_website(url: str) -> str:
    """Download a webpage and return visible text only.

    Strips <script>, <style>, and <noscript> tags so we only index
    content that is actually rendered for the user.
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0 Safari/537.36"
        )
    }
    response = requests.get(url, headers=headers, timeout=15)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    for tag in soup(["script", "style", "noscript", "iframe"]):
        tag.decompose()

    return " ".join(soup.stripped_strings)
