import { chromium } from 'playwright';

let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return browser;
}

function applyStealthScripts(page) {
  return page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-TW', 'zh', 'en-US', 'en'] });

    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);

    window.chrome = { runtime: {} };

    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return 'Intel Inc.';
      if (param === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, param);
    };
  });
}

export async function parseStreamingSite(url) {
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'zh-TW',
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();
  await applyStealthScripts(page);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const result = await page.evaluate(() => {
      const data = { title: '', routes: [] };

      const h1 = document.querySelector('h1') || document.querySelector('.title') || document.querySelector('.video-title');
      data.title = h1 ? h1.textContent.trim() : document.title;

      // Words that indicate this is NOT a streaming route (description, recommendations, etc.)
      const NON_ROUTE_KEYWORDS = ['劇情介紹', '简介', '簡介', '介紹', '介绍', '推薦', '推荐', '熱播', '热播', '排行', '相關', '相关', '評論', '评论', '猜你喜歡', '猜你喜欢', '同類', '同类', '相似', '其他人'];
      const isRouteName = (name) => {
        if (!name || name.length > 30 || name.length < 1) return false;
        for (const kw of NON_ROUTE_KEYWORDS) {
          if (name.includes(kw)) return false;
        }
        return true;
      };

      // Strategy 1: Gimy / MacCMS — #playTab li a + #con_playlist_N panels
      const gimyTabs = document.querySelectorAll('#playTab li a');
      if (gimyTabs.length > 0) {
        for (const tab of gimyTabs) {
          const name = tab.textContent.trim();
          const href = tab.getAttribute('href');
          const panelId = href ? href.replace('#', '') : null;
          const route = { name, episodes: [] };

          if (panelId) {
            const panel = document.getElementById(panelId);
            if (panel) {
              for (const a of panel.querySelectorAll('a')) {
                route.episodes.push({ title: a.textContent.trim(), url: a.href });
              }
            }
          }
          if (route.episodes.length > 0) data.routes.push(route);
        }
        if (data.routes.length > 0) return data;
      }

      // Strategy 2: gimytv.ai style — .playlist-mobile / .playlist.layout-box
      // First child div is route name, ul contains episodes
      const gimyPlaylists = document.querySelectorAll('.playlist-mobile, .playlist.layout-box');
      if (gimyPlaylists.length > 0) {
        for (const block of gimyPlaylists) {
          // The route name is in the first non-list child div (often with class "gico ...")
          let name = '';
          const nameDiv = block.querySelector(':scope > div');
          if (nameDiv && !nameDiv.querySelector('ul, ol, li')) {
            name = nameDiv.textContent.trim();
          }
          const ul = block.querySelector('ul');
          if (!ul) continue;
          const route = { name: name || `Source ${data.routes.length + 1}`, episodes: [] };
          for (const a of ul.querySelectorAll('a')) {
            route.episodes.push({ title: a.textContent.trim(), url: a.href });
          }
          if (route.episodes.length > 0 && isRouteName(route.name)) {
            data.routes.push(route);
          }
        }
        if (data.routes.length > 0) return data;
      }

      // Strategy 3: 777tv / .stui-pannel theme — each panel has h3/h4 title + stui-content__playlist
      const stuiPanels = document.querySelectorAll('.stui-pannel');
      if (stuiPanels.length > 0) {
        for (const panel of stuiPanels) {
          const head = panel.querySelector('.stui-pannel__head h3, .stui-pannel__head h4, .stui-pannel__head .title');
          const playlist = panel.querySelector('.stui-content__playlist, ul.stui-content__playlist');
          if (!head || !playlist) continue;
          const name = head.textContent.trim();
          if (!isRouteName(name)) continue;
          const route = { name, episodes: [] };
          for (const a of playlist.querySelectorAll('a')) {
            route.episodes.push({ title: a.textContent.trim(), url: a.href });
          }
          if (route.episodes.length > 0) data.routes.push(route);
        }
        if (data.routes.length > 0) return data;
      }

      // Strategy 4: .module-tab-item tabs + .module-blocklist panels
      const moduleTabItems = document.querySelectorAll('.module-tab-item');
      const moduleBlocks = document.querySelectorAll('.module-tab-content .module-blocklist, .module-play-list-content');
      if (moduleTabItems.length > 0 && moduleBlocks.length > 0) {
        moduleTabItems.forEach((tab, idx) => {
          const route = { name: tab.textContent.trim(), episodes: [] };
          const block = moduleBlocks[idx];
          if (block) {
            for (const a of block.querySelectorAll('a')) {
              route.episodes.push({ title: a.textContent.trim(), url: a.href });
            }
          }
          if (route.episodes.length > 0) data.routes.push(route);
        });
        if (data.routes.length > 0) return data;
      }

      // Strategy 5: Bootstrap nav-tabs + tab-pane panels
      const navTabs = document.querySelectorAll('.nav-tabs li a[data-toggle="tab"], .nav-tabs li a[data-bs-toggle="tab"]');
      if (navTabs.length > 0) {
        for (const tab of navTabs) {
          const name = tab.textContent.trim();
          const href = tab.getAttribute('href') || tab.getAttribute('data-bs-target');
          const panelId = href ? href.replace('#', '') : null;
          const route = { name, episodes: [] };
          if (panelId) {
            const panel = document.getElementById(panelId);
            if (panel) {
              for (const a of panel.querySelectorAll('a')) {
                route.episodes.push({ title: a.textContent.trim(), url: a.href });
              }
            }
          }
          if (route.episodes.length > 0 && isRouteName(route.name)) {
            data.routes.push(route);
          }
        }
        if (data.routes.length > 0) return data;
      }

      // Strategy 6: Fallback — scan all links that look like episode numbers
      const allLinks = document.querySelectorAll('a');
      const episodeLinks = [];
      for (const a of allLinks) {
        const text = a.textContent.trim();
        if (/^第?\d+[集期话話]?$/.test(text) || /^EP?\s*\d+$/i.test(text)) {
          episodeLinks.push({ title: text, url: a.href });
        }
      }
      if (episodeLinks.length > 0) {
        data.routes.push({ name: 'Default', episodes: episodeLinks });
      }

      return data;
    });

    await context.close();
    return result;
  } catch (err) {
    await context.close();
    throw err;
  }
}

