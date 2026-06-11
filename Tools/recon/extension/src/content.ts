// Bridge AI — LinkedIn profile extractor (content script).
// Runs on linkedin.com/in/* pages. Zero AI, pure DOM parsing.

import type { LinkedInProfile, LinkedInExperience, LinkedInEducation, ExtractResult } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function visibleTexts(container: Element): string[] {
  return Array.from(container.querySelectorAll('span[aria-hidden="true"]'))
    .map((el) => el.textContent?.trim() ?? '')
    .filter(Boolean);
}

function sectionAfter(anchorId: string): Element | null {
  // LinkedIn sections have an <a id="experience"> anchor before the section
  const anchor = document.getElementById(anchorId);
  if (!anchor) return null;
  let el: Element | null = anchor;
  while (el && el.tagName !== 'SECTION') el = el.parentElement;
  return el ?? null;
}

function listItems(section: Element): Element[] {
  return Array.from(section.querySelectorAll('li.artdeco-list__item, li.pvs-list__paged-list-item'));
}

// ── Experience parser ─────────────────────────────────────────────────────────
// LinkedIn text sequence per experience item (aria-hidden spans, top-down):
//   [0] Role title  OR  Company (if multi-role block)
//   [1] Company · Employment type   OR  Date range
//   [2] Date range · Duration
//   [3] Location (optional)
//   [4+] Description (optional)

const DURATION_RE = /(\w{3} \d{4}|Present|Current)\s*[-–]\s*(\w{3} \d{4}|Present|Current)/i;
const BULLET_COMPANY_RE = /^(.+?)\s*·\s*(.+)$/;

function parseExperience(section: Element): LinkedInExperience[] {
  const items = listItems(section);
  const result: LinkedInExperience[] = [];

  for (const item of items) {
    const texts = visibleTexts(item);
    if (texts.length < 2) continue;

    // Detect if this is a multi-role company block (first text has no "·")
    const isCompanyBlock = !DURATION_RE.test(texts[1] ?? '') && !BULLET_COMPANY_RE.test(texts[1] ?? '');
    if (isCompanyBlock && texts.length >= 3) {
      // Skip company header rows — LinkedIn nests roles as child items
      continue;
    }

    const title = texts[0] ?? '';
    let company = '';
    let companyType: string | undefined;
    let duration = '';
    let location: string | undefined;
    let descStart = 3;

    const companyMatch = BULLET_COMPANY_RE.exec(texts[1] ?? '');
    if (companyMatch) {
      company = companyMatch[1].trim();
      companyType = companyMatch[2].trim();
    } else {
      company = texts[1] ?? '';
    }

    const durationMatch = DURATION_RE.exec(texts[2] ?? '') ? texts[2] : DURATION_RE.exec(texts[1] ?? '') ? texts[1] : '';
    if (durationMatch) {
      duration = durationMatch;
    }

    // texts[3] is location if it doesn't look like a duration
    if (texts[3] && !DURATION_RE.test(texts[3])) {
      location = texts[3];
      descStart = 4;
    }

    const description = texts.slice(descStart).join(' ').slice(0, 500) || undefined;

    if (title) {
      result.push({ title, company, companyType, duration, location, description });
    }
  }

  return result;
}

// ── Education parser ──────────────────────────────────────────────────────────
// LinkedIn text sequence per education item:
//   [0] School name
//   [1] Degree · Field   OR  just Degree
//   [2] Years (optional)

const DEGREE_FIELD_RE = /^(.+?)\s*[-–·,]\s*(.+)$/;
const YEARS_RE = /^\d{4}\s*[-–]\s*(\d{4}|Present)$/;

function parseEducation(section: Element): LinkedInEducation[] {
  const items = listItems(section);
  const result: LinkedInEducation[] = [];

  for (const item of items) {
    const texts = visibleTexts(item);
    if (!texts[0]) continue;

    const school = texts[0];
    let degree: string | undefined;
    let field: string | undefined;
    let years: string | undefined;

    const degreeRaw = texts[1] ?? '';
    const dfMatch = DEGREE_FIELD_RE.exec(degreeRaw);
    if (dfMatch) {
      degree = dfMatch[1].trim();
      field = dfMatch[2].trim();
    } else if (degreeRaw && !YEARS_RE.test(degreeRaw)) {
      degree = degreeRaw;
    }

    const yearsCandidate = texts[2] ?? texts[1] ?? '';
    if (YEARS_RE.test(yearsCandidate)) years = yearsCandidate;

    result.push({ school, degree, field, years });
  }

  return result;
}

// ── Skills parser ─────────────────────────────────────────────────────────────

function parseSkills(section: Element): string[] {
  const skills: string[] = [];
  const items = listItems(section);
  for (const item of items) {
    const texts = visibleTexts(item);
    if (texts[0]) skills.push(texts[0]);
  }
  return skills.slice(0, 50);
}

// ── About ─────────────────────────────────────────────────────────────────────

function parseAbout(section: Element): string {
  const spans = section.querySelectorAll('span[aria-hidden="true"]');
  for (const span of spans) {
    const text = span.textContent?.trim() ?? '';
    if (text.length > 20) return text.slice(0, 2000);
  }
  return '';
}

// ── Top-card fields ───────────────────────────────────────────────────────────

function extractTopCard() {
  const name = document.querySelector('h1')?.textContent?.trim() ?? '';

  // Headline: first .text-body-medium.break-words near top
  const headline =
    document.querySelector('.pv-top-card .text-body-medium')?.textContent?.trim() ??
    document.querySelector('.text-body-medium.break-words')?.textContent?.trim() ??
    '';

  // Location: small muted text below headline
  const location =
    document.querySelector('.pv-top-card .pb2 span.text-body-small')?.textContent?.trim() ??
    document.querySelector('span.text-body-small.inline.t-black--light')?.textContent?.trim() ??
    '';

  return { name, headline, location };
}

// ── Main extract ──────────────────────────────────────────────────────────────

function extract(): ExtractResult {
  const urlMatch = window.location.href.match(/linkedin\.com\/in\/([^/?#]+)/);
  if (!urlMatch) {
    return { ok: false, error: 'Not a LinkedIn profile page' };
  }

  const handle = urlMatch[1];
  const { name, headline, location } = extractTopCard();

  if (!name) {
    return { ok: false, error: 'Profile not loaded yet — please wait for the page to fully render' };
  }

  const aboutSection = sectionAfter('about');
  const expSection = sectionAfter('experience');
  const eduSection = sectionAfter('education');
  const skillsSection = sectionAfter('skills');

  const profile: LinkedInProfile = {
    url: `https://www.linkedin.com/in/${handle}`,
    handle,
    name,
    headline,
    location,
    about: aboutSection ? parseAbout(aboutSection) : '',
    experience: expSection ? parseExperience(expSection) : [],
    education: eduSection ? parseEducation(eduSection) : [],
    skills: skillsSection ? parseSkills(skillsSection) : [],
    extractedAt: new Date().toISOString(),
  };

  return { ok: true, profile };
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'BRIDGE_EXTRACT') {
    sendResponse(extract());
  }
  return true;
});
