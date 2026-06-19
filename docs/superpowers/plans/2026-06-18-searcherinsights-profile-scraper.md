# SearcherInsights Profile Enrichment Scraper

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrape all 1,299 SearcherInsights profiles for bio, LinkedIn, and website; then scrape each website's people pages (team/leadership/partners) and link discovered people back to the originating profile.

**Architecture:** A single Python async script using `aiohttp` for concurrent HTTP (rate-limited to 10 req/s), regex-based HTML parsing (no heavy deps), writing output back into the existing `searcherinsights_network.xlsx`. Profile scraping runs first (all 1,299 URLs), then website team-page scraping runs on the deduplicated set of discovered websites. Each team-page person row carries a `source_name` + `source_url` column linking them to the original Excel entry.

**Tech Stack:** Python 3.11+, `aiohttp`, `openpyxl`, `re` (stdlib), `asyncio` — all already available on the machine.

---

## Field extraction map (per profile type)

All types share `class="gspb_meta_value"` divs in order. Extract by scanning all hrefs:

| Field | How to extract |
|---|---|
| Bio | `gspb_meta_value[0]` — strip HTML tags |
| LinkedIn | First `href` matching `linkedin\.com` anywhere in the profile HTML |
| Website | First `href` not matching `searcherinsights`, `linkedin`, `facebook`, `twitter`, `instagram`, `wp-`, `#`, `javascript:` |

Bankers/Brokers also expose: `gspb_meta_value[6]` = contact person name, `[7]` = contact title.

## Team-page candidate paths (try in order, stop on first 200)

```
/team  /team/  /about/team  /about-us/team
/people  /leadership  /management
/about  /about-us  /our-team  /partners  /investors  /staff
/who-we-are  /meet-the-team
```

## File structure

```
My Data/ETA/
  searcherinsights_network.xlsx        ← existing file (modified in-place)
  scraper/
    scrape_profiles.py                 ← Task 1-3: profile scraper
    scrape_websites.py                 ← Task 4-5: website team-page scraper
    run_all.py                         ← Task 6: orchestrator entry point
    utils.py                           ← shared helpers (clean_html, extract_links)
```

---

## Task 1: Shared utilities (`utils.py`)

**Files:**
- Create: `My Data/ETA/scraper/utils.py`

- [ ] **Step 1: Write the file**

```python
import re

SI_SKIP = re.compile(
    r'searcherinsights\.com|linkedin\.com|facebook\.com|twitter\.com|'
    r'instagram\.com|javascript:|#|mailto:|tel:|wp-content|wp-includes',
    re.I
)

def clean_html(html: str) -> str:
    """Strip all HTML tags and collapse whitespace."""
    text = re.sub(r'<[^>]+>', ' ', html)
    text = re.sub(r'&amp;', '&', text)
    text = re.sub(r'&nbsp;', ' ', text)
    text = re.sub(r'&#8217;', "'", text)
    text = re.sub(r'&#8220;|&#8221;', '"', text)
    text = re.sub(r'&[a-z]+;', '', text)
    return re.sub(r'\s+', ' ', text).strip()

def extract_meta_values(html: str) -> list[str]:
    """Return list of cleaned text from gspb_meta_value divs."""
    raw = re.findall(r'class="gspb_meta_value[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
    return [clean_html(v) for v in raw]

def extract_linkedin(html: str) -> str:
    """First linkedin.com URL from the page."""
    m = re.search(r'href="(https?://(?:www\.)?linkedin\.com/in/[^"]+)"', html, re.I)
    if not m:
        m = re.search(r'href="(https?://(?:www\.)?linkedin\.com/company/[^"]+)"', html, re.I)
    return m.group(1).rstrip('/') if m else ''

def extract_website(html: str) -> str:
    """First non-social, non-SI external href."""
    hrefs = re.findall(r'href="(https?://[^"]+)"', html)
    for h in hrefs:
        if not SI_SKIP.search(h):
            # Strip query strings, normalise
            return h.split('?')[0].rstrip('/')
    return ''

def normalize_url(url: str) -> str:
    """Lowercase scheme+host, keep path."""
    url = url.strip().rstrip('/')
    if not url.startswith('http'):
        url = 'https://' + url
    return url
```

- [ ] **Step 2: Quick smoke test (run in terminal)**

