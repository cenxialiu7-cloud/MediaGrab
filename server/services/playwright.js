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
