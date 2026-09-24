import crypto from "node:crypto";
import net from "node:net";
import dns from "node:dns/promises";
import path from "node:path";
import { isValidCaptureToken } from "./captureToken.js";
export const sessionToken = crypto.randomBytes(32).toString("hex");
export function equalToken(a, b) {
  const x = Buffer.from(String(a || "")),
    y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export function localOrigin(origin) {
  const port = String(process.env.PORT || 9800);
  return [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    ...(process.env.NODE_ENV === "production"
      ? []
      : ["http://localhost:5173", "http://127.0.0.1:5173"]),
  ].includes(origin);
}
export function localHost(host) {
  return [
    `localhost:${process.env.PORT || 9800}`,
    `127.0.0.1:${process.env.PORT || 9800}`,
  ].includes(host);
}
export function apiGuard(req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  if (
    !localHost(req.headers.host) ||
    (req.headers.origin && !localOrigin(req.headers.origin))
  )
    return res.status(403).json({ error: "不允許的來源" });
  if (req.path === "/session" && req.method === "GET") {
    if (req.headers["sec-fetch-site"] === "cross-site")
      return res.status(403).json({ error: "不允許的來源" });
    res.cookie("mg_session", sessionToken, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
    return res.json({ token: sessionToken });
  }
  if (req.path === "/status" && req.method === "GET") return next(); // public liveness/version only
  if (
    req.path.startsWith("/capture/") &&
    isValidCaptureToken(req.get("X-MediaGrab-Token"))
  )
    return next();
  if (req.path === "/quit" && isValidCaptureToken(req.get("X-MediaGrab-Token")))
    return next();
  if (!equalToken(req.get("X-MediaGrab-Session"), sessionToken))
    return res
      .status(401)
      .json({ error: "請重新載入 MediaGrab 以建立本機連線" });
  next();
}
export function authorizeWs(req) {
  const cookie = (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("mg_session="))
    ?.slice(11);
  return (
    localHost(req.headers.host) &&
    localOrigin(req.headers.origin) &&
    equalToken(cookie, sessionToken)
  );
}
export function safeError(error) {
  const s = String(error?.message || error || "下載失敗");
  return s
    .replace(
      /(?:cookie|authorization|x[-_](?:api[-_]key|auth[-_]token|mediagrab[-_]token))\s*[:=].*/gi,
      "[credential redacted]",
    )
    .replace(/(?:https?|file):\/\/[^\s"'<>]+/gi, "[url]")
    .slice(0, 400);
}
export function httpUrl(value) {
  if (typeof value !== "string" || value.length > 16384)
    throw new Error("Invalid URL");
  let u;
  try {
    u = new URL(value.trim());
  } catch {
    throw new Error("請提供完整的 http(s) 網址");
  }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw new Error("只支援不含帳密的 HTTP(S) 網址");
  return u.href;
}
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return /^(::|fc|fd|fe[89ab]|ff)/i.test(ip);
}
export async function resolvePublicUrl(value) {
  const url = httpUrl(value),
    u = new URL(url);
  const addresses = await dns.lookup(u.hostname.replace(/^\[|\]$/g, ""), {
    all: true,
  });
  if (
    !addresses.length ||
    (process.env.MEDIAGRAB_ALLOW_PRIVATE_TEST !== "1" &&
      addresses.some((a) => privateIp(a.address)))
  )
    throw new Error("不允許下載本機或私有網路來源");
  return { url, addresses };
}
export async function publicUrl(value) {
  return (await resolvePublicUrl(value)).url;
}
export function boundedBody(req, res, next) {
  try {
    const b = req.body || {};
    if (
      b.subtitleLanguages != null &&
      (typeof b.subtitleLanguages !== "string" ||
        b.subtitleLanguages.length > 100 ||
        !/^[a-zA-Z0-9.*,_-]+$/.test(b.subtitleLanguages))
    )
      throw new Error("Invalid subtitle languages");
    for (const k of ["url", "m3u8Url", "episodeUrl", "manifestUrl", "pageUrl"])
      if (b[k] != null) b[k] = httpUrl(b[k]);
    if (
      b.outputDir != null &&
      (typeof b.outputDir !== "string" ||
        !path.isAbsolute(b.outputDir) ||
        b.outputDir.includes("\0"))
    )
      throw new Error("Invalid outputDir");
    if (
      b.threads != null &&
      (!Number.isInteger(b.threads) || b.threads < 1 || b.threads > 16)
    )
      throw new Error("threads must be 1–16");
    if (
      b.duration != null &&
      b.duration !== "" &&
      (!Number.isFinite(Number(b.duration)) ||
        Number(b.duration) <= 0 ||
        Number(b.duration) > 604800)
    )
      throw new Error("Invalid duration");
    if (b.episodes && (!Array.isArray(b.episodes) || b.episodes.length > 500))
      throw new Error("批次上限為 500");
    for (const ep of b.episodes || [])
      for (const k of ["url", "m3u8Url", "episodeUrl"])
        if (ep[k]) ep[k] = httpUrl(ep[k]);
    next();
  } catch (e) {
    res.status(400).json({ error: safeError(e) });
  }
}
export function cleanHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const n = k.toLowerCase();
    if (
      ![
        "referer",
        "origin",
        "user-agent",
        "cookie",
        "authorization",
        "x-api-key",
        "x-auth-token",
        "x-playback-session-id",
        "range",
      ].includes(n)
    )
      continue;
    if (typeof v === "string" && v.length <= 16384 && !/[\r\n]/.test(v))
      out[n] = v;
  }
  return out;
}
