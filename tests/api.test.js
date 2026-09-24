import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import WebSocket from "ws";
import net from "node:net";
import http from "node:http";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "mg-api-"));
let child, base, origin, token, cookie;
before(async () => {
  const port = await new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  base = `http://127.0.0.1:${port}`;
  origin = base;
  child = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      MEDIAGRAB_DATA_DIR: data,
      NODE_ENV: "production",
    },
    stdio: "pipe",
  });
  let error = "";
  child.stderr.on("data", (d) => (error += d));
  child.stdout.on("data", () => {});
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/status")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(child.exitCode, null, error);
  const session = await fetch(base + "/api/session");
  cookie = session.headers.get("set-cookie").split(";")[0];
  token = (await session.json()).token;
});
after(async () => {
  child?.kill("SIGTERM");
  if (child?.exitCode === null) await new Promise((r) => child.once("exit", r));
  fs.rmSync(data, { recursive: true, force: true });
});
const call = (route, options = {}) => fetch(base + route, options);
test("every sensitive endpoint rejects anonymous callers", async () => {
  for (const [method, route] of [
    ["GET", "/api/settings"],
    ["GET", "/api/download/tasks"],
    ["POST", "/api/quit"],
    ["POST", "/api/download/start"],
    ["POST", "/api/live/record"],
    ["POST", "/api/parse/probe"],
  ])
    assert.equal((await call(route, { method })).status, 401, route);
});
test("host, origin and session checks", async () => {
  assert.equal(
    (await call("/api/session", { headers: { Origin: "https://evil.test" } }))
      .status,
    403,
  );
  const badHost = await new Promise((resolve) => {
    http.get(base + "/api/session", { headers: { Host: "evil.test" } }, (r) => {
      r.resume();
      resolve(r.statusCode);
    });
  });
  assert.equal(badHost, 403);
  assert.equal(
    (await call("/api/settings", { headers: { "X-MediaGrab-Session": token } }))
      .status,
    200,
  );
  assert.equal(
    (
      await call("/api/settings", {
        headers: { "X-MediaGrab-Session": token, Origin: "null" },
      })
    ).status,
    403,
  );
});
test("input schema rejects unsafe URLs and limits", async () => {
  for (const body of [
    { url: "file:///etc/passwd" },
    { url: "https://a.test", threads: -1 },
    { episodes: Array(501).fill({ url: "https://a.test" }) },
  ])
    assert.equal(
      (
        await call("/api/download/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-MediaGrab-Session": token,
          },
          body: JSON.stringify(body),
        })
      ).status,
      400,
    );
});
test("capture requires native token, rejects incomplete segment-only streams", async () => {
  assert.equal(
    (
      await call("/api/capture/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    401,
  );
  const native = fs
    .readFileSync(path.join(data, "capture-token"), "utf8")
    .trim();
  const r = await call("/api/capture/download", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-MediaGrab-Token": native,
    },
    body: JSON.stringify({
      segmentUrls: ["https://a.test/1.ts", "https://a.test/2.ts"],
    }),
  });
  assert.equal(r.status, 501);
});
function connect(headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(base.replace("http", "ws") + "/ws", { headers });
    ws.once("open", () => {
      ws.close();
      resolve(true);
    });
    ws.once("error", () => resolve(false));
  });
}
test("WebSocket accepts only local origin plus session cookie", async () => {
  assert.equal(await connect({ Origin: origin }), false);
  assert.equal(
    await connect({ Origin: "https://evil.test", Cookie: cookie }),
    false,
  );
  assert.equal(await connect({ Origin: origin, Cookie: cookie }), true);
});
test("production page blocks third party scripts and frames", async () => {
  const r = await call("/");
  assert.equal(r.status, 200, "Build the production client before testing its CSP");
  assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(r.headers.get("content-security-policy"), /frame-src 'none'/);
});

test("native messaging handshake reports app, host and extension versions", async () => {
  const host = spawn(process.execPath, ["native-host/mediagrab-host.mjs"], {
    env: {
      ...process.env,
      MEDIAGRAB_PORT: new URL(base).port,
      MEDIAGRAB_DATA_DIR: data,
    },
    stdio: "pipe",
  });
  const payload = Buffer.from(
      JSON.stringify({ type: "ping", extensionVersion: "1.7.0" }),
    ),
    header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  const result = await new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error("host timeout")), 5000);
    host.stdout.on("data", (part) => {
      bytes = Buffer.concat([bytes, part]);
      if (bytes.length >= 4 && bytes.length >= bytes.readUInt32LE(0) + 4) {
        clearTimeout(timer);
        resolve(
          JSON.parse(bytes.subarray(4, 4 + bytes.readUInt32LE(0)).toString()),
        );
      }
    });
    host.on("error", reject);
    host.stdin.write(Buffer.concat([header, payload]));
  });
  host.kill();
  assert.equal(result.ok, true);
  assert.equal(result.hostVersion, "1.7.0");
  assert.equal(result.appVersion, "1.7.0");
});
