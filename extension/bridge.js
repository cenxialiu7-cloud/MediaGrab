/**
 * MediaGrab bridge — ISOLATED-world content script. Relays between the MAIN-world
 * page hook (inject.js, via window.postMessage) and the extension background
 * (via chrome.runtime). inject.js can't use chrome.* APIs; this can't see the
 * page's patched globals — together they cover both worlds.
 */
(() => {
  // page hook → background
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__mediagrab !== 1) return;
    const { __mediagrab, ...payload } = d;
    try { chrome.runtime.sendMessage({ type: 'injected', payload }); } catch {}
  });

  // background → page hook (e.g. "record mode" download command)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'toPage' && msg.cmd) {
      window.postMessage({ __mediagrabCmd: 1, ...msg.cmd }, '*');
    }
  });
})();