export async function extractM3u8(episodeUrl) {
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent: UA,
    viewport: { width: 1920, height: 1080 },
    locale: 'zh-TW',
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();
  await applyStealthScripts(page);

  const m3u8Entries = [];
  const mp4Urls = [];
  const capturedHeaders = {};

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('.m3u8')) {
      const headers = request.headers();
      capturedHeaders[url] = {
        referer: headers['referer'] || '',
        origin: headers['origin'] || '',
        cookie: headers['cookie'] || '',
      };
      m3u8Entries.push(url);
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (url.includes('.m3u8') || ct.includes('mpegurl') || ct.includes('x-mpegURL')) {
      if (!m3u8Entries.includes(url)) m3u8Entries.push(url);
    }
    if (url.includes('.mp4') && (ct.includes('video') || url.includes('video'))) {
      mp4Urls.push(url);
    }
  });

  try {
    await page.goto(episodeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    // Check for iframe player
    const iframeSrc = await page.evaluate(() => {
      const iframe = document.querySelector('iframe[src*="player"], iframe[src*="play"], iframe[class*="player"]');
      return iframe ? iframe.src : null;
    });

    if (iframeSrc && m3u8Entries.length === 0) {
      const iframePage = await context.newPage();
      await applyStealthScripts(iframePage);

      iframePage.on('request', (request) => {
        const url = request.url();
        if (url.includes('.m3u8')) {
          const headers = request.headers();
          capturedHeaders[url] = {
            referer: headers['referer'] || iframeSrc,
            origin: headers['origin'] || '',
            cookie: headers['cookie'] || '',
          };
          m3u8Entries.push(url);
        }
      });

      iframePage.on('response', async (response) => {
        const url = response.url();
        const ct = response.headers()['content-type'] || '';
        if (url.includes('.m3u8') || ct.includes('mpegurl')) {
          if (!m3u8Entries.includes(url)) m3u8Entries.push(url);
        }
      });

      try {
        await iframePage.goto(iframeSrc, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await iframePage.waitForTimeout(5000);
      } catch {}

      await iframePage.close();
    }

    // Fallback: scan page source for m3u8 URLs
    if (m3u8Entries.length === 0) {
      const pageM3u8 = await page.evaluate(() => {
        const urls = [];
        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
          const text = s.textContent || s.innerHTML;
          const matches = text.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g);
          if (matches) urls.push(...matches);
        }
        const html = document.documentElement.innerHTML;
        const htmlMatches = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g);
        if (htmlMatches) urls.push(...htmlMatches);
        return [...new Set(urls)];
      });
      m3u8Entries.push(...pageM3u8);
    }

    // Collect cookies from the browser context
    const cookies = await context.cookies();
    const pageUrl = new URL(episodeUrl);
    const cookieStr = cookies
      .map(c => `${c.name}=${c.value}`)
      .join('; ');

    // Build the referer from the episode page or iframe
    const referer = iframeSrc || episodeUrl;
    const origin = pageUrl.origin;

    await context.close();

    // Ad-network domains whose m3u8 streams are advertisements, not the real
    // video (common on sites like missav that embed video-ad widgets).
    const AD_M3U8_DOMAINS = [
      'growcdnssedge.com', 'mavrtracktor.com', 'myavlive.com',
      'adxadserv.com', 'bluetrafficstream.com', 'mavren.com',
      'a-ads.com', 'exoclick.com', 'juicyads.com',
    ];

    // Filter and rank m3u8 URLs:
    // - Skip player iframe URLs (they contain '?url=' or end in '.html')
    // - Skip known ad-network streams
    // - Prefer URLs that end directly in .m3u8 (these are real playlists)
    // - Prefer higher-quality variants (1080, 2000k, etc.) if multiple exist
    const filtered = [...new Set(m3u8Entries)].filter(u => {
      if (/[?&]url=https?/.test(u)) return false;          // player wrapper
      if (/\.html(\?|$)/.test(u)) return false;            // play page
      const host = (() => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } })();
      if (AD_M3U8_DOMAINS.some(d => host.endsWith(d))) return false;  // ad stream
      return true;
    });

    const ranked = filtered.sort((a, b) => {
      const score = (url) => {
        let s = 0;
        // Direct .m3u8 URL gets +10
        if (/\.m3u8($|\?)/.test(url)) s += 10;
        // A master "playlist.m3u8" is preferred over a single-variant file
        if (/playlist\.m3u8/i.test(url)) s += 3;
        // Prefer URLs with quality hints (1080, 720, 2000k, etc.)
        if (/1080|2000k|hd|hls/i.test(url)) s += 5;
        // Prefer shorter URLs (usually canonical), but only as tiebreaker
        s -= Math.min(2, url.length / 100);
        return s;
      };
      return score(b) - score(a);
    });

    const unique = ranked.length > 0 ? ranked : [...new Set(m3u8Entries)];
    const uniqueMp4 = [...new Set(mp4Urls)];

    // Build headers object
    const headers = {
      'User-Agent': UA,
      'Referer': referer,
      'Origin': origin,
    };
    if (cookieStr) {
      headers['Cookie'] = cookieStr;
    }

    return {
      m3u8: unique,
      mp4: uniqueMp4,
      all: [...unique, ...uniqueMp4],
      headers,
      capturedHeaders,
    };
  } catch (err) {
    await context.close();
    throw err;
  }
}

