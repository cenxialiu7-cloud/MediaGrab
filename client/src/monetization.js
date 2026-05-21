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
// Display ad zones (IMAGE / VIDEO / NATIVE banners) — used by AdSlot.jsx
//
// These render visual ads (banner images, video, in-page push cards) INSIDE
// the app. Each slot accepts ANY ONE of these three fields depending on what
// your ad network gives you:
//
//   scriptSrc    — an external <script src="..."> URL
//                  e.g. '//pl12345678.profitableratecpm.com/ab/cd/ef.js'
//
//   inlineScript — an inline JS snippet (paste between the <script> tags).
//                  MONETAG IN-PAGE PUSH / VIGNETTE looks like:
//                    "(function(d,z,s){s.src='https://'+d+'/400/'+z;...})
//                       ('vemtoutcheeg.com',1234567,document.createElement('script'))"
//
//   html         — a full HTML embed snippet (Adsterra Native Banner gives this
//                  as a <div> + <script> block — paste the whole thing here)
//
// ── HOW TO GET DISPLAY-AD CODE (image/video) ──────────────────────────────────
// Monetag (most app-friendly): https://publishers.monetag.com → Websites/Direct
//   1. Add a site OR use the "Social/App" flow
//   2. Create an ad zone of type: In-Page Push (image+text), Banner 300x250
//      (image), or Vignette (image/video)
//   3. Copy the zone's JS snippet → paste into `inlineScript` below
// Adsterra: https://beta.publishers.adsterra.com/websites
//   1. Add Website → create Native Banner / Banner ad unit → Get Code
//   2. Paste the whole HTML block into `html` below
//
// NOTE: display banners pay best with a verified public domain. On localhost
// Monetag is the most lenient; Adsterra banner units may not count localhost
// impressions. The clickable links in CLICK_OFFERS are the safest fallback.
//
// Any slot with all three fields blank renders nothing (invisible).
// ─────────────────────────────────────────────────────────────────────────────
// `iframeBanner` renders an Adsterra highperformanceformat banner inside an
// isolated <iframe srcdoc> so multiple banners don't clobber the shared global
// `atOptions`. Provide { key, width, height }.
export const AD_ZONES = {
  // Shown on the Smart tab welcome screen (before user pastes URL) — 728x90
  'smart-welcome': {
    network: 'adsterra',
    iframeBanner: { key: 'b68a575ae3fd38bdbd457c83b93017df', width: 728, height: 90 },
    height: 90,
  },
  // Shown when download queue is empty — 300x250
  'queue-empty': {
    network: 'adsterra',
    iframeBanner: { key: 'edaa490f3a506385716ea337d3097972', width: 300, height: 250 },
    height: 250,
  },
  // Shown at the bottom of Settings panel — 320x50 (compact)
  'settings-bottom': {
    network: 'adsterra',
    iframeBanner: { key: '3dfb8b9127addaf1d9d6380a4cd3aa9a', width: 320, height: 50 },
    height: 50,
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
  // Adsterra Direct Link #2
  adsterraDirectLink2: 'https://www.effectivecpmnetwork.com/hbxhsn184?key=563ee7f7c6de60691a78c0562cee074d',
  // Monetag Direct Link — same model (clickable popunder/ad landing page)
  monetagDirectLink: 'https://omg10.com/4/11036149',
};

// Returns the list of configured (non-blank) clickable ad links.
export function getActiveClickOffers() {
  return Object.values(CLICK_OFFERS).filter(u => u && u.trim().length > 0);
}

// Picks one clickable ad link at random — splits traffic across all configured
// networks (Adsterra, Monetag, …) so each gets impressions / fill.
export function pickClickOffer() {
  const active = getActiveClickOffers();
  if (active.length === 0) return '';
  return active[Math.floor(Math.random() * active.length)];
}

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
