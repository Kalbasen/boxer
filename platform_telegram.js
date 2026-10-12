/* Lamp Games — платформенный слой для Telegram Mini Apps.
   Подставляет window.AndroidApp, который игра уже умеет использовать.
   Настройки (имя бота, ссылки на счета Stars, цены) — в tg_config.js (window.LAMP_TG).
   Рекламы нет: showRewarded не объявлен, поэтому кнопки «за рекламу» игра прячет сама. */
(function () {
  'use strict';
  var SAVE_KEY = 'podval-boxer-v1', CHUNK = 4000, MAXCH = 16;
  var CFG = window.LAMP_TG || {};
  var tg = null, booted = false, paused = false;
  var log = function () { try { console.log.apply(console, ['[LampTG]'].concat([].slice.call(arguments))); } catch (e) {} };
  function ver(v) { try { return tg && tg.isVersionAtLeast && tg.isVersionAtLeast(v); } catch (e) { return false; } }

  // ---------- облачные сохранения (Telegram CloudStorage, до 4096 символов на ключ) ----------
  var cs = null, origSet = Storage.prototype.setItem, pushT = 0, pending = null;
  function csCall(fn) {
    var args = [].slice.call(arguments, 1);
    return new Promise(function (res, rej) {
      try { cs[fn].apply(cs, args.concat([function (err, val) { err ? rej(err) : res(val); }])); } catch (e) { rej(e); }
    });
  }
  Storage.prototype.setItem = function (k, v) {
    origSet.call(this, k, v);
    if (this === window.localStorage && k === SAVE_KEY && cs) { pending = v; clearTimeout(pushT); pushT = setTimeout(flushCloud, 2000); }
  };
  function flushCloud() {
    if (!cs || pending == null) return;
    var v = pending; pending = null;
    var n = Math.ceil(v.length / CHUNK); if (n > MAXCH) { log('save too big', v.length); return; }
    var jobs = [];
    for (var i = 0; i < n; i++) jobs.push(csCall('setItem', 'sv' + i, v.slice(i * CHUNK, (i + 1) * CHUNK)));
    Promise.all(jobs).then(function () { return csCall('setItem', 'svn', String(n)); })
      .catch(function (e) { log('CloudStorage set', e); });
  }
  window.addEventListener('pagehide', flushCloud);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flushCloud(); });
  function lastOf(raw) { try { return JSON.parse(raw).last || 0; } catch (e) { return 0; } }
  function loadCloud() {
    if (!cs) return Promise.resolve();
    var keys = ['svn']; for (var i = 0; i < MAXCH; i++) keys.push('sv' + i);
    return csCall('getItems', keys).then(function (m) {
      m = m || {};
      var n = parseInt(m.svn || '0', 10); if (!n) return;
      var s = ''; for (var i = 0; i < n; i++) s += (m['sv' + i] || '');
      try { JSON.parse(s); } catch (e) { return; }
      var local = null; try { local = localStorage.getItem(SAVE_KEY); } catch (e) {}
      if (!local || lastOf(s) > lastOf(local)) origSet.call(localStorage, SAVE_KEY, s);
    }).catch(function (e) { log('CloudStorage get', e); });
  }

  // ---------- запуск кода игры ----------
  function bootGame() {
    if (booted) return; booted = true;
    var src = document.getElementById('game-main'), s = document.createElement('script');
    s.text = src ? src.textContent : '';
    document.body.appendChild(s);
  }

  // ---------- профиль, комнаты, «поделиться» ----------
  function tgUser() {
    var u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
    return u ? { id: u.id, first_name: u.first_name || '', last_name: u.last_name || '', photo_100: u.photo_url || '' } : null;
  }
  function appLink(param) {
    if (!CFG.bot) return '';
    var base = 'https://t.me/' + CFG.bot + (CFG.app ? '/' + CFG.app : '');
    return param ? base + (CFG.app ? '?startapp=' : '?start=') + encodeURIComponent(param) : base;
  }
  function launchRoom() {
    var p = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || '';
    var m = /^room_?([A-Za-z0-9]{3,10})$/.exec(p) ||
            /(?:^|[#&?])room=([A-Za-z0-9]{3,10})/.exec(location.hash || '') ||
            /(?:[?&])tgWebAppStartParam=room_?([A-Za-z0-9]{3,10})/.exec(location.search || '');
    return m ? m[1].toUpperCase() : '';
  }
  function share(url, text) {
    if (!url) return;
    var link = 'https://t.me/share/url?url=' + encodeURIComponent(url) + (text ? '&text=' + encodeURIComponent(text) : '');
    try { tg.openTelegramLink(link); } catch (e) { log('share', e); }
  }

  // ---------- покупки за Telegram Stars ----------
  var invoices = CFG.invoices || {}, prices = CFG.prices || {};
  function canPay() { return !!(tg && tg.openInvoice && ver('6.1') && Object.keys(invoices).length); }

  // ---------- пауза при сворачивании ----------
  function pause() { if (paused) return; paused = true; flushCloud(); try { window.onAdOpen && window.onAdOpen(); } catch (e) {} }
  function resume() { if (!paused) return; paused = false; try { window.onAdClose && window.onAdClose(); } catch (e) {} }

  // ---------- мост для игры ----------
  window.AndroidApp = {
    platform: function () { return 'telegram'; },
    version: function () { return 'web'; },
    canPay: function () { return canPay(); },
    getPrice: function (id) { return prices[id] ? String(prices[id]) + ' ⭐' : ''; },
    buy: function (id) {
      var url = invoices[id];
      if (!canPay() || !url) { setTimeout(function () { window.onPurchaseResult && window.onPurchaseResult(id, false); }, 0); return; }
      try {
        tg.openInvoice(url, function (status) {
          try { window.onPurchaseResult && window.onPurchaseResult(id, status === 'paid'); } catch (e) {}
          if (status === 'paid') flushCloud();
        });
      } catch (e) { log('openInvoice', e); window.onPurchaseResult && window.onPurchaseResult(id, false); }
    },
    showInterstitial: function () {},
    gameplayStart: function () {}, gameplayStop: function () {}, gameReady: function () {},
    getUser: function () { return tgUser(); },
    getLaunchRoom: function () { return launchRoom(); },
    inviteFriend: function (code) {
      code = String(code || '').toUpperCase();
      share(appLink('room_' + code), 'Вызываю тебя на бой в «Боксер: из подвала к поясу»! Код комнаты: ' + code);
    },
    shareWin: function (text) { share(appLink(''), String(text || '')); }
  };

  // ---------- инициализация ----------
  function init() {
    tg = window.Telegram && window.Telegram.WebApp;
    if (!tg) { log('Telegram WebApp не найден — запуск без платформы'); bootGame(); return; }
    cs = ver('6.9') ? tg.CloudStorage : null;
    try { tg.ready(); tg.expand(); } catch (e) {}
    try { tg.setHeaderColor('#101012'); tg.setBackgroundColor('#101012'); } catch (e) {}
    try { if (ver('7.7')) tg.disableVerticalSwipes(); } catch (e) {}
    try { if (ver('8.0') && /android|ios/.test(tg.platform || '')) { tg.requestFullscreen(); tg.lockOrientation(); } } catch (e) {}
    try {
      tg.BackButton.onClick(function () {
        var handled = false;
        try { handled = !!(window.onAndroidBack && window.onAndroidBack()); } catch (e) {}
        if (!handled) tg.showConfirm('Выйти из игры?', function (ok) { if (ok) { flushCloud(); tg.close(); } });
      });
      tg.BackButton.show();
    } catch (e) {}
    try { tg.onEvent('deactivated', pause); tg.onEvent('activated', resume); } catch (e) {}
    var guard = setTimeout(bootGame, 5000);
    loadCloud().then(function () { clearTimeout(guard); bootGame(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
