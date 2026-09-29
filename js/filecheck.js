// Opened straight from a folder (file://)? Browsers block the 3D modules and data there,
// so instead of hanging on "LOADING FLY…" explain what to do. A classic script, so it runs on file://.
(function () {
  if (location.protocol !== 'file:') return;
  var online = 'https://louiscreatesai.github.io/fly-gym/' + (location.pathname.split('/').pop() || 'menu.html') + location.search;
  var isMac = /Mac/.test(navigator.platform || navigator.userAgent);
  function show() {
    document.body.innerHTML =
      '<div style="min-height:100vh;display:grid;place-items:center;background:#090b13;color:#eef0ff;font:16px/1.5 Segoe UI,system-ui,sans-serif;padding:24px">' +
      '<div style="max-width:560px;background:#12152a;border:1px solid rgba(190,200,255,.14);border-radius:16px;padding:28px">' +
      '<h1 style="margin:0 0 10px;font-size:26px">Fly Gym needs one more click</h1>' +
      '<p style="color:#b9bfdc;margin:0 0 18px">Browsers block 3D pages opened straight from a folder. Start it with the launcher instead:</p>' +
      '<p style="margin:0 0 18px;font-size:18px"><b>Double-click <span style="color:#f0abfc">' + (isMac ? 'start.command' : 'Start Fly Gym.bat') + '</span></b> in this folder.</p>' +
      '<p style="color:#b9bfdc;margin:0 0 22px">Or just use the online version:</p>' +
      '<a href="' + online + '" style="display:block;text-align:center;background:rgba(139,92,246,.35);border:1px solid rgba(167,139,250,.8);color:#f1eaff;text-decoration:none;font-weight:700;padding:13px;border-radius:10px">Open Fly Gym online</a>' +
      '</div></div>';
  }
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();