```bash
cd "/Users/vikasbadami/Documents/Workspace/Relationship OS/My Data/ETA/scraper"
python3 -c "
from utils import clean_html, extract_linkedin, extract_website
sample = '<div class=\"gspb_meta_value\">Dan Calano &amp; partner</div>'
sample_html = 'href=\"https://www.linkedin.com/in/dcalano/\" href=\"https://www.groupercompanies.com/\"'
assert clean_html(sample) == ''          # just the inner — not this call
assert extract_linkedin(sample_html) == 'https://www.linkedin.com/in/dcalano'
assert extract_website(sample_html) == 'https://www.groupercompanies.com'
print('utils OK')
"
```
Expected: `utils OK`

---

## Task 2: Profile scraper — fetch & parse (`scrape_profiles.py`)

**Files:**
- Create: `My Data/ETA/scraper/scrape_profiles.py`

- [ ] **Step 1: Write the scraper**

```python
"""
Scrapes all SearcherInsights profile pages.
Reads URLs from the Excel, writes bio/linkedin/website back in-place.
"""
import asyncio, re, sys
from pathlib import Path
import aiohttp
import openpyxl
from openpyxl.styles import Font
sys.path.insert(0, str(Path(__file__).parent))
from utils import extract_meta_values, extract_linkedin, extract_website, normalize_url

EXCEL = Path(__file__).parent.parent / "searcherinsights_network.xlsx"
CONCURRENCY = 10          # max simultaneous requests
DELAY_PER_REQ = 0.12      # ~8 req/s sustained
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html",
}

async def fetch(session: aiohttp.ClientSession, url: str, sem: asyncio.Semaphore) -> str:
    async with sem:
        await asyncio.sleep(DELAY_PER_REQ)
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as r:
                if r.status == 200:
                    return await r.text(errors='replace')
                return ''
        except Exception:
            return ''

def parse_profile(html: str) -> dict:
    if not html or 'Page Not Found' in html:
        return {'bio': '', 'linkedin': '', 'website': ''}
    vals = extract_meta_values(html)
    bio = vals[0] if vals else ''
    linkedin = extract_linkedin(html)
    website = extract_website(html)
    if website:
        website = normalize_url(website)
    return {'bio': bio, 'linkedin': linkedin, 'website': website}

async def scrape_all():
    wb = openpyxl.load_workbook(EXCEL)
    LINK_FONT = Font(color="0563C1", underline="single")

    sem = asyncio.Semaphore(CONCURRENCY)
    connector = aiohttp.TCPConnector(ssl=False, limit=CONCURRENCY)
    async with aiohttp.ClientSession(headers=HEADERS, connector=connector) as session:

        sheets_to_scrape = [s for s in wb.sheetnames
                            if s not in ('Overview',)]

        for sheet_name in sheets_to_scrape:
            ws = wb[sheet_name]
            if ws.max_row <= 1:
                continue

            # Ensure header columns exist: Bio(D), LinkedIn(E), Website(F)
            # Existing cols: Name(A), URL(B), Category(C)
            for col, label in [(4, 'Bio'), (5, 'LinkedIn'), (6, 'Website')]:
                if ws.cell(1, col).value != label:
                    ws.cell(1, col).value = label
                    from openpyxl.styles import PatternFill
                    ws.cell(1, col).fill = PatternFill("solid", fgColor="1F3864")
                    ws.cell(1, col).font = Font(bold=True, color="FFFFFF")

            # Collect (row_index, url) pairs
            tasks = []
            for row in range(2, ws.max_row + 1):
                url = ws.cell(row, 2).value
                if url:
                    tasks.append((row, url))

            print(f"\n[{sheet_name}] Scraping {len(tasks)} profiles...")
            urls = [t[1] for t in tasks]
            htmls = await asyncio.gather(*[fetch(session, u, sem) for u in urls])

            for (row, url), html in zip(tasks, htmls):
                data = parse_profile(html)
                ws.cell(row, 4).value = data['bio']
                ws.cell(row, 5).value = data['linkedin']
                if data['linkedin']:
                    ws.cell(row, 5).hyperlink = data['linkedin']
                    ws.cell(row, 5).font = LINK_FONT
                ws.cell(row, 6).value = data['website']
                if data['website']:
                    ws.cell(row, 6).hyperlink = data['website']
                    ws.cell(row, 6).font = LINK_FONT

            # Auto-width bio column
            ws.column_dimensions['D'].width = 60
            ws.column_dimensions['E'].width = 45
            ws.column_dimensions['F'].width = 40

            done = sum(1 for _, html in zip(tasks, htmls) if html and 'Page Not Found' not in html)
            print(f"  → {done}/{len(tasks)} valid profiles parsed")

    wb.save(EXCEL)
    print(f"\n✓ Saved: {EXCEL}")

if __name__ == '__main__':
    asyncio.run(scrape_all())
```

