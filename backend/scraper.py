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


def web_search(query: str) -> list[dict]:
    """Search Google (with DuckDuckGo fallback) and return title, URL, and snippet of top matches."""
    import urllib.parse

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    }
    encoded_query = urllib.parse.quote(query)
    
    # 1. Attempt Google Search
    google_url = f"https://www.google.com/search?q={encoded_query}&hl=en"
    try:
        response = requests.get(google_url, headers=headers, timeout=10)
        results = []
        
        if response.ok:
            soup = BeautifulSoup(response.text, "html.parser")
            # Google's desktop search results container
            for g in soup.find_all("div", class_="tF2Cxc"):
                a = g.find("a")
                h3 = g.find("h3")
                if not a or not h3:
                    continue

                title = h3.get_text(strip=True)
                href = a.get("href", "")
                
                snippet_div = g.find("div", class_="VwiC3b")
                snippet = snippet_div.get_text(strip=True) if snippet_div else ""

                if href and title:
                    results.append({
                        "title": title,
                        "url": href,
                        "snippet": snippet,
                    })
                    if len(results) >= 4:
                        break
    except Exception as exc:
        print(f"[scraper] Google search attempt failed: {exc}")
        results = []

    # 2. Fallback to DuckDuckGo if Google returns nothing (often blocked by Captcha)
    if not results:
        print(f"[scraper] Falling back to DuckDuckGo for query: {query}")
        ddg_url = f"https://html.duckduckgo.com/html/?q={encoded_query}"
        try:
            response = requests.get(ddg_url, headers=headers, timeout=10)
            if response.ok:
                soup = BeautifulSoup(response.text, "html.parser")
                for res in soup.find_all("div", class_="result"):
                    a = res.find("a", class_="result__a")
                    snippet_el = res.find("a", class_="result__snippet")
                    if not a:
                        continue

                    href = a.get("href", "")
                    if "/l/?" in href:
                        parsed = urllib.parse.urlparse(href)
                        query_params = urllib.parse.parse_qs(parsed.query)
                        uddg = query_params.get("uddg")
                        if uddg:
                            href = uddg[0]

                    title = a.get_text(strip=True)
                    snippet = snippet_el.get_text(strip=True) if snippet_el else ""

                    if href and title:
                        results.append({
                            "title": title,
                            "url": href,
                            "snippet": snippet,
                        })
                        if len(results) >= 4:
                            break
        except Exception as exc:
            print(f"[scraper] DuckDuckGo fallback failed: {exc}")

    return results

