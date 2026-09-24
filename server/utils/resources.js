import crypto from "node:crypto";
const records = new Map();
const TTL = 30 * 60 * 1000;
export function storeResource(value) {
  const now = Date.now();
  for (const [id, r] of records) if (r.expires < now) records.delete(id);
  if (records.size >= 2000) records.delete(records.keys().next().value);
  const id = crypto.randomUUID();
  records.set(id, { ...value, expires: now + TTL });
  return id;
}
export function getResource(id) {
  const r = records.get(id);
  if (!r || r.expires < Date.now())
    throw new Error("偵測資料已過期，請重新掃描／播放影片");
  return { ...r };
}
export function publicResource(v) {
  return {
    id: v.id,
    title: v.title,
    type: v.type,
    resourceId: storeResource(v),
    thumbnail: null,
    qualities: (v.qualities || []).map((q) => ({
      label: q.label,
      resourceId: storeResource({
        ...v,
        url: q.url,
        headers: q.headers || v.headers,
        qualities: [],
      }),
    })),
    source: v.source,
  };
}
