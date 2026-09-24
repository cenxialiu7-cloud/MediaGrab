import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mg-regression-"));
process.env.MEDIAGRAB_DATA_DIR = path.join(temp, "data");
process.env.MEDIAGRAB_ALLOW_PRIVATE_TEST = "1";
const { TaskManager, taskManager, publicTask } = await import(
  "../server/utils/taskManager.js"
);
const { headersFor, createMediaGateway } = await import(
  "../server/services/mediaGateway.js"
);
const { groupVideos } = await import("../server/services/playwright.js");
const { sanitizeFilename } = await import("../server/utils/filename.js");
const { cookieHeaderForUrl } = await import("../server/utils/cookies.js");
const { saveSettings } = await import("../server/utils/config.js");
const { safeError } = await import("../server/utils/security.js");
const { publicResource } = await import("../server/utils/resources.js");
const { startDownload } = await import("../server/services/ytdlp.js");
after(async () => {
  await taskManager.shutdown();
  fs.rmSync(temp, { recursive: true, force: true });
});

test("cookie scope: host-only, subdomain, path, secure and expiry", () => {
  const file = path.join(temp, "cookies.txt");
  fs.writeFileSync(
    file,
    "a.test\tFALSE\t/lesson\tTRUE\t0\tsession\tSECRET\n.test\tTRUE\t/\tFALSE\t1\texpired\tNO\n",
  );
  saveSettings({ cookiesFile: file });
  assert.equal(cookieHeaderForUrl("https://a.test/lesson/1"), "session=SECRET");
  for (const url of [
    "https://b.test/lesson",
    "https://sub.a.test/lesson",
    "http://a.test/lesson",
    "https://a.test/lessons",
  ])
    assert.equal(cookieHeaderForUrl(url), "");
  saveSettings({ cookiesFile: "" });
});
test("captured credentials scoped per exact resource and cookie attributes", () => {
  const ctx = {
    url: "https://a.test/hls/master.m3u8",
    headers: { Cookie: "A=SECRET", Authorization: "Bearer TOKEN" },
    contexts: { "https://b.test/part.ts": { Cookie: "B=OTHER" } },
    cookies: [
      {
        hostOnly: true,
        domain: "a.test",
        path: "/hls",
        secure: true,
        name: "s",
        value: "RIGHT",
      },
    ],
  };
  assert.equal(headersFor(ctx.url, ctx).authorization, "Bearer TOKEN");
  assert.deepEqual(headersFor("https://c.test/video", ctx), {});
  assert.equal(headersFor("https://a.test/hls/part.ts", ctx).cookie, "s=RIGHT");
  assert.equal(headersFor("https://a.test/other", ctx).cookie, undefined);
  assert.equal(headersFor("https://b.test/part.ts", ctx).cookie, "B=OTHER");
});
test("public DTOs do not expose credentials or source URLs", () => {
  const raw = {
    id: "a",
    title: "video",
    url: "https://secret.test/?token=SECRET",
    m3u8Url: "SECRET",
    headers: { Cookie: "SECRET" },
    contexts: { SECRET: 1 },
    error: "Authorization: Bearer SECRET\nCookie: a=1; secret=SECRET",
  };
  assert.ok(!JSON.stringify(publicTask(raw)).includes("SECRET"));
  assert.ok(!JSON.stringify(publicResource(raw)).includes("SECRET"));
  assert.ok(
    !safeError(
      "https://a.test/x?token=SECRET Authorization: Bearer SECRET",
    ).includes("SECRET"),
  );
});
test("different files in same directory remain distinct", () => {
  const candidates = ["a.mp4", "b.mp4", "a.m3u8", "b.m3u8"].map((name) => ({
    url: "https://cdn.test/" + name,
    type: name.endsWith("m3u8") ? "hls" : "mp4",
  }));
  assert.equal(groupVideos(candidates, "", "Page", {}).length, 4);
});
test("UTF8 filename length and Windows reserved name", () => {
  assert.ok(Buffer.byteLength(sanitizeFilename("影".repeat(500))) <= 180);
  assert.notEqual(sanitizeFilename("CON.txt"), "CON.txt");
});
test("queue never overbooks and cancelling paused task does not free another slot", async () => {
  const manager = new TaskManager({ persist: false });
  manager.maxConcurrent = 1;
  const runs = [];
  const make = () =>
    manager.createTask({
      startFn: (t) =>
        new Promise((resolve) => {
          runs.push(t.id);
          t.controller.signal.addEventListener("abort", resolve, {
            once: true,
          });
        }),
    });
  const a = make(),
    b = make();
  manager.processQueue();
  await new Promise((r) => setImmediate(r));
  assert.equal(manager.activeCount, 1);
  assert.deepEqual(runs, [a.id]);
  await manager.pauseTask(a.id);
  await new Promise((r) => setImmediate(r));
  assert.equal(manager.activeCount, 1);
  assert.equal(b.status, "downloading");
  await manager.cancelTask(a.id);
  assert.equal(manager.activeCount, 1);
  manager.completeTask(a.id, "invalid");
  assert.equal(a.status, "cancelled");
  await manager.shutdown();
  assert.equal(manager.activeCount, 0);
});
test("encrypted journal restores unfinished tasks paused", () => {
  const manager = new TaskManager();
  const t = manager.createTask({
    url: "https://a.test/?token=JOURNALSECRET",
    headers: { Cookie: "JOURNALSECRET" },
  });
  assert.ok(
    !fs
      .readFileSync(path.join(process.env.MEDIAGRAB_DATA_DIR, "tasks.enc"))
      .includes("JOURNALSECRET"),
  );
  const restored = new TaskManager();
  assert.equal(restored.tasks.get(t.id).status, "paused");
  assert.equal(restored.activeCount, 0);
});

