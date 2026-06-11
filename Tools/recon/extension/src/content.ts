// Bridge AI — LinkedIn profile extractor (content script).
// Runs on linkedin.com/in/* pages. Zero AI, pure DOM parsing.

import type { LinkedInProfile, LinkedInExperience, LinkedInEducation, ExtractResult } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Visible text from an element: prefers aria-hidden spans (LinkedIn pattern),
 *  strips .visually-hidden children, falls back to full textContent. */
function visibleText(el: Element): string {
  // Clone so we can strip visually-hidden without mutating the real DOM
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('.visually-hidden, .sr-only, [aria-hidden="false"]')
    .forEach((n) => n.remove());

  // Prefer the first aria-hidden="true" span (LinkedIn's pattern for displayed text)
  const ariaSpan = clone.querySelector('span[aria-hidden="true"]');
  if (ariaSpan?.textContent?.trim()) return ariaSpan.textContent.trim();

  return clone.textContent?.trim() ?? '';
}

/** All aria-hidden visible texts inside a container, deduplicated. */
function visibleTexts(container: Element): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const span of container.querySelectorAll('span[aria-hidden="true"]')) {
    const t = span.textContent?.trim() ?? '';
    if (t && !seen.has(t)) { seen.add(t); results.push(t); }
  }
  return results;
}

// ── Section finding ───────────────────────────────────────────────────────────
// LinkedIn has changed how it marks sections over time. We try multiple strategies.

function findSection(id: string): Element | null {
  // Strategy 1: <a id="experience"> inside a section (pre-2023 pattern)
  const anchor = document.getElementById(id);
  if (anchor) {
    let el: Element | null = anchor;
    while (el && el.tagName !== 'SECTION') el = el.parentElement;
    if (el) return el;
  }

  // Strategy 2: <section> whose heading text matches (2023+ pattern)
  const label = id.charAt(0).toUpperCase() + id.slice(1);
  for (const section of document.querySelectorAll('section')) {
    const heading = section.querySelector('h2, h3');
    if (heading?.textContent?.toLowerCase().includes(id.toLowerCase()) ||
        heading?.textContent?.includes(label)) {
      return section;
    }
  }

  // Strategy 3: div with data-view-name containing the section id
  const dvn = document.querySelector(`[data-view-name*="${id}"]`);
  if (dvn) {
    let el: Element | null = dvn;
    while (el && el.tagName !== 'SECTION') el = el.parentElement;
    if (el) return el;
  }

  return null;
}

function listItems(section: Element): Element[] {
  // Try <li> first, then <div class="pvs-entity"> wrappers
  const lis = Array.from(section.querySelectorAll('li.artdeco-list__item, li.pvs-list__paged-list-item, li[class*="pvs-list"]'));
  if (lis.length) return lis;
  return Array.from(section.querySelectorAll('div.pvs-entity'));
}

// ── Name extraction ───────────────────────────────────────────────────────────

function extractName(): string {
  // Strategy 1: h1 containing the name (may have visually-hidden child)
  const h1 = document.querySelector('h1');
  if (h1) {
    const clone = h1.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.visually-hidden, .sr-only').forEach((n) => n.remove());
    const t = clone.textContent?.trim() ?? '';
    if (t && t.length > 1) return t;
  }

  // Strategy 2: aria-hidden span directly inside h1
  const h1AriaSpan = document.querySelector('h1 span[aria-hidden="true"]');
  if (h1AriaSpan?.textContent?.trim()) return h1AriaSpan.textContent.trim();

  // Strategy 3: page <title> — LinkedIn titles are "Name - Headline | LinkedIn"
  const titleParts = document.title.split(/\s*[\|–-]\s*/);
  if (titleParts.length >= 2 && !titleParts[0].includes('LinkedIn')) {
    return titleParts[0].trim();
  }

  // Strategy 4: OG meta
  const og = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
  if (og?.content) {
    return og.content.split(/\s*[\|–-]\s*/)[0].trim();
  }

  // Strategy 5: broadest fallback — any element with these common LinkedIn classes
  for (const sel of [
    '.pv-top-card--list .text-heading-xlarge',
    '.artdeco-entity-lockup__title',
    '[data-anonymize="person-name"]',
  ]) {
    const el = document.querySelector(sel);
    const t = el?.textContent?.trim() ?? '';
    if (t) return t;
  }

  return '';
}

// ── Top-card ──────────────────────────────────────────────────────────────────

function extractTopCard() {
  const name = extractName();

  // Headline: second text block under top card (after name)
  const headlineCandidates = [
    '.text-body-medium.break-words',
    '.pv-top-card .text-body-medium',
    '.ph5 .text-body-medium',
    '[data-anonymize="headline"]',
  ];
  let headline = '';
  for (const sel of headlineCandidates) {
    const el = document.querySelector(sel);
    if (el) { headline = visibleText(el); if (headline) break; }
  }

  // Location
  const locationCandidates = [
    'span.text-body-small.inline.t-black--light.break-words',
    '.pv-top-card__non-self-link-container span.t-black--light',
    '[data-anonymize="location"]',
    '.ph5 .pb2 span.t-black--light',
  ];
  let location = '';
  for (const sel of locationCandidates) {
    const el = document.querySelector(sel);
    if (el) { location = visibleText(el); if (location) break; }
  }

  return { name, headline, location };
}

