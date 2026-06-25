// Bridge AI — LinkedIn profile extractor (content script).
// Runs on linkedin.com/in/* pages. Zero AI, pure DOM parsing.
//
// Modern LinkedIn is a Server-Driven-UI (SDUI) React app: CSS classes are
// hashed/obfuscated (`_0d982122`, `_6a6de872`) and CHANGE between deploys, and
// cards lazy-load on scroll. So we anchor on STABLE signals only:
//   • `componentkey` attributes  (e.g. ...ExperienceTopLevelSection, entity-collection-item-…)
//   • `data-testid`              (e.g. expandable-text-box for descriptions)
//   • document order + content regexes (duration/year patterns)
// We NEVER match on hashed class names.

import type { LinkedInProfile, LinkedInExperience, LinkedInEducation, LinkedInPost, ExtractResult, ConnectResult } from './types';

// ── Generic text helpers ───────────────────────────────────────────────────────

/** Trimmed visible text of an element, with "…more"/"see more" buttons stripped. */
function cleanText(el: Element | null | undefined): string {
  if (!el) return '';
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('button').forEach((b) => b.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Ordered, de-duplicated text of every <p> directly belonging to an entry,
 *  EXCLUDING the description paragraph (which holds the expandable-text-box). */
function entryParagraphs(entry: Element): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of entry.querySelectorAll('p')) {
    if (p.querySelector('[data-testid="expandable-text-box"]')) continue; // description — handled separately
    const t = cleanText(p);
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

/** The long free-text description of an entry, if present. */
function entryDescription(entry: Element): string | undefined {
  const el = entry.querySelector('[data-testid="expandable-text-box"]');
  const t = cleanText(el);
  return t || undefined;
}

/** Strip tracking params → canonical "https://www.linkedin.com/company/7426/" form. */
function cleanUrl(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const u = new URL(href, window.location.origin);
    return u.origin + u.pathname;
  } catch {
    return href;
  }
}

// ── Section + entry finding (SDUI-aware) ────────────────────────────────────────

/** Find a profile section by semantic keyword.
 *
 *  IMPORTANT: matching is PRECISE on purpose. The Featured section's item
 *  componentkeys literally contain substrings like "itemProfileEducationUrn" and
 *  "activityUrn", so a loose `componentkey.includes(keyword)` match wrongly returns
 *  the Featured card — and because Featured renders before Education/Activity, a
 *  pre-render race made Education capture Featured posts (which a refresh "fixed").
 *  We therefore match ONLY on the section heading text and the canonical SDUI card
 *  componentkey, never on arbitrary substrings. */
function findSection(keyword: string): Element | null {
  const kw = keyword.toLowerCase();

  // 1. Heading text exact match → its enclosing SDUI card (<section>). Most precise:
  //    each card has exactly one <h2> ("Education", "Featured", "Activity", …).
  for (const h of document.querySelectorAll('h2, h3')) {
    if ((h.textContent ?? '').trim().toLowerCase() === kw) {
      return h.closest('section') ?? h.parentElement?.closest('section') ?? h.parentElement;
    }
  }

  // 2. Canonical SDUI card componentkey, e.g. "com.linkedin.sdui.profile.card.…Education"
  //    or "…EducationTopLevelSection". Requires the profile-card prefix so Featured
  //    ITEM urns (which merely contain the word) can never match.
  for (const el of document.querySelectorAll('section[componentkey], div[componentkey]')) {
    const key = (el.getAttribute('componentkey') ?? '').toLowerCase();
    if (key.includes(kw + 'toplevelsection')) return el;
    if (key.includes('profile.card') && key.includes(kw) && !key.includes('urn(')) return el;
  }

  // 3. The card's own "Show all <kw>…" CTA or a details/page link → enclosing card.
  //    Precise (these CTAs only exist in the matching card), so it can't catch Featured.
  for (const a of document.querySelectorAll('a[href], a[aria-label]')) {
    const al = (a.getAttribute('aria-label') ?? '').toLowerCase();
    const href = (a.getAttribute('href') ?? '').toLowerCase();
    if ((al.startsWith('show all') && al.includes(kw)) || href.includes(`/details/${kw}`) || href.includes(`/${kw}/page/`)) {
      const sec = a.closest('section');
      if (sec) return sec;
    }
  }

  // 4. Legacy id fallback.
  return document.getElementById(keyword);
}

/** Drop any candidate that is nested inside another candidate (keep outermost only). */
function outermost(cands: Element[]): Element[] {
  return cands.filter((e) => !cands.some((o) => o !== e && o.contains(e)));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Top-level entry rows inside a section (drops nested sub-entries). */
function listEntries(section: Element): Element[] {
  // 1. Experience / positions: explicit `entity-collection-item-…` wrappers.
  const named = Array.from(section.querySelectorAll('[componentkey^="entity-collection-item"]'));
  if (named.length) return outermost(named);

  // 2. Education (and similar lists): each entry is a <div> whose componentkey is a
  //    bare UUID. Inner logo links there carry NO componentkey, so filtering UUID-keyed
  //    <div>s with at least one paragraph yields exactly the entry blocks.
  const uuidEntries = Array.from(section.querySelectorAll('div[componentkey]')).filter(
    (e) => UUID_RE.test(e.getAttribute('componentkey') ?? '') && e.querySelector('p'),
  );
  if (uuidEntries.length) return outermost(uuidEntries);

  // 3. Legacy fallbacks (older LinkedIn DOM).
  const li = Array.from(section.querySelectorAll('li[class*="pvs-list__item"], li.artdeco-list__item'));
  if (li.length) return li;
  return Array.from(section.querySelectorAll('li')).filter((e) => (e.textContent?.trim().length ?? 0) > 5);
}

// ── Name + top-card ─────────────────────────────────────────────────────────────

function extractName(): string {
  // 1. <h1> if present (older DOM).
  const h1 = cleanText(document.querySelector('h1'));
  if (h1.length > 1) return h1;

  // 2. Page <title>: "(20) Mehmet Sengulen, CPA | LinkedIn" → strip count, take before "|".
  const title = document.title.replace(/^\(\d+\)\s*/, '');
  const first = title.split(/\s*\|\s*/)[0]?.trim() ?? '';
  if (first && !/linkedin/i.test(first)) return first;

  // 3. og:title.
  const og = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content ?? '';
  const ogName = og.split(/\s*[|–-]\s*/)[0]?.trim() ?? '';
  if (ogName && !/linkedin/i.test(ogName)) return ogName;

  // 4. Top-card heading.
  const topcard = document.querySelector('[componentkey*="opcard"]');
  const h2 = cleanText(topcard?.querySelector('h1, h2'));
  if (h2.length > 1) return h2;

  return '';
}

const CONNECTIONS_RE = /\b\d[\d,]*\+?\s+(connections|followers)\b/i;
const LOCATION_HINT_RE = /(,\s*[A-Z]{2}\b|United States|United Kingdom|Area|Metropolitan|India|Canada|Australia|Singapore|Germany|France|Greater\b)/;
const TOPCARD_NOISE_RE = /^(He\/Him|She\/Her|They\/Them|Contact info|·|Message|Follow|Connect|More|Open to|Add profile section|Enhance profile|Resources|Show all|Save to PDF)$/i;

function extractTopCard() {
  const name = extractName();
  const topcard =
    document.querySelector('[componentkey*="opcard"]') ??
    document.querySelector('main section') ??
    document.body;

  const firstName = name.split(/[\s,]+/)[0] ?? '';
  let photoUrl: string | undefined;
  if (firstName) {
    const img = topcard.querySelector<HTMLImageElement>(`img[alt*="${firstName}"]`);
    if (img?.src && !/blur/i.test(img.src)) photoUrl = img.src;
  }

  // Leaf text blocks NOT inside an <a> — this excludes the company/school "chips"
  // (which are links) so the headline isn't mistaken for an employer/school name.
  const blocks: string[] = [];
  const seen = new Set<string>();
  for (const el of topcard.querySelectorAll('p, span, div')) {
    if (el.closest('a')) continue;                       // skip chip/link text
    if (el.querySelector('p, span, div, a')) continue;   // leaf nodes only
    const t = cleanText(el);
    if (t && t.length <= 220 && !seen.has(t)) { seen.add(t); blocks.push(t); }
  }

  const isNoise = (t: string) =>
    t === name || CONNECTIONS_RE.test(t) || /^\d+(st|nd|rd|th)\b/i.test(t) || TOPCARD_NOISE_RE.test(t);

  const location = blocks.find(
    (t) => t !== name && LOCATION_HINT_RE.test(t) && !CONNECTIONS_RE.test(t) && t.length < 80,
  ) ?? '';

  // Headline = first substantial non-noise leaf block (the text-body-medium line
  // right under the name), excluding the location.
  const headline = blocks.find((t) => !isNoise(t) && t !== location && t.length > 8) ?? '';

  return { name, headline, location, photoUrl };
}

// ── Experience ──────────────────────────────────────────────────────────────────

// Matches a LinkedIn duration line: "Feb 2015 - Present · 11 yrs 5 mos", "2 yrs", "3 yrs 10 mos".
const DURATION_RE =
  /(\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s*[-–]\s*(Present|\w{3,9}\s+\d{4}))|(\b\d+\s+yrs?\b)|(\b\d+\s+mos?\b)/i;
const BULLET_SPLIT_RE = /^(.+?)\s*·\s*(.+)$/;

function parseExperience(section: Element): LinkedInExperience[] {
  const result: LinkedInExperience[] = [];

  for (const entry of listEntries(section)) {
    const ps = entryParagraphs(entry);
    const durIdx = ps.findIndex((t) => DURATION_RE.test(t));
    if (durIdx < 0) continue; // header/anchor row, not a real position

    const title = ps[0] ?? '';
    if (!title) continue;

    let company = ps[1] ?? '';
    let companyType: string | undefined;
    const m = BULLET_SPLIT_RE.exec(company);
    if (m) { company = m[1].trim(); companyType = m[2].trim(); }

    const duration = ps[durIdx];
    // Location = the line right after duration, if it isn't itself a duration.
    const next = ps[durIdx + 1];
    const location = next && !DURATION_RE.test(next) ? next : undefined;
    const description = entryDescription(entry)?.slice(0, 400);
    const companyUrl = cleanUrl(entry.querySelector<HTMLAnchorElement>('a[href*="/company/"]')?.href);

    result.push({ title, company, companyType, companyUrl, duration, location, description });
  }

  return result;
}

// ── Education ────────────────────────────────────────────────────────────────────

const DEGREE_FIELD_RE = /^(.+?)\s*[-–·,]\s*(.+)$/;
const YEARS_RE = /\b(19|20)\d{2}\s*[-–]\s*((19|20)\d{2}|Present)\b/;

function parseEducation(section: Element): LinkedInEducation[] {
  const result: LinkedInEducation[] = [];

  for (const entry of listEntries(section)) {
    const ps = entryParagraphs(entry);
    if (!ps[0]) continue;
    const school = ps[0];

    let degree: string | undefined, field: string | undefined, years: string | undefined;
    for (const t of ps.slice(1)) {
      if (!years && YEARS_RE.test(t)) { years = t; continue; }
      if (!degree) {
        const m = DEGREE_FIELD_RE.exec(t);
        if (m) { degree = m[1].trim(); field = m[2].trim(); } else degree = t;
      }
    }
    const schoolUrl = cleanUrl(entry.querySelector<HTMLAnchorElement>('a[href*="/school/"]')?.href);
    result.push({ school, schoolUrl, degree, field, years });
  }

  return result;
}

// ── Services ───────────────────────────────────────────────────────────────────────
// The "Services" section lists offerings (e.g. "Tax Advisory", "Audit"). These
// become tags on the Bridge person entity. LinkedIn renders them either as entry
// cards or as a single comma/·-separated subtitle line under the heading.

function parseServices(section: Element): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const t = raw.trim();
    if (t && t.length <= 60 && !seen.has(t) && !/^(services|show all|show all services)$/i.test(t)) {
      seen.add(t); out.push(t);
    }
  };

  // 1. PRIMARY: each service is a short <p>. Skip the section description (it holds
  //    the expandable-text-box) and the "Show all" link text (a <span> inside <a>).
  for (const p of section.querySelectorAll('p')) {
    if (p.querySelector('[data-testid="expandable-text-box"]')) continue; // description
    if (p.closest('a')) continue;                                          // "Show all" link
    push(cleanText(p));
  }
  if (out.length) return out.slice(0, 30);

  // 2. Fallback: entry cards (entity-collection / UUID-keyed), one service each.
  for (const entry of listEntries(section)) {
    const t = entryParagraphs(entry)[0];
    if (t) push(t);
  }
  if (out.length) return out.slice(0, 30);

  // 3. Fallback: a single "A · B · C" / "A, B, C" subtitle line.
  for (const el of section.querySelectorAll('span')) {
    const t = cleanText(el);
    if (t && /[·,]/.test(t) && t.length < 200 && !/^services$/i.test(t)) {
      t.split(/\s*[·,]\s*/).forEach(push);
      if (out.length) break;
    }
  }

  return out.slice(0, 30);
}

