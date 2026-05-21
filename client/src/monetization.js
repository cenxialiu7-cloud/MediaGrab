/**
 * Monetization config — affiliate URLs, ad zones, donation links.
 *
 * Replace the placeholder values below with your real IDs/URLs from:
 *   - NordVPN affiliate dashboard       → https://nordvpn.com/affiliate/
 *   - Surfshark affiliate dashboard     → https://surfshark.com/affiliates
 *   - PropellerAds publisher dashboard  → https://propellerads.com/
 *   - Adsterra publisher dashboard      → https://adsterra.com/
 *   - Ko-fi page                        → https://ko-fi.com/
 *
 * Any field left blank ('') hides the corresponding component automatically.
 * No real keys/IDs are committed to this file — keep secrets in MONETIZATION.md
 * or environment variables for production builds.
 */

// ─────────────────────────────────────────────────────────────────────────────
// VPN affiliate offers — used by SponsorBar.jsx
// SponsorBar rotates through the enabled offers if there are multiple.
// ─────────────────────────────────────────────────────────────────────────────
export const VPN_OFFERS = [
  {
    name: 'NordVPN',
    // TODO: replace YOUR_REF with your NordVPN affiliate code
    url:  '',  // e.g. 'https://go.nordvpn.net/aff_c?offer_id=15&aff_id=YOUR_REF'
    headline: '解鎖地區限制影片 · Unlock region-restricted videos',
    subtext:  'NordVPN 限時 68% 折扣',
    badge:    '⚡ 限時優惠',
  },
  {
    name: 'Surfshark',
    url:  '',  // e.g. 'https://get.surfshark.net/aff_c?offer_id=926&aff_id=YOUR_REF'
    headline: '保護下載隱私 · Protect your download privacy',
    subtext:  'Surfshark VPN 86% 折扣',
    badge:    '🔒 隱私首選',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Ad zone configuration — used by AdSlot.jsx
// Each slot is identified by a name; AdSlot looks up which network + zone
// to load. Set scriptSrc to a real ad-zone script URL to activate.
// ─────────────────────────────────────────────────────────────────────────────
export const AD_ZONES = {
  // Shown on the Smart tab welcome screen (before user pastes URL)
  'smart-welcome': {
    network: 'adsterra',
    scriptSrc: '',  // e.g. '//pl12345678.profitableratecpm.com/abc...js'
    containerId: 'ad-smart-welcome',
    height: 90,
  },
  // Shown when download queue is empty
  'queue-empty': {
    network: 'propellerads',
    scriptSrc: '',  // e.g. '//inpagepush.com/400/12345678'
    containerId: 'ad-queue-empty',
    height: 250,
  },
  // Shown at the bottom of Settings panel
  'settings-bottom': {
    network: 'adsterra',
    scriptSrc: '',
    containerId: 'ad-settings-bottom',
    height: 90,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Clickable sponsored links (e.g. Adsterra Smartlink / Direct Link).
//
// HOW TO GET AN ADSTERRA SMARTLINK (for desktop apps with no public website):
//   1. Log in to https://beta.publishers.adsterra.com/links
//   2. Click the green "ADD SMARTLINK" button
//   3. Name it (e.g. "MediaGrab App"), pick a category, remove unwanted ad types
//   4. Click "COPY LINK" — you'll get a URL like:
//        https://www.profitableratecpm.com/xxxxxxxx?key=xxxxx
//   5. Paste that URL below into `adsterraSmartlink`.
//
// NOTE: Adsterra *banner* ad-units (the AD_ZONES scriptSrc below) require a
// verified public website and will NOT pay for localhost impressions, so for
// this desktop app the Smartlink is the realistic Adsterra option.
//
// These are shown as clearly-labeled "贊助 Sponsored" links in Settings —
// never disguised as download buttons (keeps us policy-clean & user-friendly).
// ─────────────────────────────────────────────────────────────────────────────
export const CLICK_OFFERS = {
  // Adsterra Smartlink — clicking opens Adsterra's ad landing page
  adsterraSmartlink: 'https://www.effectivecpmnetwork.com/gxjrfzuu?key=ca93120f051ab9908bb111734a180555',
};

// ─────────────────────────────────────────────────────────────────────────────
// Donation / support links — shown in Settings panel + after parse success
// ─────────────────────────────────────────────────────────────────────────────
export const SUPPORT_LINKS = {
  kofi:    '',  // e.g. 'https://ko-fi.com/your-username'
  github:  'https://github.com/cenxialiu7-cloud/MediaGrab',
  // Optionally crypto wallets — leave blank to hide
  bitcoin:  '',
  ethereum: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// UTM parameters added to every outbound affiliate/donation link for tracking
// ─────────────────────────────────────────────────────────────────────────────
export const UTM_PARAMS = {
  utm_source:   'mediagrab',
  utm_medium:   'app',
  utm_campaign: 'v1.3',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: append UTM params to a URL safely
// ─────────────────────────────────────────────────────────────────────────────
export function withUtm(url, overrides = {}) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const params = { ...UTM_PARAMS, ...overrides };
    for (const [k, v] of Object.entries(params)) {
      if (v && !u.searchParams.has(k)) u.searchParams.set(k, v);
    }
    return u.toString();
  } catch {
    return url;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: pick the first VPN offer that has a real URL configured
// ─────────────────────────────────────────────────────────────────────────────
export function getActiveVpnOffer() {
  return VPN_OFFERS.find(o => o.url && o.url.trim().length > 0) || null;
}
