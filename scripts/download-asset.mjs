// Reviewed, pinned build artifacts. Fail before executing/extracting on mismatch.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const lock = JSON.parse(
  fs.readFileSync(
    new URL("../packaging/engines.lock.json", import.meta.url),
    "utf8",
  ),
);
const [key, destination] = process.argv.slice(2),
  asset = lock.artifacts[key];
if (!asset || !destination)
  throw new Error(
    "Usage: node scripts/download-asset.mjs <artifact-key> <destination>",
  );
const response = await fetch(asset.url, {
  signal: AbortSignal.timeout(180000),
});
if (!response.ok)
  throw new Error(`Artifact download failed: ${response.status}`);
const chunks = [];
let size = 0;
for await (const part of response.body) {
  size += part.length;
  if (size > 512 * 1024 * 1024) throw new Error("Artifact exceeds size limit");
  chunks.push(part);
}
const data = Buffer.concat(chunks),
  sha256 = crypto.createHash("sha256").update(data).digest("hex");
if (sha256 !== asset.sha256) throw new Error(`SHA-256 mismatch for ${key}`);
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, data);
console.log(`Verified ${key} (${size} bytes)`);
