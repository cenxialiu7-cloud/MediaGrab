// Isolated browser integration. Never opens the user's Chrome profile.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "mg-browser-"));
const server = http.createServer((req, res) => {
  if (req.url === "/frame") {
    res.setHeader("Content-Type", "text/html");
    res.end('<video src="/c.mp4"></video>');
    return;
  }
  if (/\.(mp4|mp3)$/.test(req.url)) {
    res.writeHead(200, {
      "Content-Type": req.url.endsWith("mp3") ? "audio/mpeg" : "video/mp4",
    });
    res.end();
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<title>Media fixture</title><video src="/a.mp4"></video><video src="/b.mp4"></video><audio src="/sound.mp3"></audio><iframe src="/frame"></iframe>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const source = `http://127.0.0.1:${server.address().port}`;
const probe = http.createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const cookies = path.join(data, "cookies.txt");
fs.writeFileSync(
  cookies,
  "unrelated.test\tFALSE\t/\tFALSE\t0\tother\tDO_NOT_LEAK\n",
);
fs.writeFileSync(
  path.join(data, "settings.json"),
  JSON.stringify({ cookiesFile: cookies, autoUpdateEngine: false }),
);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server/index.js"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    MEDIAGRAB_DATA_DIR: data,
    MEDIAGRAB_ALLOW_PRIVATE_TEST: "1",
  },
  stdio: "pipe",
});
child.stdout.resume();
child.stderr.resume();
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/status")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MEDIAGRAB_CHROME
      ? { executablePath: process.env.MEDIAGRAB_CHROME }
      : {}),
  });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page
    .getByText("本機 v1.7.0", { exact: false })
    .waitFor({ timeout: 20000 });
  assert.equal(await page.locator("iframe").count(), 0);
  assert.equal(await page.locator('script[src^="http"]').count(), 0);
  const result = await page.evaluate(async (source) => {
    const { token } = await (await fetch("/api/session")).json();
    const r = await fetch("/api/parse/scan-page", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MediaGrab-Session": token,
      },
      body: JSON.stringify({ url: source }),
    });
    return { status: r.status, data: await r.json() };
  }, source);
  assert.equal(result.status, 200);
  assert.ok(result.data.videos.length >= 3, JSON.stringify(result.data));
  assert.ok(!JSON.stringify(result).includes("DO_NOT_LEAK"));
  assert.ok(
    result.data.videos.every((v) => v.resourceId && !v.headers && !v.url),
  );
  await page.screenshot({
    path: path.resolve("../browser-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.resolve("../browser-mobile.png"),
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  assert.equal(overflow, false, "mobile overflow");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      version: "1.7.0",
      resources: result.data.videos.length,
      credentialLeaks: 0,
      remoteExecutableAds: 0,
      pageErrors: errors,
      mobileOverflow: overflow,
    }),
  );
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  if (child.exitCode === null) await new Promise((r) => child.once("exit", r));
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  fs.rmSync(data, { recursive: true, force: true });
}