- [ ] **Step 2: Install aiohttp if needed**

```bash
pip3 install aiohttp --quiet
```

- [ ] **Step 3: Run a 5-profile smoke test (edit CONCURRENCY=2, slice tasks[:5] temporarily)**

Comment `tasks = tasks[:5]` temporarily after "Collect (row_index, url)" for quick validation:

```bash
cd "/Users/vikasbadami/Documents/Workspace/Relationship OS/My Data/ETA/scraper"
python3 scrape_profiles.py
```
Expected output: `[Searchers] Scraping 5 profiles...` → `5/5 valid profiles parsed` → `✓ Saved:`

- [ ] **Step 4: Open Excel and verify 5 rows have bio, linkedin, website filled**

- [ ] **Step 5: Remove the `[:5]` slice and run for real**

```bash
python3 scrape_profiles.py
```
Expected: All sheets processed, total ~1,299 profiles, runtime ~3–5 min.

---

## Task 3: Collect unique websites from enriched Excel

This is done inside `scrape_websites.py` — it reads the Excel after Task 2 and builds a mapping `{website_url: [(person_name, profile_url, sheet_name)]}`.

No separate step needed — handled in Task 4 below.

---

## Task 4: Website team-page scraper (`scrape_websites.py`)

**Files:**
- Create: `My Data/ETA/scraper/scrape_websites.py`

- [ ] **Step 1: Write the scraper**

