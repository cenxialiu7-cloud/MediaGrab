import React, { useEffect, useRef } from 'react';
import { AD_ZONES } from '../monetization';

/**
 * AdSlot — renders a display ad (image / video / native banner) from an
 * ad network like Monetag / Adsterra / PropellerAds.
 *
 * Supports THREE ways an ad network might give you the embed code:
 *   1. scriptSrc    — external <script src="..."> tag (most banner zones)
 *   2. inlineScript — an inline JS snippet, e.g. Monetag In-Page Push:
 *                       (function(d,z,s){...})('omg10.com', 1234, document.body)
 *   3. html         — a full HTML snippet (Adsterra Native Banner gives this)
 *
 * Renders nothing if:
 *   • The slot name is not in AD_ZONES
 *   • The slot has no scriptSrc / inlineScript / html configured
 *   • disableAds is true (user turned ads off in Settings)
 *
 * Fail-safe: if the network is blocked / unreachable, the empty container
 * just collapses — nothing visibly breaks.
 */
// Build an isolated srcdoc for an Adsterra highperformanceformat iframe banner.
function buildBannerSrcdoc({ key, width, height }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style></head><body>` +
    `<script type="text/javascript">atOptions={'key':'${key}','format':'iframe','height':${height},'width':${width},'params':{}};<\/script>` +
    `<script type="text/javascript" src="https://www.highperformanceformat.com/${key}/invoke.js"><\/script>` +
    `</body></html>`;
}

export default function AdSlot({ name, disableAds = false, className = '' }) {
  const containerRef = useRef(null);
  const zone = AD_ZONES[name];
  const hasAd = zone && (zone.iframeBanner || zone.scriptSrc || zone.inlineScript || zone.html);

  useEffect(() => {
    if (!hasAd || disableAds || !containerRef.current) return;

    // Avoid double-injection (React StrictMode dev double-render)
    if (containerRef.current.dataset.adLoaded === '1') return;
    containerRef.current.dataset.adLoaded = '1';

    const container = containerRef.current;

    // 0. Isolated iframe banner (Adsterra highperformanceformat) — each in its
    //    own document so the shared global `atOptions` never collides.
    if (zone.iframeBanner) {
      const { width, height } = zone.iframeBanner;
      const iframe = document.createElement('iframe');
      iframe.setAttribute('width', width);
      iframe.setAttribute('height', height);
      iframe.setAttribute('scrolling', 'no');
      iframe.setAttribute('frameborder', '0');
      iframe.setAttribute('title', 'Advertisement');
      iframe.style.cssText = 'border:0;overflow:hidden;max-width:100%';
      iframe.srcdoc = buildBannerSrcdoc(zone.iframeBanner);
      container.appendChild(iframe);
      return () => { if (container) { container.innerHTML = ''; delete container.dataset.adLoaded; } };
    }

    // Optional named container div some networks require
    if (zone.containerId) {
      const target = document.createElement('div');
      target.id = zone.containerId;
      container.appendChild(target);
    }

    // 1. Raw HTML embed (Adsterra native banner, image banners)
    if (zone.html) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = zone.html;
      // innerHTML doesn't execute <script> — re-create any script tags so they run
      wrapper.querySelectorAll('script').forEach((oldScript) => {
        const s = document.createElement('script');
        for (const attr of oldScript.attributes) s.setAttribute(attr.name, attr.value);
        s.text = oldScript.textContent;
        oldScript.replaceWith(s);
      });
      container.appendChild(wrapper);
    }

    // 2. External script src (banner zones)
    if (zone.scriptSrc) {
      const script = document.createElement('script');
      script.async = true;
      script.src = zone.scriptSrc.startsWith('//') ? `https:${zone.scriptSrc}` : zone.scriptSrc;
      script.dataset.cfasync = 'false';
      if (zone.scriptAttrs) {
        for (const [k, v] of Object.entries(zone.scriptAttrs)) script.setAttribute(k, v);
      }
      container.appendChild(script);
    }

    // 3. Inline JS snippet (Monetag In-Page Push / Vignette etc.)
    if (zone.inlineScript) {
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.text = zone.inlineScript;
      container.appendChild(script);
    }

    return () => {
      if (container) {
        container.innerHTML = '';
        delete container.dataset.adLoaded;
      }
    };
  }, [zone, hasAd, disableAds]);

  // Render nothing when there's no real ad configured or ads are disabled.
  if (!hasAd || disableAds) return null;

  return (
    <div
      ref={containerRef}
      className={`ad-slot ad-slot-${name} ${className}`}
      style={{ minHeight: zone.height ? `${zone.height}px` : 'auto' }}
      aria-label="Advertisement"
    />
  );
}
