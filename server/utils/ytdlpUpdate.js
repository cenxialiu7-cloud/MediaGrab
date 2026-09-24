import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { DATA_DIR } from "./config.js";
const BIN_DIR = path.join(DATA_DIR, "bin");
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
export function prependBinToPath() {
  try {
    const meta = JSON.parse(
      fs.readFileSync(path.join(BIN_DIR, "verified.json"), "utf8"),
    );
    if (
      !["yt-dlp", "yt-dlp.exe"].includes(meta.bin) ||
      hash(fs.readFileSync(path.join(BIN_DIR, meta.bin))) !== meta.sha256
    )
      return;
    process.env.PATH = BIN_DIR + path.delimiter + (process.env.PATH || "");
  } catch {}
}
export async function fetchLimited(url, max = 150 * 1024 * 1024) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error("Engine download failed");
  let size = 0;
  const chunks = [];
  for await (const chunk of r.body) {
    size += chunk.length;
    if (size > max) {
      throw new Error("Engine asset too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function checkHash(buffer, sums, asset) {
  const row = sums.split(/\r?\n/).find(
    (line) =>
      line
        .trim()
        .split(/\s+\*?/)
        .at(-1) === asset,
  );
  const expected = row?.match(/^[a-f0-9]{64}/i)?.[0];
  if (!expected || hash(buffer) !== expected.toLowerCase())
    throw new Error("下載檔 SHA-256 驗證失敗");
  return expected.toLowerCase();
}
function runsOk(file, version) {
  return new Promise((resolve) => {
    const p = spawn(file, ["--version"], { timeout: 15000 });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0 && out.trim() === version));
  });
}
export async function maybeUpdateYtdlp() {
  let tmp, dest, backup;
  try {
    const marker = path.join(BIN_DIR, ".last-check");
    try {
      if (Date.now() - Number(fs.readFileSync(marker, "utf8")) < 86400000)
        return;
    } catch {}
    fs.mkdirSync(BIN_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(marker, String(Date.now()));
    const release = JSON.parse(
      (
        await fetchLimited(
          "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest",
          2 * 1024 * 1024,
        )
      ).toString(),
    );
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(release.tag_name))
      throw new Error("Invalid release");
    const version = release.tag_name,
      asset =
        process.platform === "win32"
          ? "yt-dlp.exe"
          : process.platform === "darwin"
            ? "yt-dlp_macos"
            : "yt-dlp";
    const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/`;
    const sums = (
      await fetchLimited(base + "SHA2-256SUMS", 1024 * 1024)
    ).toString();
    const data = await fetchLimited(base + asset);
    const sha256 = checkHash(data, sums, asset);
    const bin = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
    dest = path.join(BIN_DIR, bin);
    backup = dest + ".bak";
    tmp = path.join(
      BIN_DIR,
      process.platform === "win32" ? "candidate.exe" : "candidate",
    );
    fs.writeFileSync(tmp, data, { mode: 0o700 });
    if (!(await runsOk(tmp, version))) throw new Error("新引擎無法執行");
    if (fs.existsSync(dest)) {
      fs.rmSync(backup, { force: true });
      fs.renameSync(dest, backup);
    }
    fs.renameSync(tmp, dest);
    fs.writeFileSync(
      path.join(BIN_DIR, "verified.json"),
      JSON.stringify({ bin, version, sha256 }),
      { mode: 0o600 },
    );
    console.log(
      "[mediagrab] verified engine update ready for next launch:",
      version,
    );
  } catch {
    if (tmp)
      try {
        fs.rmSync(tmp, { force: true });
      } catch {}
    if (dest && backup && !fs.existsSync(dest) && fs.existsSync(backup))
      try {
        fs.renameSync(backup, dest);
      } catch {}
    console.warn(
      "[mediagrab] engine update unavailable; keeping current engine",
    );
  }
}