```python
"""
For each unique website found in the Excel (col F = Website),
detect and scrape people pages (/team, /leadership, etc.).
Extracts person name, title, LinkedIn, bio snippet.
Writes results to a new 'Website People' sheet in the Excel.
"""
import asyncio, re, sys
from pathlib import Path
from urllib.parse import urljoin, urlparse
import aiohttp
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
sys.path.insert(0, str(Path(__file__).parent))
from utils import clean_html, extract_linkedin, normalize_url

EXCEL = Path(__file__).parent.parent / "searcherinsights_network.xlsx"
CONCURRENCY = 8
DELAY = 0.15
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
}

PEOPLE_PATHS = [
    '/team', '/team/', '/our-team', '/our-team/',
    '/people', '/people/', '/leadership', '/leadership/',
    '/management', '/management/', '/about/team', '/about-us/team',
    '/partners', '/partners/', '/investors', '/staff',
    '/who-we-are', '/meet-the-team', '/about', '/about-us',
]

NAME_RE = re.compile(
    r'(?:(?:alt|title|aria-label)="([A-Z][a-z]+(?: [A-Z][a-z\']+)+)"'
    r'|<h[1-4][^>]*>([A-Z][a-z]+(?: [A-Z][a-z\']+){1,4})</h[1-4]>'
    r'|class="[^"]*(?:name|person|member|title)[^"]*"[^>]*>([A-Z][a-z]+(?: [A-Z][a-z\']+){1,4})<)',
    re.DOTALL
)
TITLE_RE = re.compile(
    r'(?:class="[^"]*(?:role|position|title|job)[^"]*"[^>]*>([^<]{5,80})<'
    r'|<(?:p|span|div)[^>]*>([A-Z][^<]{5,60}(?:Partner|Director|Managing|CEO|CFO|VP|Head|Officer|Manager|Associate|Analyst|Principal|Founder|President))[^<]*<)',
    re.I | re.DOTALL
)

async def fetch(session, url, sem):
    async with sem:
        await asyncio.sleep(DELAY)
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=12),
                                   allow_redirects=True, max_redirects=3) as r:
                if r.status == 200 and 'text/html' in r.headers.get('content-type', ''):
                    return await r.text(errors='replace')
                return None
        except Exception:
            return None

async def find_people_page(session, base_url: str, sem) -> tuple[str, str]:
    """Return (path_tried, html) for first working people page."""
    for path in PEOPLE_PATHS:
        url = urljoin(base_url + '/', path.lstrip('/'))
        html = await fetch(session, url, sem)
        if html and len(html) > 3000:  # real page, not redirect-to-home
            # Verify it has person-like content
            has_people = bool(re.search(
                r'(?:linkedin\.com|class="[^"]*(?:team|person|member|staff)[^"]*"'
                r'|(?:CEO|CFO|Partner|Director|Founder|Managing))',
                html, re.I
            ))
            if has_people:
                return url, html
    return '', ''

def extract_people_from_html(html: str, source_url: str) -> list[dict]:
    """
    Heuristic extraction of people from a team/leadership page.
    Returns list of {name, title, linkedin, bio, source_url}.
    """
    people = []
    seen_names = set()

    # Strategy: find all linkedin profile links — each typically anchors one person
    linkedin_blocks = re.finditer(
        r'href="(https?://(?:www\.)?linkedin\.com/in/[^"]+)"', html, re.I
    )

    for m in linkedin_blocks:
        li_url = m.group(1).rstrip('/')
        start = max(0, m.start() - 1500)
        end = min(len(html), m.end() + 500)
        block = html[start:end]

        # Find name: look for heading-like element or alt text near the link
        name = ''
        for nm in NAME_RE.finditer(block):
            candidate = next((g for g in nm.groups() if g), '')
            candidate = clean_html(candidate).strip()
            if 3 < len(candidate) < 50 and candidate not in seen_names:
                name = candidate
                break

        # Find title
        title = ''
        for tm in TITLE_RE.finditer(block):
            candidate = next((g for g in tm.groups() if g), '')
            candidate = clean_html(candidate).strip()
            if 3 < len(candidate) < 100:
                title = candidate
                break

        if name and name not in seen_names:
            seen_names.add(name)
            # Small bio snippet: text around linkedin mention minus HTML
            bio_raw = clean_html(block)
            # Trim to ~300 chars around the linkedin href
            bio = re.sub(r'\s+', ' ', bio_raw)[:300].strip()
            people.append({
                'name': name,
                'title': title,
                'linkedin': li_url,
                'bio': bio,
                'people_page': source_url,
            })

    # Fallback: if no linkedin links found, try structured name blocks
    if not people:
        for nm in NAME_RE.finditer(html):
            candidate = next((g for g in nm.groups() if g), '')
            candidate = clean_html(candidate).strip()
            if 3 < len(candidate) < 50 and candidate not in seen_names:
                seen_names.add(candidate)
                people.append({
                    'name': candidate,
                    'title': '',
                    'linkedin': '',
                    'bio': '',
                    'people_page': source_url,
                })

    return people

async def scrape_websites():
    wb = openpyxl.load_workbook(EXCEL)

    # Collect website → [(person_name, profile_url, category)] from all sheets
    website_map: dict[str, list[tuple]] = {}
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        if sheet_name in ('Overview',) or ws.max_row <= 1:
            continue
        for row in range(2, ws.max_row + 1):
            name = ws.cell(row, 1).value or ''
            profile_url = ws.cell(row, 2).value or ''
            website = ws.cell(row, 6).value or ''
            if website and website.startswith('http'):
                website = normalize_url(website)
                website_map.setdefault(website, []).append((name, profile_url, sheet_name))

    print(f"Found {len(website_map)} unique websites to scan")

    sem = asyncio.Semaphore(CONCURRENCY)
    connector = aiohttp.TCPConnector(ssl=False, limit=CONCURRENCY)

    all_results: list[dict] = []

    async with aiohttp.ClientSession(headers=HEADERS, connector=connector) as session:
        tasks = list(website_map.items())

        async def process_site(website, owners):
            people_page_url, html = await find_people_page(session, website, sem)
            if not html:
                return []
            people = extract_people_from_html(html, people_page_url)
            # Tag each person with the originating SI profile(s)
            for p in people:
                p['source_company_site'] = website
                # Multiple SI profiles may share the same website (e.g. a fund's website)
                p['source_si_names'] = '; '.join(o[0] for o in owners)
                p['source_si_urls'] = '; '.join(o[1] for o in owners)
                p['source_categories'] = '; '.join(set(o[2] for o in owners))
            return people

        results = await asyncio.gather(*[process_site(w, o) for w, o in tasks])
        for r in results:
            all_results.extend(r)

    print(f"Extracted {len(all_results)} people from website people pages")

    # Write 'Website People' sheet
    if 'Website People' in wb.sheetnames:
        del wb['Website People']
    ws_wp = wb.create_sheet('Website People')

    NAVY = PatternFill("solid", fgColor="1F3864")
    HDR = Font(bold=True, color="FFFFFF")
    LINK_FONT = Font(color="0563C1", underline="single")
    GRAY = PatternFill("solid", fgColor="F2F2F2")

    cols = ['Name', 'Title', 'LinkedIn', 'Bio', 'People Page URL',
            'Source Company Site', 'Source SI Names', 'Source SI Profile URLs', 'Source Categories']
    widths = [30, 35, 45, 60, 45, 35, 40, 55, 20]

    for ci, (col, w) in enumerate(zip(cols, widths), 1):
        c = ws_wp.cell(1, ci, col)
        c.fill = NAVY; c.font = HDR
        c.alignment = Alignment(horizontal="center")
        ws_wp.column_dimensions[get_column_letter(ci)].width = w

    for ri, person in enumerate(all_results, 2):
        row_vals = [
            person.get('name', ''),
            person.get('title', ''),
            person.get('linkedin', ''),
            person.get('bio', ''),
            person.get('people_page', ''),
            person.get('source_company_site', ''),
            person.get('source_si_names', ''),
            person.get('source_si_urls', ''),
            person.get('source_categories', ''),
        ]
        for ci, val in enumerate(row_vals, 1):
            c = ws_wp.cell(ri, ci, val)
            if ci == 3 and val:   # LinkedIn
                c.hyperlink = val; c.font = LINK_FONT
            elif ci in (5, 6) and val:  # URLs
                c.hyperlink = val; c.font = LINK_FONT
            elif ri % 2 == 0:
                c.fill = GRAY

    wb.save(EXCEL)
    print(f"✓ Saved 'Website People' sheet → {EXCEL}")
    print(f"  Total website people rows: {len(all_results)}")

if __name__ == '__main__':
    asyncio.run(scrape_websites())
```

