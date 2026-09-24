import fs from "node:fs";
const read = (name) =>
  JSON.parse(fs.readFileSync(new URL("../" + name, import.meta.url), "utf8"));
const version = read("package.json").version;
for (const file of [
  "client/package.json",
  "extension/manifest.json",
  "package-lock.json",
  "client/package-lock.json",
  "docs/version.json",
])
  if (read(file).version !== version)
    throw new Error(`${file}: version differs from ${version}`);
const tag = process.env.GITHUB_REF?.match(/^refs\/tags\/v(.+)$/)?.[1];
if (tag && tag !== version)
  throw new Error(`Tag v${tag} differs from source v${version}`);
if (process.env.RELEASE_VERSION && process.env.RELEASE_VERSION !== version)
  throw new Error("Requested installer version differs from source");
console.log(
  `Version aligned: app/client/extension/lockfiles/website source v${version}`,
);

for(const [file,patterns]of [
 ['packaging/MediaGrab.app/Contents/Info.plist',[/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)/,/<key>CFBundleVersion<\/key>\s*<string>([^<]+)/]],
 ['packaging-windows/installer.iss',[/#define MyAppVersion\s+"([^"]+)"/]]
]){const text=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');for(const pattern of patterns)if(text.match(pattern)?.[1]!==version)throw new Error(file+': installer version mismatch');}
