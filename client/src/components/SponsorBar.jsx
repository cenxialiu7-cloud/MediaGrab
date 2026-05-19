import React, { useState, useEffect } from 'react';
import { getActiveVpnOffer, withUtm } from '../monetization';

/**
 * SponsorBar — slim, dismissible banner across the top of the app.
 *
 * Shows a VPN affiliate offer to fund development. Auto-hides if:
 *   • No VPN offer is configured (real URL still blank in monetization.js)
 *   • User dismissed it in this browser (stored in localStorage)
 *   • User toggled "Disable Ads" in Settings
 *
 * Designed to be unobtrusive — never blocks the main UI, one-click dismiss.
 */
export default function SponsorBar({ disableAds = false }) {
  const offer = getActiveVpnOffer();

  // Persist dismissal across sessions (per-browser). Key includes offer name
  // so adding a new VPN offer re-shows the bar.
  const dismissKey = offer ? `mediagrab.sponsorBar.dismissed.${offer.name}` : null;
  const [dismissed, setDismissed] = useState(() => {
    if (!dismissKey) return false;
    return localStorage.getItem(dismissKey) === '1';
  });

  if (disableAds) return null;
  if (!offer) return null;          // no real URL configured → invisible
  if (dismissed) return null;

  const handleDismiss = () => {
    if (dismissKey) localStorage.setItem(dismissKey, '1');
    setDismissed(true);
  };

  const handleClick = () => {
    // Track click for our own logs if desired (no third-party analytics)
    try {
      const stats = JSON.parse(localStorage.getItem('mediagrab.sponsorClicks') || '{}');
      stats[offer.name] = (stats[offer.name] || 0) + 1;
      localStorage.setItem('mediagrab.sponsorClicks', JSON.stringify(stats));
    } catch {}
  };

  const finalUrl = withUtm(offer.url, { utm_content: 'sponsorbar' });

  return (
    <div className="bg-gradient-to-r from-indigo-900/40 to-purple-900/40 border-b border-indigo-800/40">
      <div className="max-w-6xl mx-auto px-6 py-2 flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {offer.badge && (
            <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-300 rounded-full text-xs whitespace-nowrap shrink-0">
              {offer.badge}
            </span>
          )}
          <span className="text-dark-100 truncate">
            <strong className="text-white">{offer.headline}</strong>
            <span className="text-dark-300 ml-2">— {offer.subtext}</span>
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={finalUrl}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={handleClick}
            className="px-3 py-1 bg-accent hover:bg-accent-hover text-white rounded-md text-xs font-medium transition-colors whitespace-nowrap"
          >
            查看優惠 · Get Offer →
          </a>
          <button
            onClick={handleDismiss}
            aria-label="關閉橫幅 Dismiss"
            className="p-1 text-dark-300 hover:text-white transition-colors"
            title="關閉（不再顯示此優惠）"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
