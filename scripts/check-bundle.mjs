import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
const root = path.resolve(process.argv[2]);
const win = process.platform === "win32";
const node = path.join(root, "node", win ? "node.exe" : "bin/node");
const lock = JSON.parse(
  fs.readFileSync(
    new URL("../packaging/engines.lock.json", import.meta.url),
    "utf8",
  ),
);
const binaries = {
  node,
  "yt-dlp": path.join(root, "bin", win ? "yt-dlp.exe" : "yt-dlp"),
  ffmpeg: path.join(root, "bin", win ? "ffmpeg.exe" : "ffmpeg"),
  ffprobe: path.join(root, "bin", win ? "ffprobe.exe" : "ffprobe"),
};
const inventory = [];
for (const [name, file] of Object.entries(binaries)) {
  const version = execFileSync(
    file,
    [name.startsWith("ff") ? "-version" : "--version"],
    { encoding: "utf8", timeout: 30000 },
  )
    .split("\n")[0]
    .trim();
  if (name === "node" && version !== "v" + lock.node)
    throw new Error("Unexpected bundled Node");
  if (name === "yt-dlp" && version !== lock.ytdlp)
    throw new Error("Unexpected bundled yt-dlp");
  inventory.push({
    name,
    version,
    sha256: crypto
      .createHash("sha256")
      .update(fs.readFileSync(file))
      .digest("hex"),
  });
}
fs.writeFileSync(
  path.join(root, "runtime-inventory.json"),
  JSON.stringify(inventory, null, 2),
);
console.log(
  JSON.stringify(
    inventory.map(({ name, version }) => ({ name, version })),
    null,
    2,
  ),
);