// Ad-network domains whose media streams are advertisements, not the real
// video. Shared between extractM3u8 and scanPageForVideos.
const AD_MEDIA_DOMAINS = [
  'growcdnssedge.com', 'mavrtracktor.com', 'myavlive.com',
  'adxadserv.com', 'bluetrafficstream.com', 'mavren.com',
  'a-ads.com', 'exoclick.com', 'juicyads.com', 'doubleclick.net',
  'googlesyndication.com', 'adsterra.com', 'propellerads.com',
];

function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase(); } catch { return ''; }
}

function isAdMedia(u) {
  const h = hostOf(u);
  return AD_MEDIA_DOMAINS.some(d => h.endsWith(d));
}

// Looks like an HLS/DASH segment rather than a full downloadable file.
function looksLikeSegment(u) {
  return /(?:^|\/)(?:seg|chunk|frag|init)[-_]?\d*\.|stream[-_]?\d|\.m4s(\?|$)|\/hls\/.*\.(ts|mp4)(\?|$)/i.test(u);
}

// Extract a quality label (e.g. "1080p") from a URL path if present.
function qualityHint(u) {
  const m = u.match(/(\d{3,4})\s*p\b/i) || u.match(/[_/-](\d{3,4})p[_./-]/i);
  return m ? `${m[1]}p` : null;
}

