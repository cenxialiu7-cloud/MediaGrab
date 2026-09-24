// Per-download loopback gateway. Credentials stay in this process and are
// selected for each destination origin, including manifest descendants.
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import crypto from "node:crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { cleanHeaders, resolvePublicUrl } from "../utils/security.js";
import { cookieHeaderForUrl } from "../utils/cookies.js";
export function headersFor(url, context) {
  const target = new URL(url);
  const h = cleanHeaders(
    context.contexts?.[url] || (context.url === url ? context.headers : {}),
  );
  if (!h.cookie) {
    const matched = (context.cookies || []).filter((c) => {
      const d = c.domain?.replace(/^\./, "");
      const p = c.path || "/";
      return (
        d &&
        (c.hostOnly
          ? target.hostname === d
          : target.hostname === d || target.hostname.endsWith("." + d)) &&
        (!c.secure || target.protocol === "https:") &&
        (!c.expirationDate || c.expirationDate > Date.now() / 1000) &&
        (target.pathname === p ||
          (target.pathname.startsWith(p) &&
            (p.endsWith("/") || target.pathname[p.length] === "/")))
      );
    });
    const dedup = new Map(
      matched.map((c) => [c.domain + "|" + c.path + "|" + c.name, c]),
    );
    h.cookie =
      [...dedup.values()].map((c) => `${c.name}=${c.value}`).join("; ") ||
      cookieHeaderForUrl(url);
    if (!h.cookie) delete h.cookie;
  }
  // Non-secret playback headers may be inherited only within the same origin.
  if (target.origin === new URL(context.url).origin)
    for (const key of ["referer", "origin", "user-agent"]) {
      const value = cleanHeaders(context.headers)[key];
      if (!h[key] && value) h[key] = value;
    }
  return h;
}
export async function scopedFetch(url, context, { signal, range } = {}) {
  let target = url;
  for (let i = 0; i < 6; i++) {
    const { addresses } = await resolvePublicUrl(target);
    const headers = headersFor(target, context);
    if (range) headers.range = range;
    const r = await new Promise((resolve, reject) => {
      const transport = new URL(target).protocol === "https:" ? https : http;
      const request = transport.get(
        target,
        {
          headers,
          signal: signal || AbortSignal.timeout(30000),
          lookup: (host, options, callback) =>
            options.all
              ? callback(null, addresses)
              : callback(null, addresses[0].address, addresses[0].family),
        },
        (response) => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers))
            if (value != null)
              responseHeaders.set(
                key,
                Array.isArray(value) ? value.join(", ") : value,
              );
          resolve(
            new Response(
              [204, 205, 304].includes(response.statusCode)
                ? null
                : Readable.toWeb(response),
              { status: response.statusCode, headers: responseHeaders },
            ),
          );
        },
      );
      request.on("error", reject);
    });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const next = r.headers.get("location");
      await r.body?.cancel();
      if (!next) throw new Error("Invalid redirect");
      target = new URL(next, target).href;
      continue;
    }
    return { response: r, url: target };
  }
  throw new Error("Too many redirects");
}
export async function createMediaGateway(context) {
  const secret = crypto.randomBytes(24).toString("hex");
  const mappings = new Map();
  let origin;
  let expectedDuration = null;
  let expectedAudio = false;
  const failures = [];
  let failureReason = null;
  const wrap = (u) => {
    if (mappings.size > 50000) throw new Error("Manifest resource limit");
    const id = crypto.randomUUID();
    mappings.set(id, u);
    return `${origin}/${secret}/${id}/${new URL(u).pathname.split("/").pop() || "media"}`;
  };
  const wrapBase = (u) => {
    if (mappings.size > 50000) throw new Error("Manifest resource limit");
    const id = crypto.randomUUID();
    mappings.set(id, u);
    return `${origin}/${secret}/${id}/`;
  };
  function hls(text, url) {
    if (!text.trimStart().startsWith("#EXTM3U"))
      throw new Error("Invalid HLS playlist");
    if (
      /METHOD=(?:SAMPLE-AES|SAMPLE-AES-CTR)|KEYFORMAT="(?!identity)/i.test(text)
    )
      throw new Error("DRM／不支援的加密串流，請使用官方離線功能");
    const durations = [...text.matchAll(/^#EXTINF:([\d.]+)/gm)].map((m) =>
      Number(m[1]),
    );
    if (text.includes("#EXT-X-ENDLIST") && durations.length)
      expectedDuration = Math.max(
        expectedDuration || 0,
        durations.reduce((a, b) => a + b, 0),
      );
    if (/#EXT-X-MEDIA:.*TYPE=AUDIO.*URI=/i.test(text)) expectedAudio = true;
    return text
      .split(/\r?\n/)
      .map((line) => {
        if (line.startsWith("#"))
          return line.replace(
            /URI="([^"]+)"/g,
            (_, u) => `URI="${wrap(new URL(u, url).href)}"`,
          );
        return line.trim() ? wrap(new URL(line.trim(), url).href) : line;
      })
      .join("\n");
  }
  function dash(text, url) {
    const doc = new DOMParser({
      errorHandler: {
        warning() {},
        error() {
          throw new Error("Invalid DASH");
        },
        fatalError() {
          throw new Error("Invalid DASH");
        },
      },
    }).parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("ContentProtection").length)
      throw new Error("DRM／受保護的 DASH，請使用官方離線功能");
    const duration = doc.documentElement
      .getAttribute("mediaPresentationDuration")
      ?.match(
        /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/,
      );
    if (duration)
      expectedDuration =
        Number(duration[1] || 0) * 3600 +
        Number(duration[2] || 0) * 60 +
        Number(duration[3] || 0);
    if (/(?:mimeType="audio\/|contentType="audio")/.test(text))
      expectedAudio = true;
    const walk = (node, base) => {
      if (node.nodeType !== 1) return;
      const bases = Array.from(node.childNodes).filter(
        (n) => n.nodeType === 1 && n.localName === "BaseURL",
      );
      const resolved = bases.length
        ? new URL(bases[0].textContent.trim(), base).href
        : base;
      for (const b of bases) node.removeChild(b);
      if (node.localName === "Representation") {
        const b = doc.createElement("BaseURL");
        b.textContent = wrapBase(resolved);
        node.insertBefore(b, node.firstChild);
      }
      for (const attr of ["media", "initialization", "sourceURL"])
        if (node.hasAttribute(attr))
          node.setAttribute(
            attr,
            wrapBase(
              new URL(new URL(node.getAttribute(attr), resolved).origin).href,
            ) +
              new URL(node.getAttribute(attr), resolved).href.slice(
                new URL(node.getAttribute(attr), resolved).origin.length + 1,
              ),
          );
      for (const c of Array.from(node.childNodes))
        if (c.localName !== "BaseURL") walk(c, resolved);
    };
    walk(doc.documentElement, url);
    const base = doc.createElement("BaseURL");
    base.textContent = wrapBase(new URL(".", url).href);
    doc.documentElement.insertBefore(base, doc.documentElement.firstChild);
    return new XMLSerializer().serializeToString(doc);
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (
        req.headers.origin ||
        req.headers.host !== new URL(origin).host ||
        !["GET", "HEAD"].includes(req.method)
      )
        throw new Error("Forbidden");
      const route = new URL(req.url, origin);
      const parts = route.pathname.split("/");
      if (parts[1] !== secret || !mappings.has(parts[2]))
        throw new Error("Forbidden");
      const mapped = mappings.get(parts[2]);
      const tail = parts.slice(3).join("/");
      const target = mapped.endsWith("/")
        ? new URL(tail + route.search, mapped).href
        : mapped;
      const abort = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) abort.abort();
      });
      const { response: r, url } = await scopedFetch(target, context, {
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(45000)]),
        range: req.headers.range,
      });
      if (!r.ok) {
        failures.push(r.status);
        res.writeHead(r.status);
        return res.end("Media request failed");
      }
      const ct = r.headers.get("content-type") || "";
      const isHls = /mpegurl/i.test(ct) || /\.m3u8(?:\?|$)/i.test(url);
      const isDash = /dash\+xml/i.test(ct) || /\.mpd(?:\?|$)/i.test(url);
      if (isHls || isDash) {
        const parts = [];
        let size = 0;
        for await (const part of r.body) {
          size += part.length;
          if (size > 8 * 1024 * 1024) throw new Error("Manifest too large");
          parts.push(part);
        }
        const text = Buffer.concat(parts).toString("utf8");
        res.setHeader(
          "Content-Type",
          isHls ? "application/vnd.apple.mpegurl" : "application/dash+xml",
        );
        res.end(isHls ? hls(text, url) : dash(text, url));
        return;
      }
      res.statusCode = r.status;
      for (const h of [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
      ])
        if (r.headers.has(h)) res.setHeader(h, r.headers.get(h));
      if (req.method === "HEAD") {
        await r.body?.cancel();
        res.end();
        return;
      }
      if (r.body) {
        for await (const part of r.body) {
          if (res.destroyed) break;
          if (!res.write(part))
            await new Promise((resolve) => {
              res.once("drain", resolve);
              res.once("close", resolve);
            });
        }
      }
      res.end();
    } catch (e) {
      failureReason = e.message;
      if (!res.headersSent) res.writeHead(502);
      res.end("受保護、過期或無法讀取的媒體");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    url: wrap(context.url),
    get expectedDuration() {
      return expectedDuration;
    },
    get expectedAudio() {
      return expectedAudio;
    },
    failures,
    get error() {
      return failureReason;
    },
    close: () =>
      new Promise((r) => {
        server.close(r);
        server.closeAllConnections();
      }),
  };
}