let fixtureServer, origin;
const media = path.join(temp, "media");
fs.mkdirSync(media);
function ff(args) {
  execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    { stdio: "pipe" },
  );
}
const hasMediaTools = (() => {
  try {
    execFileSync("ffmpeg", ["-version"]);
    execFileSync("ffprobe", ["-version"]);
    execFileSync("yt-dlp", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();
if (process.env.MEDIAGRAB_REQUIRE_MEDIA_TESTS === "1")
  assert.ok(hasMediaTools, "Release CI requires working ffmpeg, ffprobe and yt-dlp");
test(
  "media integration: direct MP4, full HLS, missing HLS fragment and protected DASH",
  { skip: !hasMediaTools, timeout: 120000 },
  async (t) => {
    ff([
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=128x96:rate=10",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440",
      "-t",
      "4",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "10",
      "-c:a",
      "aac",
      path.join(media, "source.mp4"),
    ]);
    ff([
      "-i",
      path.join(media, "source.mp4"),
      "-c",
      "copy",
      "-hls_time",
      "1",
      "-hls_list_size",
      "0",
      path.join(media, "full.m3u8"),
    ]);
    ff([
      "-i",
      path.join(media, "source.mp4"),
      "-map",
      "0",
      "-c",
      "copy",
      "-seg_duration",
      "1",
      "-use_template",
      "1",
      "-use_timeline",
      "1",
      "-f",
      "dash",
      path.join(media, "clear.mpd"),
    ]);
    ff([
      "-i",
      path.join(media, "source.mp4"),
      "-c",
      "copy",
      "-hls_time",
      "1",
      "-hls_list_size",
      "0",
      "-hls_segment_type",
      "fmp4",
      "-hls_flags",
      "single_file",
      path.join(media, "range.m3u8"),
    ]);
    ff([
      "-i",
      path.join(media, "source.mp4"),
      "-map",
      "0:v",
      "-c",
      "copy",
      "-hls_time",
      "1",
      "-hls_list_size",
      "0",
      path.join(media, "video.m3u8"),
    ]);
    ff([
      "-i",
      path.join(media, "source.mp4"),
      "-map",
      "0:a",
      "-c",
      "copy",
      "-hls_time",
      "1",
      "-hls_list_size",
      "0",
      path.join(media, "audio.m3u8"),
    ]);
    const master =
      '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Main",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=300000,CODECS="avc1.64000a,mp4a.40.2",AUDIO="audio"\nvideo.m3u8\n';
    fs.writeFileSync(path.join(media, "master.m3u8"), master);
    fs.writeFileSync(
      path.join(media, "noaudio.m3u8"),
      master.replace('URI="audio.m3u8"', 'URI="absent-audio.m3u8"'),
    );
    const key2 = crypto.randomBytes(16);
    fs.writeFileSync(path.join(media, "key2.bin"), key2);
    const key = crypto.randomBytes(16);
    fs.writeFileSync(path.join(media, "key.bin"), key);
    const enc = [
      "#EXTM3U",
      "#EXT-X-TARGETDURATION:1",
      "#EXT-X-MEDIA-SEQUENCE:37",
      "#EXT-X-VERSION:3",
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
    ];
    for (let i = 0; i < 4; i++) {
      if (i === 1) enc.push('#EXT-X-KEY:METHOD=AES-128,URI="key2.bin"');
      if (i === 2) enc.push("#EXT-X-KEY:METHOD=NONE");
      if (i < 2) {
        const iv = Buffer.alloc(16);
        iv.writeUInt32BE(37 + i, 12);
        const c = crypto.createCipheriv(
          "aes-128-cbc",
          i === 0 ? key : key2,
          iv,
        );
        fs.writeFileSync(
          path.join(media, `encrypted${i}.ts`),
          Buffer.concat([
            c.update(fs.readFileSync(path.join(media, `full${i}.ts`))),
            c.final(),
          ]),
        );
      }
      enc.push("#EXTINF:1.0,", i < 2 ? `encrypted${i}.ts` : `full${i}.ts`);
    }
    enc.push("#EXT-X-ENDLIST");
    fs.writeFileSync(path.join(media, "aes.m3u8"), enc.join("\n"));
    let text = fs.readFileSync(path.join(media, "full.m3u8"), "utf8");
    fs.writeFileSync(
      path.join(media, "missing.m3u8"),
      text.replace("full1.ts", "absent.ts"),
    );
    fs.writeFileSync(
      path.join(media, "drm.mpd"),
      '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet><ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/></AdaptationSet></Period></MPD>',
    );
    fixtureServer = http.createServer((req, res) => {
      const file = path.join(
        media,
        path.basename(new URL(req.url, "http://localhost").pathname),
      );
      if (!fs.existsSync(file)) {
        if (!req.url.includes("absent"))
          console.error("Missing synthetic media fixture", { request: req.url, files: fs.readdirSync(media), manifest: fs.readFileSync(path.join(media, "clear.mpd"), "utf8") });
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader(
        "Content-Type",
        file.endsWith(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : file.endsWith(".mpd")
            ? "application/dash+xml"
            : file.endsWith(".ts")
              ? "video/mp2t"
              : "video/mp4",
      );
      const size = fs.statSync(file).size;
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]),
          end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        res.statusCode = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
        res.setHeader("Content-Length", end - start + 1);
        fs.createReadStream(file, { start, end }).pipe(res);
      } else {
        res.setHeader("Content-Length", size);
        fs.createReadStream(file).pipe(res);
      }
    });
    await new Promise((r) => fixtureServer.listen(0, "127.0.0.1", r));
    origin = `http://127.0.0.1:${fixtureServer.address().port}`;
    try {
      for (const name of [
        "source.mp4",
        "full.m3u8",
        "clear.mpd",
        "aes.m3u8",
        "range.m3u8",
        "master.m3u8",
        "noaudio.m3u8",
        "missing.m3u8",
      ]) {
        await t.test(name, async () => {
          const task = taskManager.createTask({
            url: `${origin}/${name}`,
            title: name,
            outputDir: path.join(temp, "downloads"),
            useCapturedHeaders: true,
            startFn: startDownload,
          });
          const progress=[];const originalUpdate=taskManager.updateTask;
          taskManager.updateTask=function(id,updates){if(id===task.id&&updates.speed&&updates.progress>0)progress.push(updates.progress);return originalUpdate.call(this,id,updates);};
          taskManager.processQueue();
          try{await task.runDone;}finally{taskManager.updateTask=originalUpdate;}
          if(name==='source.mp4')assert.ok(progress.length>0,'engine must emit download progress');
          if (["missing.m3u8", "noaudio.m3u8"].includes(name))
            assert.equal(task.status, "error", task.error);
          else {
            assert.equal(task.status, "completed", task.error);
            const frames = (file) =>
              execFileSync(
                "ffmpeg",
                [
                  "-v",
                  "error",
                  "-i",
                  file,
                  "-map",
                  "0:v:0",
                  "-f",
                  "framemd5",
                  "-",
                ],
                { encoding: "utf8" },
              )
                .split("\n")
                .filter((l) => l && !l.startsWith("#"))
                .map((l) => l.split(",").at(-1).trim());
            assert.deepEqual(
              frames(task.outputPath),
              frames(path.join(media, "source.mp4")),
              "decoded frames differ",
            );
            if (name === "source.mp4")
              assert.deepEqual(
                fs.readFileSync(task.outputPath),
                fs.readFileSync(path.join(media, name)),
              );
          }
        });
      }
      await t.test("DRM rejected", async () => {
        const gateway = await createMediaGateway({ url: origin + "/drm.mpd" });
        try {
          assert.equal((await fetch(gateway.url)).status, 502);
        } finally {
          await gateway.close();
        }
      });
    } finally {
      await new Promise((r) => fixtureServer.close(r));
    }
  },
);

test("extension staging repairs same-version modified content", async () => {
  const { stageExtension, stagedExtensionDir } = await import(
    "../server/utils/extensionStaging.js"
  );
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    stageExtension();
    const file = path.join(stagedExtensionDir(), "background.js");
    fs.writeFileSync(file, "corrupt");
    stageExtension();
    assert.notEqual(fs.readFileSync(file, "utf8"), "corrupt");
  } finally {
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
});
test("engine checksum mismatch is rejected before execution", async () => {
  const { checkHash } = await import("../server/utils/ytdlpUpdate.js");
  assert.throws(() =>
    checkHash(Buffer.from("bad"), "0".repeat(64) + "  yt-dlp", "yt-dlp"),
  );
});
test("cancel stops owned process tree and further file writes", async () => {
  const { spawn } = await import("node:child_process");
  const file = path.join(temp, "writer.txt"),
    manager = new TaskManager({ persist: false });
  const task = manager.createTask({
    startFn: (t) =>
      new Promise((resolve) => {
        t.process = spawn(
          process.execPath,
          [
            "-e",
            `const fs=require('fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(file)},'x'),20);`,
          ],
          { detached: process.platform !== "win32", stdio: "ignore" },
        );
        t.process.on("close", resolve);
      }),
  });
  manager.processQueue();
  for (let i = 0; i < 100 && !fs.existsSync(file); i++)
    await new Promise((r) => setTimeout(r, 20));
  assert.ok(fs.existsSync(file));
  await manager.cancelTask(task.id);
  const size = fs.statSync(file).size;
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(fs.statSync(file).size, size);
  assert.equal(manager.activeCount, 0);
  assert.equal(task.status, "cancelled");
});

test("redirect does not forward another origin credentials", async () => {
  const { scopedFetch } = await import("../server/services/mediaGateway.js");
  let received;
  const destination = http.createServer((req, res) => {
    received = req.headers;
    res.end("ok");
  });
  await new Promise((r) => destination.listen(0, "127.0.0.1", r));
  const source = http.createServer((req, res) => {
    res.writeHead(302, {
      Location: `http://127.0.0.1:${destination.address().port}/media`,
    });
    res.end();
  });
  await new Promise((r) => source.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${source.address().port}/manifest`;
  try {
    const { response } = await scopedFetch(url, {
      url,
      headers: { Cookie: "SECRET", Authorization: "Bearer SECRET" },
    });
    assert.equal(await response.text(), "ok");
    assert.equal(received.cookie, undefined);
    assert.equal(received.authorization, undefined);
  } finally {
    await Promise.all([
      new Promise((r) => source.close(r)),
      new Promise((r) => destination.close(r)),
    ]);
  }
});