/**
 * Universal page video scanner — "paste any page, list the videos on it".
 *
 * Unlike extractM3u8 (which picks ONE best stream for single-video sites),
 * this returns a LIST of distinct videos found anywhere on the page (including
 * nested cross-origin iframes / embeds), each annotated with type, title,
 * thumbnail, available qualities, and the request headers needed to fetch it.
 *
 * Detection layers:
 *   1. Network sniffing across all frames — captures .m3u8 / .mpd / .mp4 the
 *      player requests (works even when the stream URL is built in JS).
 *   2. DOM scan in every frame — <video src/currentSrc>, <source src>, posters,
 *      and a regex sweep of inner HTML for media URLs.
 *   3. A gentle play-nudge to trigger players that only fetch the manifest on
 *      play, then a second collection pass.
 *
 * Returns { pageTitle, videos: [{ id, title, type, url, thumbnail, qualities, headers, source }] }
 */
export async function scanPageForVideos(pageUrl) {
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent: UA,
    viewport: { width: 1600, height: 900 },
    locale: 'zh-TW',
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await applyStealthScripts(page);

  // url → { type, posterGuess } captured from the network
  const net = new Map();
  const note = (url, type) => {
    if (!url || isAdMedia(url)) return;
    if (!net.has(url)) net.set(url, { type });
  };

  page.on('request', (req) => {
    const u = req.url();
    if (/\.m3u8(\?|$)/i.test(u)) note(u, 'hls');
    else if (/\.mpd(\?|$)/i.test(u)) note(u, 'dash');
    else if (/\.mp4(\?|$)/i.test(u) && !looksLikeSegment(u)) note(u, 'mp4');
  });
  page.on('response', (res) => {
    const u = res.url();
    const ct = (res.headers()['content-type'] || '').toLowerCase();
    if (/mpegurl/.test(ct) || /\.m3u8(\?|$)/i.test(u)) note(u, 'hls');
    else if (/dash\+xml/.test(ct) || /\.mpd(\?|$)/i.test(u)) note(u, 'dash');
    else if (ct.startsWith('video/mp4') && !looksLikeSegment(u)) note(u, 'mp4');
  });

  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000);

    // Gentle play-nudge across every frame to trigger lazy manifest loads.
    for (const frame of page.frames()) {
      try {
        await frame.evaluate(() => {
          document.querySelectorAll('video').forEach(v => { try { v.muted = true; v.play().catch(() => {}); } catch {} });
          ['.vjs-big-play-button', '[class*="play-button"]', 'button[aria-label*="lay"]'].forEach(sel => {
            const el = document.querySelector(sel);
            if (el && el.click) try { el.click(); } catch {}
          });
        });
      } catch {}
    }
    await page.waitForTimeout(3500);

    // DOM scan across all frames — collect <video>/<source>/poster + HTML sweep.
    // Read the title from the main frame; fall back to the hostname so grouped
    // videos always get a meaningful label even if <title> is empty.
    let pageTitle = (await page.title().catch(() => '') || '').trim();
    const domVideos = [];   // { url, type, poster, title }
    const posters = [];
    const titleCandidates = [];
    for (const frame of page.frames()) {
      try {
        const found = await frame.evaluate(() => {
          const out = { items: [], posters: [], html: [] };
          const pickTitle = () => {
            const h = document.querySelector('h1, .video-title, [class*="title"]');
            return (h && h.textContent.trim()) || document.title || '';
          };
          const t = pickTitle();
          document.querySelectorAll('video').forEach(v => {
            const src = v.currentSrc || v.src;
            if (src) out.items.push({ url: src, poster: v.poster || '', title: v.title || t });
            if (v.poster) out.posters.push(v.poster);
            v.querySelectorAll('source').forEach(s => { if (s.src) out.items.push({ url: s.src, poster: v.poster || '', title: t }); });
          });
          document.querySelectorAll('source[src]').forEach(s => {
            if (/\.(m3u8|mpd|mp4|webm)(\?|$)/i.test(s.src)) out.items.push({ url: s.src, poster: '', title: t });
          });
          out.titleCand = t;
          const html = document.documentElement.innerHTML;
          const matches = html.match(/https?:\/\/[^\s"'<>\\]+\.(m3u8|mpd|mp4)(\?[^\s"'<>\\]*)?/gi) || [];
          out.html = [...new Set(matches.map(m => m.replace(/&amp;/g, '&')))].slice(0, 40);
          return out;
        });
        if (found.titleCand && found.titleCand.trim()) titleCandidates.push(found.titleCand.trim());
        for (const it of found.items) {
          const type = /\.m3u8/i.test(it.url) ? 'hls' : /\.mpd/i.test(it.url) ? 'dash' : 'mp4';
          if (type === 'mp4' && looksLikeSegment(it.url)) continue;
          if (isAdMedia(it.url)) continue;
          domVideos.push({ url: it.url, type, poster: it.poster, title: it.title });
        }
        posters.push(...found.posters);
        for (const u of found.html) {
          if (isAdMedia(u)) continue;
          const type = /\.m3u8/i.test(u) ? 'hls' : /\.mpd/i.test(u) ? 'dash' : 'mp4';
          if (type === 'mp4' && looksLikeSegment(u)) continue;
          domVideos.push({ url: u, type, poster: '', title: pageTitle });
        }
      } catch {}
    }

    // Pick the most specific title seen across frames (longest, ignoring the
    // generic shell title) — JS-heavy help/embed pages often leave <title>
    // empty on the main frame but expose a real title inside the player iframe.
    const GENERIC = /^(video|untitled|loading|player|home|index)$/i;
    const best = titleCandidates
      .filter(t => t && !GENERIC.test(t))
      .sort((a, b) => b.length - a.length)[0];
    if (best && best.length > pageTitle.length) pageTitle = best;
    if (!pageTitle) { try { pageTitle = new URL(pageUrl).hostname; } catch {} }

    // Cookies for header construction.
    const cookies = await context.cookies();
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const origin = (() => { try { return new URL(pageUrl).origin; } catch { return ''; } })();
    await context.close();

    const headers = { 'User-Agent': UA, 'Referer': pageUrl, 'Origin': origin };
    if (cookieStr) headers['Cookie'] = cookieStr;

    // ── Merge all candidates ─────────────────────────────────────────────
    const candidates = [];
    for (const [url, meta] of net) candidates.push({ url, type: meta.type, poster: '', title: pageTitle });
    candidates.push(...domVideos);

    const videos = groupVideos(candidates, posters[0] || '', pageTitle, headers);
    return { pageTitle, videos };
  } catch (err) {
    await context.close().catch(() => {});
    throw err;
  }
}

