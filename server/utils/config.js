import fs from "node:fs";
import os from "node:os";
import path from "node:path";
export const DATA_DIR =
  process.env.MEDIAGRAB_DATA_DIR || path.join(os.homedir(), ".mediagrab");
export const defaults = {
  outputDir: path.join(os.homedir(), "Downloads", "MediaGrab"),
  maxConcurrent: 3,
  threadsPerTask: 8,
  language: "zh-TW",
  theme: "dark",
  autoStartQueue: true,
  cookies: "",
  cookiesFile: "",
  disableAds: true,
  autoUpdateEngine: false,
};
export function loadSettings() {
  try {
    return {
      ...defaults,
      ...JSON.parse(
        fs.readFileSync(path.join(DATA_DIR, "settings.json"), "utf8"),
      ),
    };
  } catch {
    return { ...defaults };
  }
}
export function saveSettings(value) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const p = path.join(DATA_DIR, "settings.json");
  fs.writeFileSync(p + ".tmp", JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(p + ".tmp", p);
}
export function validateSettings(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (!(k in defaults)) continue;
    if (["maxConcurrent", "threadsPerTask"].includes(k)) {
      if (
        !Number.isInteger(v) ||
        v < 1 ||
        v > (k === "maxConcurrent" ? 10 : 16)
      )
        throw new Error("Invalid " + k);
    } else if (typeof defaults[k] !== typeof v) throw new Error("Invalid " + k);
    if (typeof v === "string" && (v.length > 4096 || /[\r\n\0]/.test(v)))
      throw new Error("Invalid " + k);
    if (["outputDir", "cookiesFile"].includes(k) && v && !path.isAbsolute(v))
      throw new Error(k + " must be an absolute path");
    if (
      k === "cookies" &&
      v &&
      ![
        "chrome",
        "chromium",
        "firefox",
        "safari",
        "edge",
        "brave",
        "opera",
        "vivaldi",
      ].includes(v)
    )
      throw new Error("Invalid browser");
    out[k] = v;
  }
  return out;
}
