import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
function harness() {
  const session = {};
  const ev = () => ({
    listener: null,
    addListener(fn) {
      this.listener = fn;
    },
    hasListener() {
      return false;
    },
    removeListener() {},
  });
  const chrome = {
    permissions: {
      getAll(cb) {
        const p = { origins: ["<all_urls>"] };
        cb?.(p);
        return Promise.resolve(p);
      },
      async contains() {
        return false;
      },
      onAdded: ev(),
      onRemoved: ev(),
    },
    storage: {
      local: {
        async get() {
          return { enabledOrigins: [] };
        },
        async set() {},
      },
      session: {
        async get(k) {
          await new Promise((r) => setTimeout(r, 1));
          return structuredClone({ [k]: session[k] });
        },
        async set(o) {
          await new Promise((r) => setTimeout(r, 1));
          Object.assign(session, structuredClone(o));
        },
        async remove(k) {
          delete session[k];
        },
      },
    },
    tabs: {
      async get() {
        return { url: "https://course.test/lesson" };
      },
      onUpdated: ev(),
      onRemoved: ev(),
    },
    webRequest: { onSendHeaders: ev(), onHeadersReceived: ev() },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
    scripting: {
      async getRegisteredContentScripts() {
        return [];
      },
      async registerContentScripts() {},
    },
    runtime: {
      onInstalled: ev(),
      onStartup: ev(),
      onMessage: ev(),
      getManifest() {
        return { version: "1.7.0" };
      },
    },
  };
  const ctx = { chrome, URL, console, setTimeout, structuredClone, crypto };
  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync(
      new URL("../extension/background.js", import.meta.url),
      "utf8",
    ),
    ctx,
  );
  return { ctx, chrome, session };
}
test("100 concurrent capture writes survive, multi-video and headers stay separate", async () => {
  const { ctx } = harness();
  await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      ctx.captureUrl(1, `https://cdn.test/${i}/master.m3u8`, "manifest", {
        Cookie: `s=${i}`,
      }),
    ),
  );
  const cap = await ctx.getCap(1);
  assert.equal(cap.manifests.length, 100);
  assert.equal(Object.keys(cap.resources).length, 100);
  assert.equal(
    cap.resources["https://cdn.test/0/master.m3u8"].headers.Cookie,
    "s=0",
  );
  assert.equal(
    cap.resources["https://cdn.test/99/master.m3u8"].headers.Cookie,
    "s=99",
  );
});
test("extensionless media retains matching requestId headers", async () => {
  const { ctx } = harness();
  await ctx.onSendHeadersCapture({
    tabId: 2,
    requestId: "one",
    url: "https://cdn.test/opaque",
    requestHeaders: [{ name: "Authorization", value: "Bearer ONE" }],
  });
  await ctx.onSendHeadersCapture({
    tabId: 2,
    requestId: "two",
    url: "https://ads.test/opaque",
    requestHeaders: [{ name: "Authorization", value: "Bearer TWO" }],
  });
  await ctx.onHeadersReceivedCapture({
    tabId: 2,
    requestId: "one",
    url: "https://cdn.test/opaque",
    responseHeaders: [
      { name: "Content-Type", value: "application/vnd.apple.mpegurl" },
    ],
  });
  await new Promise((r) => setTimeout(r, 20));
  const cap = await ctx.getCap(2);
  assert.equal(
    cap.resources["https://cdn.test/opaque"].headers.Authorization,
    "Bearer ONE",
  );
});
test("untrusted content script cannot read capture or trigger native download", async () => {
  const { chrome } = harness();
  for (const type of ["getCapture", "nativeDownload", "recordDownload"]) {
    const reply = await new Promise((resolve) =>
      chrome.runtime.onMessage.listener(
        { type, tabId: 1 },
        { tab: { id: 1 } },
        resolve,
      ),
    );
    assert.equal(reply.ok, false);
  }
});