- [ ] **Step 2: Smoke test with 3 websites**

Edit `tasks = list(website_map.items())[:3]` temporarily, then:

```bash
cd "/Users/vikasbadami/Documents/Workspace/Relationship OS/My Data/ETA/scraper"
python3 scrape_websites.py
```
Expected: `Found N unique websites` → `Extracted X people from website people pages` → `✓ Saved`

- [ ] **Step 3: Verify sheet in Excel — open and check 'Website People' tab has name, linkedin, source columns**

- [ ] **Step 4: Remove `[:3]` slice and run for real**

---

## Task 5: Orchestrator (`run_all.py`)

**Files:**
- Create: `My Data/ETA/scraper/run_all.py`

- [ ] **Step 1: Write the orchestrator**

```python
"""Entry point: run profile scraper then website scraper."""
import asyncio, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

print("=== Step 1/2: Scraping SearcherInsights profiles ===")
import scrape_profiles
asyncio.run(scrape_profiles.scrape_all())

print("\n=== Step 2/2: Scraping website people pages ===")
import scrape_websites
asyncio.run(scrape_websites.scrape_websites())

print("\n✓ All done.")
```

- [ ] **Step 2: Run full pipeline end-to-end**

```bash
cd "/Users/vikasbadami/Documents/Workspace/Relationship OS/My Data/ETA/scraper"
python3 run_all.py
```

Expected runtime: ~5–8 min total (profiles ~3–5 min, websites ~2–3 min).

Expected output:
```
=== Step 1/2: Scraping SearcherInsights profiles ===
[Searchers] Scraping 223 profiles... → 190+/223 valid profiles parsed
[Investors] Scraping 200 profiles... → ...
[Investor Groups] Scraping 102 profiles... → ...
[Bankers & Brokers] Scraping 774 profiles... → ...
✓ Saved: .../searcherinsights_network.xlsx

=== Step 2/2: Scraping website people pages ===
Found N unique websites to scan
Extracted X people from website people pages
✓ Saved 'Website People' sheet
```

- [ ] **Step 3: Open `searcherinsights_network.xlsx` and verify**

- Searchers sheet: columns A–F, bio/linkedin/website filled for most rows
- Website People sheet: name, title, linkedin, source columns all populated
- Click a `source_si_urls` link — it should open the correct SearcherInsights profile

---

## Self-Review

**Spec coverage:**
- ✅ Extract bio, linkedin, website for each person → Task 2
- ✅ For each website scrape team/people pages → Task 4
- ✅ Link back each website person to the originating SI profile → `source_si_names` + `source_si_urls` cols in Website People sheet
- ✅ Minimize token usage — pure Python HTTP + regex, no LLM calls
- ✅ All 4 person types covered (Searchers, Investors, Investor Groups, Bankers/Brokers)
- ✅ Deduplicates websites before scanning (1 fetch per domain, not per person)

**No placeholders:** All code is complete and runnable.

**Type consistency:** `normalize_url`, `extract_linkedin`, `extract_website` defined in `utils.py` Task 1 and imported consistently in Tasks 2 and 4.
