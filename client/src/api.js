let pending;
export function getSession() {
  if (!pending)
    pending = window
      .fetch("/api/session", { credentials: "same-origin" })
      .then((r) => {
        if (!r.ok) throw new Error("本機連線失敗");
        return r.json();
      })
      .then((d) => d.token)
      .catch((e) => {
        pending = null;
        throw e;
      });
  return pending;
}
export async function apiFetch(url, options = {}) {
  const token = await getSession();
  const res = await window.fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { ...options.headers, "X-MediaGrab-Session": token },
  });
  if (!res.ok) {
    if (res.status === 401) pending = null;
    const d = await res.json().catch(() => ({}));
    throw new Error(
      [d.error || `HTTP ${res.status}`, d.suggestion]
        .filter(Boolean)
        .join(" · "),
    );
  }
  return res;
}

export function resetSession() {
  pending = null;
}
