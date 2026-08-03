// Canonical social URL normalisation.
//
// Problems this solves:
//  • http vs https          → always https
//  • m.instagram.com        → instagram.com
//  • mobile.twitter.com     → twitter.com (pre-rebrand)
//  • x.com vs twitter.com   → unified as x.com
//  • www. prefix            → stripped for most platforms
//  • trailing slash         → stripped
//  • query strings          → stripped (?hl=en, ?lang=en, utm_*, etc.)
//  • LinkedIn /pub/ → /in/  → normalised to /in/
//  • Instagram /p/ or /reel → not a profile URL, rejected
//  • Case                   → lowercase handle

const PLATFORM_HOSTS: Record<string, string[]> = {
  twitter:   ['twitter.com', 'x.com', 'mobile.twitter.com', 'www.twitter.com', 'www.x.com', 't.co'],
  linkedin:  ['linkedin.com', 'www.linkedin.com', 'lnkd.in'],
  instagram: ['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am'],
  github:    ['github.com', 'www.github.com'],
  facebook:  ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.com', 'www.fb.com'],
  youtube:   ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
  tiktok:    ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com'],
  mastodon:  [], // variable hosts — handled by path pattern
};

/** Returns the canonical platform key for a URL, or null if unrecognised. */
export function platformKey(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const [plat, hosts] of Object.entries(PLATFORM_HOSTS)) {
      if (hosts.includes(host)) return plat;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Normalise a social profile URL to its canonical form.
 * Returns null if the URL is not a recognised profile URL (e.g. it's a post or reel).
 */
export function canonicalSocialUrl(raw: string): string | null {
  let url: URL;
  try {
    // Prepend scheme if missing
    const s = raw.trim();
    url = new URL(s.startsWith('http') ? s : `https://${s}`);
  } catch {
    return null;
  }

  // Always https
  url.protocol = 'https:';
  // Strip query string and fragment
  url.search = '';
  url.hash = '';

  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, ''); // strip trailing slash

  // ── Twitter / X ────────────────────────────────────────────────────────────
  if (PLATFORM_HOSTS.twitter.includes(host)) {
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) return null;
    const handle = parts[0].toLowerCase();
    if (['hashtag', 'i', 'intent', 'search', 'home', 'explore', 'notifications', 'messages'].includes(handle)) return null;
    return `https://x.com/${handle}`;
  }

  // ── LinkedIn ───────────────────────────────────────────────────────────────
  if (PLATFORM_HOSTS.linkedin.includes(host)) {
    // /pub/name/x/y/z → /in/name
    const inMatch = path.match(/\/(?:in|pub)\/([^/]+)/i);
    if (!inMatch) return null;
    const handle = inMatch[1].toLowerCase();
    return `https://www.linkedin.com/in/${handle}`;
  }

  // ── Instagram ──────────────────────────────────────────────────────────────
  if (PLATFORM_HOSTS.instagram.includes(host)) {
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) return null;
    // Reject non-profile paths: /p/, /reel/, /tv/, /stories/
    if (['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'tags', 'accounts'].includes(parts[0].toLowerCase())) return null;
    return `https://instagram.com/${parts[0].toLowerCase()}`;
  }

  // ── GitHub ─────────────────────────────────────────────────────────────────
  if (PLATFORM_HOSTS.github.includes(host)) {
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) return null;
    if (['orgs', 'sponsors', 'login', 'join', 'features', 'marketplace', 'topics', 'explore'].includes(parts[0].toLowerCase())) return null;
    const handle = parts[0].toLowerCase();
    return `https://github.com/${handle}`;
  }

  // ── Facebook ───────────────────────────────────────────────────────────────
  if (PLATFORM_HOSTS.facebook.includes(host)) {
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) return null;
    if (['pages', 'groups', 'events', 'marketplace', 'watch', 'gaming'].includes(parts[0].toLowerCase())) return null;
    if (parts[0].toLowerCase() === 'profile.php') {
      const id = url.searchParams.get('id');
      return id ? `https://facebook.com/profile.php?id=${id}` : null;
    }
    return `https://facebook.com/${parts[0].toLowerCase()}`;
  }

  // ── YouTube ────────────────────────────────────────────────────────────────
  if (PLATFORM_HOSTS.youtube.includes(host)) {
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) return null;
    if (parts[0].toLowerCase() === 'watch') return null; // video, not profile
    if (['channel', 'c', 'user', '@'].includes(parts[0].toLowerCase()) && parts[1]) {
      return `https://youtube.com/@${parts[1].replace(/^@/, '').toLowerCase()}`;
    }
    if (parts[0].startsWith('@')) {
      return `https://youtube.com/${parts[0].toLowerCase()}`;
    }
    return null;
  }

  // ── TikTok ─────────────────────────────────────────────────────────────────
  if (PLATFORM_HOSTS.tiktok.includes(host)) {
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) return null;
    if (parts[0].toLowerCase() === 'video') return null;
    const handle = parts[0].toLowerCase().startsWith('@') ? parts[0] : `@${parts[0]}`;
    return `https://tiktok.com/${handle.toLowerCase()}`;
  }

  return null;
}

/** Extract a short display handle from a canonical profile URL. */
export function handleFromCanonical(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    return path.split('/').filter(Boolean).pop() ?? url;
  } catch {
    return url;
  }
}