/**
 * Collapse raw media-URL candidates into a deduped list of distinct videos.
 * HLS master + its quality variants (sharing a base path) become ONE entry;
 * progressive MP4s of the same video are grouped with selectable qualities.
 */
function groupVideos(candidates, fallbackPoster, pageTitle, headers) {
  // Dedup by exact URL, remembering the best poster/title seen.
  const byUrl = new Map();
  for (const c of candidates) {
    if (!c.url || !/^https?:/i.test(c.url)) continue;
    const prev = byUrl.get(c.url);
    if (!prev) byUrl.set(c.url, c);
    else { if (!prev.poster && c.poster) prev.poster = c.poster; if (!prev.title && c.title) prev.title = c.title; }
  }
  const all = [...byUrl.values()];

  // baseKey = directory up to (and including) /hls/ or the parent folder —
  // groups a master and its 1080p/720p variants together.
  const baseKey = (u) => {
    try {
      const url = new URL(u);
      let p = url.pathname;
      const hlsIdx = p.toLowerCase().indexOf('/hls/');
      if (hlsIdx >= 0) p = p.slice(0, hlsIdx + 5);
      else p = p.replace(/\/[^/]*$/, '/');
      return url.origin + p;
    } catch { return u; }
  };

  const hls = all.filter(c => c.type === 'hls');
  const dash = all.filter(c => c.type === 'dash');
  const mp4 = all.filter(c => c.type === 'mp4');

  const videos = [];
  const usedTitles = new Set();
  const mkTitle = (base) => {
    let t = (base || pageTitle || 'Video').trim()
      .replace(/\.(mp4|m3u8|mpd|webm|mov|mkv|ts)$/i, '')   // drop asset extension
      .trim().slice(0, 120) || 'Video';
    let name = t, n = 2;
    while (usedTitles.has(name)) name = `${t} (${n++})`;
    usedTitles.add(name);
    return name;
  };

  // HLS: one video per base path, preferring a master/playlist/index manifest.
  const hlsGroups = new Map();
  for (const c of hls) {
    const k = baseKey(c.url);
    if (!hlsGroups.has(k)) hlsGroups.set(k, []);
    hlsGroups.get(k).push(c);
  }
  for (const [, group] of hlsGroups) {
    const master = group.find(c => /master|playlist|index|manifest/i.test(c.url)) || group[0];
    const poster = group.find(c => c.poster)?.poster || fallbackPoster || null;
    const title = group.find(c => c.title)?.title;
    videos.push({
      id: `hls-${videos.length}`,
      title: mkTitle(title),
      type: 'hls',
      url: master.url,
      thumbnail: poster,
      qualities: [],
      headers,
      source: 'stream',
    });
  }

  for (const c of dash) {
    videos.push({
      id: `dash-${videos.length}`,
      title: mkTitle(c.title), type: 'dash', url: c.url,
      thumbnail: c.poster || fallbackPoster || null, qualities: [], headers, source: 'stream',
    });
  }

  // MP4: group progressive files of the same video, expose qualities.
  // Quality variants of one video often live in sibling folders
  // (…/video_1080p/faststart.mp4, …/video_720p/faststart.mp4), so normalise
  // the quality token out of the path before grouping.
  const mp4GroupKey = (u) => {
    try {
      const url = new URL(u);
      const p = url.pathname
        .replace(/(?:^|\/)(?:video[_-]?)?\d{3,4}p(?=\/|$)/gi, '/_Q_')  // quality folder
        .replace(/[_-]\d{3,4}p(?=[._/-]|$)/gi, '_Q_')                   // quality token
        .replace(/\/[^/]*$/, '/');                                       // drop filename
      return url.origin + p;
    } catch { return baseKey(u); }
  };
  const mp4Groups = new Map();
  for (const c of mp4) {
    const k = mp4GroupKey(c.url);
    if (!mp4Groups.has(k)) mp4Groups.set(k, []);
    mp4Groups.get(k).push(c);
  }
  for (const [, group] of mp4Groups) {
    const qualities = group
      .map(c => ({ label: qualityHint(c.url) || 'MP4', url: c.url }))
      .filter((q, i, arr) => arr.findIndex(x => x.url === q.url) === i)
      .sort((a, b) => (parseInt(b.label) || 0) - (parseInt(a.label) || 0));
    const best = qualities[0];
    const poster = group.find(c => c.poster)?.poster || fallbackPoster || null;
    const title = group.find(c => c.title)?.title;
    videos.push({
      id: `mp4-${videos.length}`,
      title: mkTitle(title),
      type: 'mp4',
      url: best.url,
      thumbnail: poster,
      qualities: qualities.length > 1 ? qualities : [],
      headers,
      source: 'file',
    });
  }

  return videos;
}