// ── About ────────────────────────────────────────────────────────────────────────

function parseAbout(section: Element): string {
  // SDUI stores the about copy in an expandable-text-box.
  const exp = cleanText(section.querySelector('[data-testid="expandable-text-box"]'));
  if (exp) return exp.slice(0, 2000);

  // Fallback: the longest paragraph/span in the section.
  let best = '';
  for (const el of section.querySelectorAll('p, span')) {
    const t = cleanText(el);
    if (t.length > best.length) best = t;
  }
  return best.slice(0, 2000);
}

// ── Activity (recent posts) ────────────────────────────────────────────────────────

const POST_URL_RE = /(feed\/update|\/posts\/|activity[:-]?\d|urn:li:activity)/i;
const POST_META_RE = /\b(reposted|posted|liked|commented on|shared)\b.*\bthis\b|^\s*\d+\s*(d|w|mo|h|yr)\b/i;

function parseActivity(section: Element): LinkedInPost[] {
  const posts: LinkedInPost[] = [];
  const seen = new Set<string>();

  // Link-only: collect distinct post permalinks (no post text by design).
  for (const a of section.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (!POST_URL_RE.test(a.href)) continue;
    const url = cleanUrl(a.href);
    if (!url || seen.has(url)) continue;
    seen.add(url);

    // Optional context line ("… reposted this", "2w") from the post's wrapper.
    let meta: string | undefined;
    const wrap = a.closest('[componentkey]') ?? a.parentElement;
    if (wrap) {
      for (const el of wrap.querySelectorAll('span, p')) {
        const t = cleanText(el);
        if (t && t.length < 60 && POST_META_RE.test(t)) { meta = t; break; }
      }
    }

    posts.push({ url, meta });
    if (posts.length >= 3) break;
  }

  return posts;
}

