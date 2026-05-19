import React, { useEffect, useRef } from 'react';
import { AD_ZONES } from '../monetization';

/**
 * AdSlot — loads an ad zone script from PropellerAds / Adsterra etc.
 *
 * Renders nothing if:
 *   • The slot name is not in AD_ZONES
 *   • The slot's scriptSrc is empty (= placeholder, no real ad code yet)
 *   • disableAds prop is true (user has turned ads off in settings)
 *
 * Usage:
 *   <AdSlot name="smart-welcome" disableAds={settings.disableAds} />
 *
 * The component is intentionally fail-safe: if the ad network is unreachable
 * or blocked by an ad-blocker, nothing visible breaks — the empty container
 * collapses naturally.
 */
export default function AdSlot({ name, disableAds = false, className = '' }) {
  const containerRef = useRef(null);
  const zone = AD_ZONES[name];

  useEffect(() => {
    // Bail out if no real script configured, or ads disabled
    if (!zone || !zone.scriptSrc || disableAds) return;
    if (!containerRef.current) return;

    // Avoid double-loading if React re-mounts (StrictMode dev double-render)
    if (containerRef.current.dataset.adLoaded === '1') return;
    containerRef.current.dataset.adLoaded = '1';

    const script = document.createElement('script');
    script.async = true;
    script.src = zone.scriptSrc.startsWith('//') ? `https:${zone.scriptSrc}` : zone.scriptSrc;
    script.dataset.cfasync = 'false';
    // PropellerAds / Adsterra expect a container with a specific ID
    if (zone.containerId) {
      const target = document.createElement('div');
      target.id = zone.containerId;
      containerRef.current.appendChild(target);
    }
    containerRef.current.appendChild(script);

    return () => {
      // Cleanup on unmount — but most ad scripts pollute global state, so
      // a full cleanup is impossible. Best effort: remove our own DOM nodes.
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
        delete containerRef.current.dataset.adLoaded;
      }
    };
  }, [zone, disableAds]);

  // Don't render any DOM if no zone, no script, or ads disabled.
  // This means component is 100% invisible during development with placeholder config.
  if (!zone || !zone.scriptSrc || disableAds) return null;

  return (
    <div
      ref={containerRef}
      className={`ad-slot ad-slot-${name} ${className}`}
      style={{ minHeight: zone.height ? `${zone.height}px` : 'auto' }}
      aria-label="Advertisement"
    />
  );
}