// Shared browser context for downloading segments — replicates browser's TLS/IP fingerprint
let sharedFetchContext = null;

async function getSharedFetchContext() {
  if (sharedFetchContext) return sharedFetchContext;
  const b = await getBrowser();
  sharedFetchContext = await b.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'zh-TW',
    // Streaming CDNs often use self-signed or non-standard certs
    ignoreHTTPSErrors: true,
  });
  return sharedFetchContext;
}

/**
 * Fetch a URL using the Playwright browser context's HTTP client.
 * This shares the same TLS fingerprint, IP, and cookie jar as the browser
 * that originally captured the m3u8 URL — bypassing many CDN checks.
 */
export async function fetchInBrowserContext(url, headers = {}) {
  const ctx = await getSharedFetchContext();

  const reqHeaders = {};
  if (headers['User-Agent']) reqHeaders['user-agent'] = headers['User-Agent'];
  if (headers['Referer'])    reqHeaders['referer']    = headers['Referer'];
  if (headers['Origin'])     reqHeaders['origin']     = headers['Origin'];
  if (headers['Cookie'])     reqHeaders['cookie']     = headers['Cookie'];

  // Pass through any other headers
  for (const [k, v] of Object.entries(headers)) {
    if (!['User-Agent', 'Referer', 'Origin', 'Cookie'].includes(k)) {
      reqHeaders[k.toLowerCase()] = v;
    }
  }

  const response = await ctx.request.get(url, {
    headers: reqHeaders,
    timeout: 30000,
    maxRedirects: 5,
  });

  const bodyBuffer = await response.body();
  return {
    status: response.status(),
    headers: response.headers(),
    body: bodyBuffer.toString('utf-8'),
    bodyBuffer,
  };
}

export async function closeBrowser() {
  if (sharedFetchContext) {
    await sharedFetchContext.close().catch(() => {});
    sharedFetchContext = null;
  }
  if (browser) {
    await browser.close();
    browser = null;
  }
}