// ── Experience ────────────────────────────────────────────────────────────────

const DURATION_RE = /(\w{3} \d{4}|Present|Current)\s*[-–]\s*(\w{3} \d{4}|Present|Current)/i;
const BULLET_SPLIT_RE = /^(.+?)\s*·\s*(.+)$/;

function parseExperience(section: Element): LinkedInExperience[] {
  const items = listItems(section);
  const result: LinkedInExperience[] = [];

  for (const item of items) {
    const texts = visibleTexts(item);
    if (texts.length < 2) continue;

    // Skip company-header rows (no duration in texts[1])
    const hasDuration = texts.some((t) => DURATION_RE.test(t));
    if (!hasDuration) continue;

    const title = texts[0] ?? '';
    let company = '', companyType: string | undefined, duration = '', location: string | undefined;

    const companyMatch = BULLET_SPLIT_RE.exec(texts[1] ?? '');
    if (companyMatch) {
      company = companyMatch[1].trim();
      companyType = companyMatch[2].trim();
    } else {
      company = texts[1] ?? '';
    }

    // Find duration and location among remaining texts
    for (const t of texts.slice(2)) {
      if (DURATION_RE.test(t) && !duration) { duration = t; continue; }
      if (!location && t.length < 80 && !DURATION_RE.test(t)) location = t;
    }

    const descIdx = texts.findIndex((t, i) => i > 1 && t !== duration && t !== location && t.length > 40);
    const description = descIdx >= 0 ? texts[descIdx].slice(0, 400) : undefined;

    if (title) result.push({ title, company, companyType, duration, location, description });
  }

  return result;
}

// ── Education ─────────────────────────────────────────────────────────────────

const DEGREE_FIELD_RE = /^(.+?)\s*[-–·,]\s*(.+)$/;
const YEARS_RE = /^\d{4}\s*[-–]\s*(\d{4}|Present)$/;

function parseEducation(section: Element): LinkedInEducation[] {
  const items = listItems(section);
  const result: LinkedInEducation[] = [];
  for (const item of items) {
    const texts = visibleTexts(item);
    if (!texts[0]) continue;
    const school = texts[0];
    let degree: string | undefined, field: string | undefined, years: string | undefined;
    const degreeRaw = texts[1] ?? '';
    const dfMatch = DEGREE_FIELD_RE.exec(degreeRaw);
    if (dfMatch) { degree = dfMatch[1].trim(); field = dfMatch[2].trim(); }
    else if (degreeRaw && !YEARS_RE.test(degreeRaw)) degree = degreeRaw;
    const yearsCandidate = texts[2] ?? texts[1] ?? '';
    if (YEARS_RE.test(yearsCandidate)) years = yearsCandidate;
    result.push({ school, degree, field, years });
  }
  return result;
}

// ── Skills ────────────────────────────────────────────────────────────────────

function parseSkills(section: Element): string[] {
  const skills: string[] = [];
  for (const item of listItems(section)) {
    const t = visibleTexts(item)[0];
    if (t) skills.push(t);
  }
  return skills.slice(0, 50);
}

// ── About ─────────────────────────────────────────────────────────────────────

function parseAbout(section: Element): string {
  // Look for the longest aria-hidden span (the about text)
  let best = '';
  for (const span of section.querySelectorAll('span[aria-hidden="true"]')) {
    const t = span.textContent?.trim() ?? '';
    if (t.length > best.length) best = t;
  }
  return best.slice(0, 2000);
}

// ── Main extract ──────────────────────────────────────────────────────────────

function extract(): ExtractResult {
  const urlMatch = window.location.href.match(/linkedin\.com\/in\/([^/?#]+)/);
  if (!urlMatch) return { ok: false, error: 'Not a LinkedIn profile page.' };

  const handle = urlMatch[1];
  const { name, headline, location } = extractTopCard();

  if (!name) {
    // Return debug info so the user can report what's missing
    const h1Text = document.querySelector('h1')?.textContent?.trim() ?? '(no h1)';
    const titleText = document.title;
    return {
      ok: false,
      error: `Could not find profile name.\n\nDebug:\n• h1 text: "${h1Text}"\n• page title: "${titleText}"\n\nTry scrolling down to fully load the page, then click the extension again.`,
    };
  }

  const profile: LinkedInProfile = {
    url: `https://www.linkedin.com/in/${handle}`,
    handle,
    name,
    headline,
    location,
    about:      parseAbout(findSection('about') ?? document.body),
    experience: parseExperience(findSection('experience') ?? document.createElement('div')),
    education:  parseEducation(findSection('education') ?? document.createElement('div')),
    skills:     parseSkills(findSection('skills') ?? document.createElement('div')),
    extractedAt: new Date().toISOString(),
  };

  return { ok: true, profile };
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'BRIDGE_EXTRACT') {
    sendResponse(extract());
  }
  return true;
});