// ── Golden-gate detection ─────────────────────────────────────────────────────────

/** LinkedIn blurs full profiles when the VIEWER hasn't added a job/school.
 *  When that happens, section data is ABSENT from the DOM. */
function goldenGatePresent(): boolean {
  if (document.querySelector('[componentkey*="GoldenGate"]')) return true;
  const body = document.body.innerText;
  return /one step away from viewing this profile|Add a job or school to continue/i.test(body);
}

// ── Main extract ───────────────────────────────────────────────────────────────────

function extract(): ExtractResult {
  const urlMatch = window.location.href.match(/linkedin\.com\/in\/([^/?#]+)/);
  if (!urlMatch) return { ok: false, error: 'Not a LinkedIn profile page.' };

  const handle = urlMatch[1];
  const { name, headline, location, photoUrl } = extractTopCard();

  if (!name) {
    const titleText = document.title;
    return {
      ok: false,
      error: `Could not find profile name.\n\nDebug:\n• page title: "${titleText}"\n\nScroll the profile to the top, let it fully render, then click the extension again.`,
    };
  }

  const expSection = findSection('experience');
  const eduSection = findSection('education');
  const servicesSection = findSection('services') ?? findSection('service');
  const aboutSection = findSection('about') ?? findSection('summary');
  const activitySection = findSection('activity');

  const experience = expSection ? parseExperience(expSection) : [];
  const education = eduSection ? parseEducation(eduSection) : [];
  const services = servicesSection ? parseServices(servicesSection) : [];
  const aboutRaw = aboutSection ? parseAbout(aboutSection) : '';
  const posts = activitySection ? parseActivity(activitySection) : [];

  // Headline is appended to the TOP of the About section (no separate field).
  const about = [headline, aboutRaw].filter(Boolean).join('\n\n').slice(0, 2200);

  const totalSections = experience.length + education.length + services.length;
  const gated = totalSections === 0 && goldenGatePresent();

  const currentCompany = experience[0]?.company;
  const currentSchool = education[0]?.school;

  const profile: LinkedInProfile = {
    url: `https://www.linkedin.com/in/${handle}`,
    handle,
    name,
    headline,
    location,
    about,
    experience,
    education,
    services,
    posts,
    photoUrl,
    currentCompany,
    currentSchool,
    gated,
    extractedAt: new Date().toISOString(),
  };

  return { ok: true, profile };
}

// ── Message listener ───────────────────────────────────────────────────────────────
// The background worker scrolls the tab with TRUSTED wheel events (chrome.debugger) to
// lazy-load Experience/Education BEFORE sending this message, so we just read the DOM.
// (Content-script JS cannot generate trusted scroll, so scrolling lives in the worker.)

// ── Connection-send routine ─────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Find a visible button/anchor whose trimmed text or aria-label matches `label` (case-insensitive). */
function findByLabel(label: string): HTMLElement | null {
  const want = label.toLowerCase();
  const els = document.querySelectorAll<HTMLElement>('button, a[role="button"], div[role="button"]');
  for (const el of els) {
    const aria = (el.getAttribute('aria-label') ?? '').toLowerCase();
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (aria === want || aria.startsWith(want + ' ') || text === want) {
      if (el.offsetParent !== null) return el; // visible
    }
  }
  return null;
}

async function sendConnectionRequest(note: string): Promise<ConnectResult> {
  // 1. Already connected / pending? No actionable Connect entry point.
  // 2. Primary Connect button, else open the "More" overflow and find Connect there.
  let connect = findByLabel('Connect');
  if (!connect) {
    const more = findByLabel('More actions') ?? findByLabel('More');
    if (more) { more.click(); await sleep(600); connect = findByLabel('Connect'); }
  }
  if (!connect) {
    // Distinguish "already connected/pending" from a DOM miss.
    if (findByLabel('Pending') || findByLabel('Message')) return { ok: true, status: 'already_connected' };
    return { ok: false, status: 'error', detail: 'Connect button not found' };
  }
  connect.click();
  await sleep(900);

  // 3. "Add a note" in the invitation modal.
  const addNote = findByLabel('Add a note');
  if (!addNote) {
    // Some accounts hit the monthly free-invite-note limit → no note box.
    return { ok: false, status: 'note_unavailable', detail: 'Add-a-note unavailable' };
  }
  addNote.click();
  await sleep(600);

  // 4. Fill the note textarea (respect its maxlength).
  const ta = document.querySelector<HTMLTextAreaElement>('textarea#custom-message, textarea[name="message"]');
  if (!ta) return { ok: false, status: 'error', detail: 'note textarea not found' };
  const max = ta.maxLength > 0 ? ta.maxLength : 300;
  ta.focus();
  ta.value = note.slice(0, max);
  ta.dispatchEvent(new Event('input', { bubbles: true })); // let React see the value
  await sleep(300);

  // 5. Send.
  const send = findByLabel('Send invitation') ?? findByLabel('Send') ?? findByLabel('Send now');
  if (!send) return { ok: false, status: 'error', detail: 'Send button not found' };
  // Weekly invite cap surfaces as a blocking dialog after click.
  send.click();
  await sleep(1000);
  const body = document.body.innerText;
  if (/you've reached the weekly invitation limit|reached the weekly limit/i.test(body)) {
    return { ok: false, status: 'soft_block', detail: 'weekly invite limit' };
  }
  return { ok: true, status: 'sent' };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'BRIDGE_EXTRACT') {
    sendResponse(extract());
    return true;
  }
  if (msg?.type === 'BRIDGE_CONNECT') {
    sendConnectionRequest(String(msg.note ?? '')).then(sendResponse).catch((e) =>
      sendResponse({ ok: false, status: 'error', detail: e instanceof Error ? e.message : 'connect failed' }),
    );
    return true; // keep the message channel open for the async response
  }
  return true;
});
