/* ===================== 认证 ===================== */
  // 解析 sync_store 返回的 data 字段（兼容 JSONB 对象和 TEXT 字符串）
  function parseStoreData(d) {
    if (!d) return null;
    if (typeof d === 'string') {
      try { d = JSON.parse(d); } catch(e) { return d; }
    }
    return d;
  }

  function getUserProfile() {
    return window.__profile || { nickname: '用户', avatar_idx: 0, gender: '' };
  }

  function getAvatarHtml(profile, size) {
    size = size || 28;
    // 自定义上传头像优先
    if (profile && profile.avatar_url) {
      return '<span style="display:inline-flex;align-items:center;justify-content:center;width:' + size + 'px;height:' + size + 'px;border-radius:50%;overflow:hidden;flex-shrink:0;position:relative"><img src="' + profile.avatar_url + '" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;object-position:center center;display:block" alt="头像"></span>';
    }
    var ai = (profile && profile.avatar_idx !== undefined) ? profile.avatar_idx : 0;
    var emoji = (profile && profile.avatar_emoji) || AVATAR_PRESETS[ai] || '🌸';
    var bg = (profile && profile.avatar_bg) || '#FFE4E1';
    return '<span style="display:inline-flex;align-items:center;justify-content:center;width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + bg + ';font-size:' + Math.round(size*0.55) + 'px;flex-shrink:0">' + emoji + '</span>';
  }

  // 预设头像（与 auth.html 保持一致）
  var AVATAR_PRESETS = ['🌸','🌿','☀️','🌙','⭐','🦋','🐱','🌈','🍀','💜','🌊','🔥','🌻','🐼','🍓','🎀','💎','🌹','🦊','🐰'];

  // 性别判断：只有女性才显示经期记录
  function isFemaleUser() {
    var profile = getUserProfile();
    return profile && profile.gender === 'female';
  }

  function handleLogout() {
    localStorage.removeItem("wb_auth_data");
    localStorage.removeItem("sb_session");
    sessionStorage.removeItem("sb_session");
    window.location.replace("auth.html");
  }

  /* ===================== 云同步（自动按用户隔离 · fetch 直连 Supabase REST API）==================== */
  let syncConnected = false;
  let syncTimer = null;
  let lastSyncedAt = null;
  let lastLocalUpdate = Date.now();
  let syncConfig = null; // { url, key, userId }

  function getUserId() {
    var auth = window.__auth;
    return auth && auth.user ? auth.user.id : null;
  }

  /* ---- fetch 封装 ---- */
  function sbFetch(config, method, path, body, extraHeaders) {
    var headers = {
      'apikey': config.key,
      'Authorization': 'Bearer ' + config.key,
      'Content-Type': 'application/json'
    };
    if (extraHeaders) {
      var parts = extraHeaders.split(': ');
      if (parts.length === 2) headers[parts[0]] = parts[1];
    }
    var opts = { method: method, headers: headers };
    if (body) opts.body = JSON.stringify(body);
    return fetch(config.url + '/rest/v1/' + path, opts).then(function(r) {
      if (!r.ok) return r.text().then(function(t) { var e = new Error('HTTP ' + r.status); try { var j = JSON.parse(t); e.message = j.message || j.error || t; } catch (_) { e.message = t; } throw e; });
      var ct = r.headers.get('content-type') || '';
      return ct.indexOf('application/json') >= 0 ? r.json() : r.text();
    });
  }

  /* ---- 自动初始化同步配置（使用用户ID隔离数据）---- */
  function initSyncConfig() {
    var uid = getUserId();
    if (!uid) return;
    syncConfig = {
      url: 'https://dyvzxlntyqebblewpihj.supabase.co',
      key: 'sb_publishable_kSGB8khWFcMSemqJ1m6Rxw_pI4gGrhc',
      userId: uid
    };
  }

  function doUpload() {
    if (!syncConfig) return Promise.resolve();
    return sbFetch(syncConfig, 'POST', 'sync_store', {
      group_key: syncConfig.userId,
      store: 'wb_yingling_v2',
      data: state,
      updated_at: new Date().toISOString()
    }, 'Prefer: resolution=merge-duplicates');
  }

  function downloadAndMerge() {
    if (!syncConfig) return Promise.resolve();
    return sbFetch(syncConfig, 'GET', 'sync_store?group_key=eq.' + encodeURIComponent(syncConfig.userId) + '&store=eq.wb_yingling_v2&select=data,updated_at&limit=1', null)
      .then(function(arr) {
        if (arr && arr.length > 0 && arr[0].data) {
          var rawData = parseStoreData(arr[0].data);
          if (!rawData) return;
          var merged = mergeStateData(state, rawData);
          if (JSON.stringify(merged) !== JSON.stringify(state)) {
            state = merged; save(); renderAll();
            if (rawData && JSON.stringify(rawData).length > 10) {
              toast('已从云端同步数据 📥');
            }
          }
        }
        lastSyncedAt = Date.now();
      })
      .catch(function(e) { console.log('下载合并失败:', e.message); });
  }

  /* ---- UI 状态 ---- */
  function updateSyncUI(connected) {
    var label = document.getElementById('syncLabel');
    var btn = document.getElementById('cloudBtn');
    if (!btn) return;
    var btnLabel = btn.querySelector('.cloud-label');
    var dot = document.getElementById('syncDot');
    if (connected) {
      if (label) label.textContent = '已同步';
      if (btnLabel) btnLabel.textContent = '已同步';
      btn.style.background = 'var(--g100)';
      btn.style.color = 'var(--g500)';
      btn.style.borderColor = 'var(--g300)';
      if (dot) dot.style.background = 'var(--success)';
    } else {
      if (label) label.textContent = '离线';
      if (btnLabel) btnLabel.textContent = '同步中';
      btn.style.background = 'var(--g50)';
      btn.style.color = 'var(--g400)';
      btn.style.borderColor = 'var(--g200)';
      if (dot) dot.style.background = 'var(--g200)';
    }
  }

  function toggleCloudPanel() {
    if (!syncConnected) {
      // 手动触发同步
      if (syncConfig) {
        doUpload().then(function() {
          lastSyncedAt = Date.now();
          toast('数据已同步 ✅');
        }).catch(function() {
          toast('同步失败，请检查网络', 'error');
        });
      }
      return;
    }
    // 已连接，手动上传
    doUpload().then(function() {
      lastSyncedAt = Date.now();
      toast('数据已同步 ✅');
    }).catch(function() {
      toast('同步失败', 'error');
    });
  }

  /* ---- 数据合并 ---- */
  function mergeStateData(local, cloud) {
    var merged = {};
    for (var k in local) { if (local.hasOwnProperty(k)) merged[k] = local[k]; }
    for (var key in cloud) {
      if (!cloud.hasOwnProperty(key)) continue;
      if (key === 'meta') { merged.meta = Object.assign({}, local.meta, cloud.meta); }
      else if (Array.isArray(cloud[key])) {
        var localArr = local[key] || [];
        var cloudArr = cloud[key] || [];
        // 判断是否为简单值数组（如 holidays: ['08-02','08-03']）
        var isSimpleArr = true;
        for (var ai = 0; ai < localArr.length; ai++) { if (localArr[ai] !== null && typeof localArr[ai] === 'object') { isSimpleArr = false; break; } }
        if (isSimpleArr) {
          for (var aj = 0; aj < cloudArr.length; aj++) { if (cloudArr[aj] !== null && typeof cloudArr[aj] === 'object') { isSimpleArr = false; break; } }
        }
        if (isSimpleArr) {
          // 简单值数组 → 云端直接替换（pollSync 已通过时间戳确保云端更新，避免并集导致删除操作丢失）
          merged[key] = cloudArr.slice();
        } else {
          // 对象数组 → id map 合并；若元素无 id 则云端直接替换
          var map = {};
          var hasIds = false;
          localArr.forEach(function(item) { if (item && item.id) { map[item.id] = item; hasIds = true; } });
          cloudArr.forEach(function(item) { if (item && item.id) { map[item.id] = item; hasIds = true; } });
          if (hasIds) {
            merged[key] = Object.keys(map).map(function(id) { return map[id]; });
          } else {
            // 无 id 的对象数组（如 periods: [{start,duration}]），云端直接替换避免数据丢失
            merged[key] = cloudArr.slice();
          }
        }
      } else if (typeof cloud[key] === 'object' && cloud[key] !== null && typeof local[key] === 'object') {
        merged[key] = Object.assign({}, local[key], cloud[key]);
      } else { merged[key] = cloud[key]; }
    }
    return merged;
  }

  /* ---- 实时双向同步：每 3 秒轮询，云端和本地互相同步 ---- */
  var _syncLoopTimer = null;
  var _lastPollRemoteHash = null;

  function startAutoSync() {
    if (_syncLoopTimer) clearInterval(_syncLoopTimer);
    _syncLoopTimer = setInterval(pollSync, 3000);
  }

  function stopAutoSync() {
    if (_syncLoopTimer) { clearInterval(_syncLoopTimer); _syncLoopTimer = null; }
  }

  async function pollSync() {
    if (!syncConfig || !syncConnected) return;
    try {
      // 1) 查询云端最新时间戳
      var arr = await sbFetch(syncConfig, 'GET',
        'sync_store?group_key=eq.' + encodeURIComponent(syncConfig.userId) +
        '&store=eq.wb_yingling_v2&select=updated_at&limit=1', null);

      var cloudTime = 0;
      if (arr && arr.length > 0 && arr[0].updated_at) {
        cloudTime = new Date(arr[0].updated_at).getTime();
      }

      // 2) 如果云端比本地新 → 下载合并（另一台设备改过数据）
      if (cloudTime > lastLocalUpdate && cloudTime > (lastSyncedAt || 0)) {
        var full = await sbFetch(syncConfig, 'GET',
          'sync_store?group_key=eq.' + encodeURIComponent(syncConfig.userId) +
          '&store=eq.wb_yingling_v2&select=data,updated_at&limit=1', null);
        if (full && full.length > 0 && full[0].data) {
          // 用时间戳判断云端是否真的更新了
          var fullCloudTime = new Date(full[0].updated_at).getTime();
          var hash = JSON.stringify(full[0].data).slice(0, 100);
          // 防止同一份数据重复拉取
          if (fullCloudTime > lastLocalUpdate && hash !== _lastPollRemoteHash) {
            _lastPollRemoteHash = hash;
            var merged = mergeStateData(state, full[0].data);
            var mergedJson = JSON.stringify(merged);
            var stateJson = JSON.stringify(state);
            if (mergedJson !== stateJson) {
              state = merged;
              localStorage.setItem(STORE_KEY, JSON.stringify(state));
              renderAll();
              lastLocalUpdate = Date.now(); // 标记为已合并，不再回传
            }
          }
        }
      }
      // 3) 如果本地比云端新 → 上传（本设备刚改过数据）
      else if (lastLocalUpdate > cloudTime && lastLocalUpdate > (lastSyncedAt || 0)) {
        var upBody = { group_key: syncConfig.userId, store: 'wb_yingling_v2', data: state, updated_at: new Date().toISOString() };
        await sbFetch(syncConfig, 'POST', 'sync_store', upBody, 'Prefer: resolution=merge-duplicates');
        lastSyncedAt = Date.now();
      }
    } catch (e) {
      // 网络波动静默忽略
    }
  }

  // 页面加载时自动初始化同步（基于登录用户）
  initSyncConfig();
  if (syncConfig && syncConfig.userId) {
    // 从云端加载 profile（可能在其他设备修改过）
    sbFetch(syncConfig, 'GET', 'sync_store?group_key=eq.' + encodeURIComponent('profile_' + syncConfig.userId) + '&store=eq.wb_user_profile&select=data&limit=1', null)
      .then(function(arr) {
        if (arr && arr.length > 0 && arr[0].data) {
          var cloudProfile = parseStoreData(arr[0].data);
          // 合并到本地 profile
          var authData = localStorage.getItem('wb_auth_data');
          if (authData) {
            try {
              var parsed = JSON.parse(authData);
              parsed.profile = Object.assign({}, parsed.profile || {}, cloudProfile);
              window.__profile = parsed.profile;
              localStorage.setItem('wb_auth_data', JSON.stringify(parsed));
            } catch(e) {}
          }
        }
        // 不管有没有更新，都刷新 header
        if (typeof renderHead === 'function') renderHead();
      })
      .catch(function() { /* 网络不可用，使用本地数据 */ });

    // 快速测试连接并启动同步
    sbFetch(syncConfig, 'GET', 'sync_store?group_key=eq.' + encodeURIComponent(syncConfig.userId) + '&store=eq.wb_yingling_v2&select=updated_at&limit=1', null)
      .then(function() {
        syncConnected = true;
        updateSyncUI(true);
        startAutoSync();
        // 首次拉取云端数据
        downloadAndMerge();
      })
      .catch(function() {
        syncConnected = false;
        updateSyncUI(false);
        // 即使连接失败也不影响本地使用
      });
  }

  /* ---- 网络状态监听：断网暂停、恢复后自动同步 ---- */
  var _wasOffline = false;
  window.addEventListener('online', function() {
    if (_wasOffline && syncConfig) {
      _wasOffline = false;
      doTestConnection().then(function(ok) {
        syncConnected = ok;
        updateSyncUI(ok);
        if (ok) {
          startAutoSync();
          pollSync();
          toast('网络已恢复，正在同步... 🔄');
        }
      });
    }
  });
  window.addEventListener('offline', function() {
    _wasOffline = true;
    syncConnected = false;
    updateSyncUI(false);
    stopAutoSync();
  });

  /* ---- 页面可见性监听：切回前台时自动拉取最新数据 ---- */
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden && syncConfig && syncConnected) {
      pollSync();
    }
  });

  /* ===================== 数据层 ===================== */
  const STORE_KEY = 'wb_yingling_v2';
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') };
  const yday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') };

  /* ---- 日期占位符解析：将 JSON 中的 __TODAY__ / __YESTERDAY__ 替换为实际日期 ---- */
  function resolvePlaceholders(obj, todayStr, ydayStr) {
    if (typeof obj === 'string') {
      if (obj === '__TODAY__') return todayStr;
      if (obj === '__YESTERDAY__') return ydayStr;
      return obj;
    }
    if (Array.isArray(obj)) {
      for (var _i = 0; _i < obj.length; _i++) {
        obj[_i] = resolvePlaceholders(obj[_i], todayStr, ydayStr);
      }
    } else if (obj && typeof obj === 'object') {
      for (var _k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, _k)) {
          obj[_k] = resolvePlaceholders(obj[_k], todayStr, ydayStr);
        }
      }
    }
    return obj;
  }

  const fmtDate = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const db = (a, b) => { const d1 = new Date(a), d2 = new Date(b); return Math.round((d2 - d1) / 864e5) };
  const $ = id => document.getElementById(id);
  const esc = s => (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function toast(m) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = m;
    document.body.appendChild(t); setTimeout(() => t.remove(), 1800);
  }
  function conf(m, cb) {
    window._confCb = cb;
    openModal({
      title: '确认操作',
      body: '<div style="padding:8px 0;font-size:14px;line-height:1.6">' + m + '</div>',
      foot: '<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" style="background:var(--danger);color:#fff" onclick="closeModal();if(window._confCb){var f=window._confCb;window._confCb=null;f()}">确认</button>'
    });
  }

  /* ===================== 每日心灵语录 ===================== */
  const SOUL_QUOTES = [
    "你比你相信的更勇敢，比你看起来更强大，比你想象的更聪明。",
    "每一个不曾起舞的日子，都是对生命的辜负。",
    "慢慢来，比较快。",
    "你不需要完美，你只需要完整。",
    "今天的不开心就止于此吧，明天依旧光芒万丈。",
    "允许一切发生，然后记得做一个勇敢的人。",
    "生活不是等待暴风雨过去，而是学会在雨中跳舞。",
    "你是自己的太阳，无需借谁的光。",
    "每一次呼吸都是新的开始。",
    "温柔要有，但不是妥协。",
    "保持心脏震荡，有人等你共鸣。",
    "万物皆有裂痕，那是光照进来的地方。",
    "你已经做得很好了，真的。",
    "做你自己，因为别人都有人做了。",
    "世界喧嚣，你做你自己就好。",
    "不必行色匆匆，不必光芒四射，不必成为别人。",
    "心若向阳，无畏悲伤。",
    "当下的每一刻，都是你生命中最年轻的时刻。",
    "相信自己，你值得拥有最好的。",
    "日子很长，过客很多，也不必太在意。"
  ];
  function getDailyQuote() {
    var d = new Date();
    var seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    return SOUL_QUOTES[seed % SOUL_QUOTES.length];
  }
  function getRandomQuote() {
    return SOUL_QUOTES[Math.floor(Math.random() * SOUL_QUOTES.length)];
  }
  function renderSoulQuote() {
    var el = document.getElementById('soulQuote');
    if (!el) return;
    var saved = state._soulQuote;
    var todayStr = today();
    if (!saved || saved.date !== todayStr) {
      saved = { date: todayStr, text: getDailyQuote() };
      state._soulQuote = saved;
      save();
    }
    el.textContent = saved.text;
  }
  function refreshSoulQuote() {
    var q = getRandomQuote();
    state._soulQuote = { date: today(), text: q };
    save();
    renderSoulQuote();
    toast('已更换语录 ✨');
  }

  let HABITS = [];      // 从 data.json 加载
  let CATEGORIES = [];  // 从 data.json 加载

  // 计划分类：好听的名字 + 图标 + CSS class
  let defData = null; // 从 data.json 异步加载

  function loadData() {
    try {
      const r = localStorage.getItem(STORE_KEY);
      if (!r) return JSON.parse(JSON.stringify(defData));
      const d = JSON.parse(r);
      if (!d.meta || d.meta.version < 2) {
        d.meta = { version: 2, created: d.meta?.created || today() };
        if (!d.workouts) d.workouts = defData.workouts;
        if (!d.customHabits) d.customHabits = [];
        if (!d.weather) d.weather = null;
        if (!d.mood) d.mood = defData.mood;
        if (!d.workTasks) d.workTasks = defData.workTasks;
        if (!d.events) d.events = defData.events;
        if (!d.trainLogs) d.trainLogs = defData.trainLogs;
        if (!d.restDays) d.restDays = [];
        if (!d.periods) d.periods = [];
        if (!d.studyModules) d.studyModules = defData.studyModules;
        if (!d.holidays) d.holidays = [];
        if (!d.healthTarget) d.healthTarget = null;
        // 迁移旧工作任务：补 deadline + completedDate + progress + stages
        if (d.workTasks) d.workTasks.forEach(t => {
          if (!t.deadline) t.deadline = today();
          if (t.done && !t.completedDate) t.completedDate = today();
          if (t.progress === undefined) t.progress = t.done ? 100 : 0;
          if (t.stages === undefined) t.stages = 1;
          if (t.completedStages === undefined) t.completedStages = 0;
        });
        if (d.measure) d.measure.forEach(m => { if (m.calf === undefined) m.calf = null });
      }
      // 迁移旧体重：补 bodyFat
      if (d.weight) d.weight.forEach(w => { if (w.bodyFat === undefined) w.bodyFat = null });
      // 确保所有 todos 有 done 字段
      if (d.todos) d.todos.forEach(t => { if (t.done === undefined) t.done = false });
      // 迁移旧目标：无 type 字段的按 category 推断
      if (d.goals) d.goals.forEach(g => {
        if (!g.type) {
          if (g.category === 'health' && g.unit === 'kg') {
            g.type = 'metric';
            const ws = [...(d.weight || [])].sort((a, b) => a.date.localeCompare(b.date));
            g.startValue = g.startValue || (ws.length ? ws[0].weight : g.target + 7.5);
          }
          else g.type = 'task';
        }
        // 迁移旧 measureTgt → bodyFatTgt
        if (g.measureTgt !== undefined) {
          if (typeof g.measureTgt === 'string' && g.measureTgt) {
            // 尝试从字符串中提取数字（如 "腰围65cm" → 忽略，直接默认22）
            g.bodyFatTgt = 22;
          }
          delete g.measureTgt;
        }
        if (g.bodyFatTgt === undefined) g.bodyFatTgt = 0;
        if (g.rewardRedeemed === undefined) g.rewardRedeemed = false;
      });
      return d;
    } catch (e) { return JSON.parse(JSON.stringify(defData)) }
  }

  /* ==================== 页面设置常量（必须在loadSettings()调用前定义） ==================== */
  const SETTINGS_KEY = 'wb_yingling_settings';
  let DEFAULT_SETTINGS = null; // 从 data.json 异步加载
  var appSettings = DEFAULT_SETTINGS;

  /* ---- 颜色工具：hex ↔ HSL，动态生成色阶 ---- */
  function hexToRgb(hex) { var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return { r: r / 255, g: g / 255, b: b / 255 }; }
  function rgbToHex(r, g, b) { var t = function (x) { var h = Math.round(x * 255).toString(16); return h.length === 1 ? '0' + h : h; }; return '#' + t(r) + t(g) + t(b); }
  function rgbToHsl(r, g, b) { var M = Math.max(r, g, b), m = Math.min(r, g, b), d = M - m, h = 0, s = 0, l = (M + m) / 2; if (d !== 0) { s = l > .5 ? d / (2 - M - m) : d / (M + m); if (M === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6; else if (M === g) h = ((b - r) / d + 2) / 6; else h = ((r - g) / d + 4) / 6; } return { h: h, s: s, l: l }; }
  function hslToRgb(h, s, l) { var r, g, b; if (s === 0) { r = g = b = l; } else { var q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; var h2rgb = function (p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }; r = h2rgb(p, q, h + 1 / 3); g = h2rgb(p, q, h); b = h2rgb(p, q, h - 1 / 3); } return { r: r, g: g, b: b }; }

  function generateAccentPalette(hex) {
    var c = hexToRgb(hex), hsl = rgbToHsl(c.r, c.g, c.b), h = hsl.h, s = hsl.s, l = hsl.l;
    var sLow = Math.max(0.08, s * 0.35), sMid = Math.max(0.1, s * 0.55), sHigh = Math.max(0.1, s * 0.78);
    return {
      '--acc': hex,
      '--g500': rgbToHex.apply(null, Object.values(hslToRgb(h, s, Math.max(0.06, l - 0.13)))),
      '--g400': hex,
      '--g300': rgbToHex.apply(null, Object.values(hslToRgb(h, sHigh, Math.min(0.88, l + 0.1)))),
      '--g200': rgbToHex.apply(null, Object.values(hslToRgb(h, sMid, Math.min(0.94, l + 0.2)))),
      '--g100': rgbToHex.apply(null, Object.values(hslToRgb(h, sLow, Math.min(0.97, l + 0.3)))),
      '--g50': rgbToHex.apply(null, Object.values(hslToRgb(h, sLow * 0.8, Math.min(0.98, l + 0.34)))),
    };
  }

  let state = null; // 异步加载 data.json 后初始化
  let todoViewDate = null; // 在 initApp 中赋值
  let calYear, calMonth;
  function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); lastLocalUpdate = Date.now(); autoCloudSave() }
  /* 自动云端保存（防抖 1.5 秒，失败自动重试最多 3 次） */
  var _cloudSavePending = null;
  var _cloudSaveRetries = 0;
  function autoCloudSave() {
    if (!syncConfig || !syncConnected) return;
    if (_cloudSavePending) clearTimeout(_cloudSavePending);
    _cloudSavePending = setTimeout(function() {
      doUpload()
        .then(function() {
          lastSyncedAt = Date.now();
          _cloudSaveRetries = 0;
          var btnLabel = document.querySelector('#cloudBtn .cloud-label');
          if (btnLabel) {
            var orig = btnLabel.textContent;
            btnLabel.textContent = '已同步';
            setTimeout(function() { if (btnLabel.textContent === '已同步') btnLabel.textContent = orig; }, 2000);
          }
        })
        .catch(function() {
          _cloudSaveRetries++;
          if (_cloudSaveRetries < 3) { setTimeout(autoCloudSave, 5000); }
        });
      _cloudSavePending = null;
    }, 1500);
  }

  /* ===================== 目标体重 & 起始体重 ===================== */
  function getTargetWeight() {
    return (state.healthTarget && state.healthTarget.weight) || null;
  }
  function getStartWeight() {
    if (state.healthTarget && state.healthTarget.startWeight != null) {
      return state.healthTarget.startWeight;
    }
    const ws = [...state.weight].sort((a, b) => a.date.localeCompare(b.date));
    return ws.length ? ws[0].weight : null;
  }

  function openHealthTargetModal() {
    var tgt = getTargetWeight();
    var start = getStartWeight();
    openModal({
      title: '设置健康目标',
      body: '<div style="padding:8px 0">' +
        '<div class="form-group"><label>目标体重 (kg)</label>' +
        '<input class="inp" type="number" id="htWeight" value="' + (tgt != null ? tgt : '') + '" step="0.1" min="30" max="200" placeholder="比如 55.0">' +
        '</div>' +
        '<div class="form-group"><label>起始体重 (kg) <span style="font-weight:400;color:var(--ink-light);font-size:10px">用于计算进度，不填则自动取最早记录</span></label>' +
        '<input class="inp" type="number" id="htStartWeight" value="' + (start != null ? start : '') + '" step="0.1" min="30" max="200" placeholder="比如 65.0">' +
        '</div>' +
        '</div>',
      foot: '<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveHealthTarget()">保存</button>'
    });
  }
  function saveHealthTarget() {
    var w = parseFloat(document.getElementById('htWeight').value);
    var swInput = document.getElementById('htStartWeight').value.trim();
    var sw = swInput ? parseFloat(swInput) : null;
    if (!w || w < 30 || w > 200) return toast('请输入合理的目标体重 (30-200 kg)');
    if (sw != null && (sw < 30 || sw > 200)) return toast('请输入合理的起始体重 (30-200 kg)');
    if (!state.healthTarget) state.healthTarget = {};
    state.healthTarget.weight = w;
    if (sw != null) state.healthTarget.startWeight = sw;
    else delete state.healthTarget.startWeight;
    save(); closeModal(); renderAll();
    toast('健康目标已更新');
  }

  /* ===================== 页头 ===================== */
  function renderHead() {
    var profile = getUserProfile();
    var d = new Date();
    var wk = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    $('dateLine').textContent = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 · 星期' + wk;
    var h = d.getHours();
    var g = '下午好';
    if (h < 6) g = '凌晨好'; else if (h < 11) g = '早上好'; else if (h < 13) g = '中午好'; else if (h < 18) g = '下午好'; else g = '晚上好';
    var avatarHtml = getAvatarHtml(profile, 28);
    $('greetLine').innerHTML = g + '，' + avatarHtml + ' <span class="mood-wrap" style="margin-left:2px"><span class="mood-trigger" id="moodIcon" onclick="toggleMoodPanel(event)" title="选择心情"><svg id="moodIconSvg" viewBox="0 0 24 24" width="22" height="22"></svg></span><span class="mood-backdrop" id="moodBackdrop" onclick="closeMoodPanel()"></span><span class="mood-panel" id="moodPanel"></span></span>';
    if (!state.mood || state.mood.date !== today()) { state.mood = { date: today(), value: 'happy' }; }
    renderMoodIcon();
  }
  function renderBkHint() {
    const total = state.weight.length + state.goals.length + state.study.length + Object.keys(state.habits).length + (state.measure?.length || 0) + (state.events?.length || 0);
    if (total >= 30) { $('bkHint').style.display = 'flex'; $('bkHintText').textContent = '已积累 ' + total + ' 条数据，建议检查云同步状态'; }
    else $('bkHint').style.display = 'none';
  }
  var MOODS = []; // 从 data.json 加载
  function getMoodCfg(v) { return MOODS.find(function (m) { return m.value === v }) || MOODS[1]; }

  function renderMoodIcon() {
    var cfg = getMoodCfg(state.mood.value);
    var svg = document.getElementById('moodIconSvg'); if (!svg) return;
    svg.style.color = cfg.color;
    svg.innerHTML = cfg.face;
    document.getElementById('moodIcon').title = '心情：' + cfg.label + '（点击选择）';
    // Build panel options
    buildMoodPanel();
  }
  function buildMoodPanel() {
    var panel = document.getElementById('moodPanel'); if (!panel) return;
    var cur = state.mood.value;
    panel.innerHTML = MOODS.map(function (m) {
      return '<div class="mood-option' + (m.value === cur ? ' active' : '') + '" onclick="selectMood(\'' + m.value + '\',event)" title="' + m.label + '">' +
        '<svg viewBox="0 0 24 24" width="28" height="28" style="color:' + m.color + '">' + m.face + '</svg>' +
        '<span class="mood-lbl">' + m.label + '</span></div>';
    }).join('');
  }
  function toggleMoodPanel(e) {
    e.stopPropagation();
    var panel = document.getElementById('moodPanel');
    var backdrop = document.getElementById('moodBackdrop');
    var trigger = document.getElementById('moodIcon');
    var isOpen = panel.classList.contains('show');
    if (isOpen) { closeMoodPanel(); return; }
    buildMoodPanel();
    panel.classList.add('show');
    backdrop.classList.add('show');
    trigger.classList.add('open');
  }
  function closeMoodPanel() {
    var panel = document.getElementById('moodPanel');
    var backdrop = document.getElementById('moodBackdrop');
    var trigger = document.getElementById('moodIcon');
    panel.classList.remove('show');
    backdrop.classList.remove('show');
    trigger.classList.remove('open');
  }
  function selectMood(v, e) {
    if (e) e.stopPropagation();
    state.mood.value = v;
    state.mood.date = today();
    save(); renderMoodIcon(); closeMoodPanel();
    var cfg = getMoodCfg(v);
    toast('心情：' + cfg.label);
  }

  /* ===================== 天气 + 穿衣建议 ===================== */
  // 用 Open-Meteo 免费 API + 浏览器定位
  var WEATHER_CODES = []; // 从 data.json 加载

  function weatherCode(c) {
    for (var i = 0; i < WEATHER_CODES.length; i++) { if (WEATHER_CODES[i][0] === c) return WEATHER_CODES[i]; }
    return ['未知', '未知'];
  }

  function weatherIcon(type) {
    switch (type) {
      case 'sunny': return '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" fill="#FFB347" stroke="#E8A04A" stroke-width="0.5"/><g stroke="#FFB347" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/></g></svg>';
      case 'cloudy': return '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" fill="#FFCC80" stroke="#F0B060" stroke-width="0.5"/><g stroke="#FFB347" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="7" y1="5.5" x2="8.5" y2="6"/><line x1="15.5" y1="18" x2="17" y2="18.5"/></g><path d="M4 15 Q8 11 12 12 Q16 10 20 15" fill="#B0C4DE" stroke="#8BA4BC" stroke-width="1" stroke-linecap="round"/><path d="M3 17 Q7 13 11 14.5 Q15 12 19 17" fill="#C8D8E8" stroke="#9BB3C8" stroke-width="1" stroke-linecap="round"/></svg>';
      case 'fog': return '<svg viewBox="0 0 24 24" fill="none"><line x1="4" y1="8" x2="20" y2="8" stroke="#B0C4DE" stroke-width="2" stroke-linecap="round"/><line x1="6" y1="11" x2="18" y2="11" stroke="#C8D8E8" stroke-width="2" stroke-linecap="round"/><line x1="5" y1="14" x2="19" y2="14" stroke="#B0C4DE" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="17" x2="16" y2="17" stroke="#C8D8E8" stroke-width="2" stroke-linecap="round"/></svg>';
      case 'drizzle': return '<svg viewBox="0 0 24 24" fill="none"><path d="M4 13 Q8 9 12 10 Q16 8 20 13" fill="#B0C4DE" stroke="#8BA4BC" stroke-width="1" stroke-linecap="round"/><g stroke="#7EB8DA" stroke-width="1.5" stroke-linecap="round"><line x1="8" y1="15" x2="7" y2="19"/><line x1="12" y1="15" x2="11" y2="19"/><line x1="16" y1="15" x2="15" y2="19"/></g></svg>';
      case 'rain': return '<svg viewBox="0 0 24 24" fill="none"><path d="M4 12 Q8 8 12 9 Q16 6 20 12" fill="#9BB3C8" stroke="#7A96B0" stroke-width="1" stroke-linecap="round"/><g stroke="#5B8DAD" stroke-width="1.8" stroke-linecap="round"><line x1="7" y1="15" x2="5" y2="21"/><line x1="12" y1="15" x2="10" y2="21"/><line x1="17" y1="15" x2="15" y2="21"/></g></svg>';
      case 'snow': return '<svg viewBox="0 0 24 24" fill="none"><path d="M4 11 Q8 7 12 8 Q16 5 20 11" fill="#D0DEE8" stroke="#B0C0D0" stroke-width="1" stroke-linecap="round"/><circle cx="7" cy="15" r="1.2" fill="#D0E8F8"/><circle cx="12" cy="16" r="1.2" fill="#D0E8F8"/><circle cx="17" cy="15" r="1.2" fill="#D0E8F8"/><circle cx="9" cy="19" r="1.2" fill="#D0E8F8"/><circle cx="14" cy="20" r="1.2" fill="#D0E8F8"/></svg>';
      case 'sleet': return '<svg viewBox="0 0 24 24" fill="none"><path d="M4 11 Q8 7 12 8 Q16 5 20 11" fill="#C0D0DE" stroke="#A0B4C4" stroke-width="1" stroke-linecap="round"/><circle cx="8" cy="15" r="1" fill="#B8D8E8"/><line x1="12" y1="15" x2="10" y2="20" stroke="#7EB8DA" stroke-width="1.5" stroke-linecap="round"/><circle cx="15" cy="16" r="1" fill="#B8D8E8"/><line x1="17" y1="17" x2="15" y2="21" stroke="#7EB8DA" stroke-width="1.5" stroke-linecap="round"/></svg>';
      case 'thunder': return '<svg viewBox="0 0 24 24" fill="none"><path d="M4 12 Q8 8 12 9 Q16 6 20 12" fill="#8897A8" stroke="#6E7D8E" stroke-width="1" stroke-linecap="round"/><polygon points="12,13 9,18 11.5,18 10,23 15,17 12.5,17 14,13" fill="#FFD700" stroke="#E8B800" stroke-width="0.5"/></svg>';
      default: return weatherIcon('cloudy');
    }
  }

  function clothesAdvice(temp) {
    if (temp < 5) return '厚羽绒服 + 围巾手套';
    if (temp < 10) return '棉服 / 羽绒服';
    if (temp < 15) return '厚外套 / 风衣';
    if (temp < 20) return '薄外套 / 卫衣';
    if (temp < 25) return '长袖衬衫 / 薄T恤';
    if (temp < 30) return '短袖T恤 / 裙子';
    if (temp < 35) return '凉爽短袖 + 防晒';
    return '超薄夏装 + 注意防暑';
  }

  function fetchWeather() {
    if (!navigator.geolocation) {
      // 无定位，用缓存或显示获取不到
      var cached = state.weather;
      if (cached) { renderWeather(cached); }
      return;
    }
    // 尝试用缓存（当天有效）
    var cached = state.weather;
    if (cached && cached.date === today()) {
      renderWeather(cached);
      // 缓存缺城市名 → 异步补获取
      if (!cached.city) fetchCityByLatLng(parseFloat(cached.lat || 0), parseFloat(cached.lng || 0), cached);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var lat = pos.coords.latitude.toFixed(2);
        var lng = pos.coords.longitude.toFixed(2);
        var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lng + '&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m&timezone=auto';
        fetch(url).then(function (r) { return r.json(); }).then(function (d) {
          var c = d.current;
          var wd = weatherCode(c.weather_code);
          var data = {
            date: today(),
            lat: parseFloat(lat), lng: parseFloat(lng),
            temp: Math.round(c.temperature_2m),
            feel: Math.round(c.apparent_temperature),
            desc: wd[1],
            type: wd[2],
            humidity: c.relative_humidity_2m,
            wind: c.wind_speed_10m,
            clothes: clothesAdvice(c.apparent_temperature),
            city: ''
          };
          // 反向地理编码获取城市名
          fetch('https://nominatim.openstreetmap.org/reverse?lat=' + lat + '&lon=' + lng + '&format=json&accept-language=zh&zoom=10')
            .then(function (r) { return r.json(); })
            .then(function (geo) {
              var addr = geo.address || {};
              data.city = addr.city || addr.town || addr.county || addr.village || addr.suburb || addr.state || '';
              state.weather = data;
              save();
              renderWeather(data);
            })
            .catch(function () {
              state.weather = data;
              save();
              renderWeather(data);
            });
        }).catch(function () {
          // API 失败，尝试缓存
          if (cached) { renderWeather(cached); }
          else { showWeatherFallback(); }
        });
      },
      function () {
        // 定位失败
        var cached = state.weather;
        if (cached) renderWeather(cached);
        else showWeatherFallback();
      },
      { timeout: 8000, enableHighAccuracy: false }
    );
  }

  function fetchCityByLatLng(lat, lng, cachedData) {
    if (!lat || !lng) return;
    var url = 'https://nominatim.openstreetmap.org/reverse?lat=' + lat + '&lon=' + lng + '&format=json&accept-language=zh&zoom=10';
    fetch(url).then(function (r) { return r.json(); }).then(function (geo) {
      var addr = geo.address || {};
      var city = addr.city || addr.town || addr.county || addr.village || addr.suburb || addr.state || '';
      if (city && cachedData) {
        cachedData.city = city;
        save();
        document.getElementById('wCity2').textContent = city;
      }
    }).catch(function () { });
  }

  function showWeatherFallback() {
    var w = document.getElementById('weatherWidget'); if (!w) return;
    w.style.display = 'flex';
    document.getElementById('wIcon2').innerHTML = '<circle cx="12" cy="10" r="4" fill="none" stroke="#A0A0A0" stroke-width="1.5"/><line x1="12" y1="16" x2="12" y2="20" stroke="#A0A0A0" stroke-width="1.5" stroke-linecap="round"/><line x1="8" y1="20" x2="16" y2="20" stroke="#A0A0A0" stroke-width="1.5" stroke-linecap="round"/>';
    document.getElementById('wTemp2').textContent = '--°C';
    document.getElementById('wClothes2').textContent = '点击获取天气';
    w.style.cursor = 'pointer';
    w.onclick = function () { fetchWeather(); };
  }

  function renderWeather(d) {
    var w = document.getElementById('weatherWidget'); if (!w) return;
    w.style.display = 'flex'; w.style.cursor = 'default'; w.onclick = null;
    document.getElementById('wIcon2').innerHTML = weatherIcon(d.type);
    document.getElementById('wCity2').textContent = d.city || '…';
    document.getElementById('wTemp2').textContent = d.temp + '°C';
    document.getElementById('wClothes2').textContent = '建议：' + d.clothes;
  }

  /* ===================== 页面切换 ===================== */
  let curPage = 'today';
  function switchPage(p) {
    curPage = p;
    document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
    $('page-' + p).classList.add('active');
    document.querySelectorAll('.side-nav-item,.bn-item').forEach(x => x.classList.toggle('active', x.dataset.tab === p));
    if (p !== 'study' && studyTimer.running) { pauseStudyTimer() }
    renderAll();
  }

  /* ===================== 今日页面 ===================== */
  function renderToday() {
    var td = today(), vd = todoViewDate;
    var items = state.todos.filter(function (t) { return t.date === vd });
    var overdue = [];
    if (vd === td) { overdue = state.todos.filter(function (t) { return !t.done && t.date < td }); }
    var active = items.filter(function (t) { return !t.done });
    var done = items.filter(function (t) { return t.done });

    var vdObj = new Date(vd);
    var wk = ['日', '一', '二', '三', '四', '五', '六'][vdObj.getDay()];
    // 日期进标题
    document.getElementById('todoHdDate').textContent = (vdObj.getMonth() + 1) + '月' + vdObj.getDate() + '日 · 星期' + wk;
    document.getElementById('todoHdDate').classList.toggle('is-today', vd === td);
    var diff = Math.round((vdObj - new Date(td + 'T00:00:00+08:00')) / 864e5);
    var backEl = document.getElementById('todoBackToday');
    if (backEl) backEl.style.display = diff === 0 ? 'none' : 'inline';
    if (vd === td) {
      var wkOverdue = state.workTasks.filter(function (t) { return !t.done && t.deadline < td }).length;
      var wkToday = state.workTasks.filter(function (t) { return !t.done && t.deadline === td }).length;
      var taskPart = wkOverdue ? ' + ' + wkOverdue + '项工作任务逾期' : '';
      document.getElementById('todayCount').textContent = (active.length + overdue.length) + ' 项待办' + (overdue.length ? '（含逾期 ' + overdue.length + '）' : '') + taskPart;
    } else {
      document.getElementById('todayCount').textContent = active.length + ' 项未完成';
    }

    // 工作任务进度 header 日期 / 箭头（renderWorkTasks 内会再次覆写，此处仅做备用）
    var prevBEl = document.getElementById('taskPrevBtn');
    var nextBEl = document.getElementById('taskNextBtn');
    var backBEl = document.getElementById('taskBackToday');
    if (workTaskTab === 'done') {
      var wddObj = new Date(workTaskDoneDate); var wddWk = ['日', '一', '二', '三', '四', '五', '六'][wddObj.getDay()];
      var thdEl = document.getElementById('taskHdDate');
      if (thdEl) { thdEl.textContent = (wddObj.getMonth() + 1) + '月' + wddObj.getDate() + '日 · 星期' + wddWk; thdEl.classList.toggle('is-today', workTaskDoneDate === td); }
      if (prevBEl) prevBEl.style.display = 'inline-flex';
      if (nextBEl) nextBEl.style.display = workTaskDoneDate === td ? 'none' : 'inline-flex';
      if (backBEl) backBEl.style.display = workTaskDoneDate === td ? 'none' : 'inline';
    } else {
      var thdEl2 = document.getElementById('taskHdDate');
      if (thdEl2) { thdEl2.textContent = ''; thdEl2.classList.remove('is-today'); }
      if (prevBEl) prevBEl.style.display = 'none';
      if (nextBEl) nextBEl.style.display = 'none';
      if (backBEl) backBEl.style.display = 'none';
    }

    function renderItem(t) {
      var ov = t.date < td;
      var typeLabel = todoTypeLabel(t.type);
      var actBtns = '<div class="today-act-group">' +
        '<span class="today-act-icon" onclick="editTodo(\'' + t.id + '\')" title="编辑"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span>' +
        '<span class="today-act-icon del" onclick="delTodo(\'' + t.id + '\')" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></span>' +
        (ov ? '<span class="today-act-move" onclick="moveTodo(\'' + t.id + '\')">顺延</span>' : '') +
        '</div>';
      return '<div class="today-item ' + (ov ? 'overdue' : '') + '">' +
        '<div class="today-cb" onclick="finishTodo(\'' + t.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>' +
        '<div class="today-txt">' + (typeLabel ? '<span style="font-size:9px;padding:1px 5px;border-radius:6px;background:var(' + (TODO_TYPES.find(function (x) { return x.id === t.type }) || { bg: '--bg' }).bg + ');color:var(' + (TODO_TYPES.find(function (x) { return x.id === t.type }) || { color: '--ink-light' }).color + ');margin-right:4px;vertical-align:middle">' + typeLabel + '</span>' : '') + esc(t.text) + '<small>' + (ov ? '⚠ 逾期（' + t.date + '）' : vd === td ? '今天' : vd) + '</small></div>' +
        actBtns +
        '</div>';
    }

    var html = '';
    // 逾期项置顶
    if (overdue.length) {
      html += '<div class="today-overdue-head"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>逾期未完成 · ' + overdue.length + ' 项</div>';
      html += overdue.map(renderItem).join('');
      if (active.length || done.length) html += '<div class="today-overdue-sep"></div>';
    }
    if (!active.length && !done.length && !overdue.length) { html = '<div class="today-empty">这一天没有待办</div>'; }
    else {
      if (active.length) html += active.map(renderItem).join('');
      if (done.length) {
        html += '<div class="today-done">已完成 ' + done.length + ' 项</div>';
        html += done.map(function (t) {
          return '<div class="today-item" style="opacity:.55">' +
            '<div class="today-cb done" onclick="undoTodo(\'' + t.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>' +
            '<div class="today-txt" style="text-decoration:line-through">' + esc(t.text) + '<small>' + (t.date === td ? '今天' : t.date) + '</small></div>' +
            '<button class="undo-btn" onclick="undoTodo(\'' + t.id + '\')">撤销</button>' +
            '</div>';
        }).join('');
      }
    }
    document.getElementById('todayList').innerHTML = html;

    // 今日全部完成 → 庆祝
    if (vd === td && !active.length && (items.length > 0)) {
      document.getElementById('todayList').innerHTML = html +
        '<div style="text-align:center;padding:20px 0;animation:fadeUp .5s ease">' +
        '<div style="font-size:40px;margin-bottom:8px">&#x1f389;</div>' +
        '<div style="font-size:18px;font-weight:700;color:var(--g400);margin-bottom:4px">今天你是最棒的！</div>' +
        '<div style="font-size:12px;color:var(--ink-soft)">全部 ' + items.length + ' 项已完成，比个心 &#x2764;&#xFE0F;</div>' +
        '</div>';
    }

    renderWorkTasks('todayTasks');
    renderCalendar();

    var allOverdue = state.todos.filter(function (t) { return !t.done && t.date < td }).length
      + state.workTasks.filter(function (t) { return !t.done && t.deadline < td }).length;
    var b = document.getElementById('todayBadge');
    if (b) b.style.display = allOverdue ? 'inline' : 'none';
    if (b && allOverdue) b.textContent = allOverdue;
  }

  /* 待办操作 */
  function finishTodo(id) {
    var t = state.todos.find(function (x) { return x.id === id });
    if (t) { t.done = true; save(); renderAll(); toast('完成 ✓') }
  }
  function undoTodo(id) {
    var t = state.todos.find(function (x) { return x.id === id });
    if (t) { t.done = false; save(); renderAll(); toast('已撤销') }
  }
  function moveTodo(id) { const t = state.todos.find(x => x.id === id); if (t) t.date = today(); save(); renderAll(); toast('已顺延') }
  function delTodo(id) {
    conf('确定删除这条待办？', () => {
      state.todos = state.todos.filter(function (t) { return t.id !== id });
      save(); renderAll(); toast('已删除');
    });
  }
  let editingTodoId = null;
  function editTodo(id) {
    editingTodoId = id;
    var t = state.todos.find(function (x) { return x.id === id });
    if (!t) return;
    openModal({
      title: '编辑待办',
      body: '<div class="form-group"><label>日期</label><input class="inp" type="date" id="todoDate" value="' + t.date + '"></div>' +
        '<div class="form-group"><label>类型</label>' +
        '<div class="chip-group" id="todoTypes">' +
        TODO_TYPES.map(function (tt) { return '<div class="chip' + (tt.id === t.type ? ' active' : '') + '" data-type="' + tt.id + '">' + tt.label + '</div>' }).join('') +
        '</div></div>' +
        '<div class="form-group"><label>内容</label><input class="inp" id="todoText" value="' + esc(t.text) + '"></div>',
      foot: '<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveTodo()">保存</button>'
    });
    setTimeout(function () {
      var tt = document.getElementById('todoTypes'); if (tt) tt.querySelectorAll('.chip').forEach(function (c) { c.onclick = function () { tt.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('active') }); c.classList.add('active') } });
    }, 50);
  }
  function openTodoModal() {
    editingTodoId = null;
    openModal({
      title: '添加待办 · ' + todoViewDate,
      body: '<div class="form-group"><label>类型</label>' +
        '<div class="chip-group" id="todoTypes">' +
        TODO_TYPES.map(function (t) { return '<div class="chip" data-type="' + t.id + '">' + t.label + '</div>' }).join('') +
        '</div></div>' +
        '<div class="form-group"><label>内容</label><input class="inp" id="todoText" placeholder="比如：整理本周笔记"></div>',
      foot: '<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveTodo()">添加</button>'
    });
    setTimeout(function () {
      var tt = document.getElementById('todoTypes'); if (tt) tt.querySelectorAll('.chip').forEach(function (c) { c.onclick = function () { tt.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('active') }); c.classList.add('active') } });
    }, 50);
  }
  function saveTodo() {
    var d = todoViewDate;
    var txt = document.getElementById('todoText').value.trim();
    if (!txt) return toast('请填写内容');
    var typeEl = document.getElementById('todoTypes');
    var type = typeEl ? typeEl.querySelector('.chip.active').dataset.type : 'life';
    if (editingTodoId) {
      var t = state.todos.find(function (x) { return x.id === editingTodoId });
      if (t) { t.date = d; t.text = txt; t.type = type }
      editingTodoId = null;
      toast('已更新');
    } else {
      state.todos.push({ id: uid(), date: d, text: txt, type: type, done: false });
      toast('已添加');
    }
    todoViewDate = d; save(); closeModal(); renderAll();
  }
  /* 日期导航 */
  function prevTodoDay() { const d = new Date(todoViewDate); d.setDate(d.getDate() - 1); todoViewDate = d.toISOString().slice(0, 10); renderToday() }
  function nextTodoDay() { const d = new Date(todoViewDate); d.setDate(d.getDate() + 1); todoViewDate = d.toISOString().slice(0, 10); renderToday() }
  function goTodayTodoDay() { todoViewDate = today(); renderToday() }

  /* ===================== 日历（含待办+特殊日子集成） ===================== */
  const TODO_TYPES = [
    { id: 'life', label: '生活', cls: 'life', color: '--o300', bg: '--o50' },
    { id: 'work', label: '工作', cls: 'work', color: '--pu300', bg: '--pu50' },
    { id: 'exercise', label: '锻炼', cls: 'exercise', color: '--g300', bg: '--g50' },
    { id: 'study', label: '学习', cls: 'study', color: '--c300', bg: '--c50' }
  ];
  function todoTypeLabel(type) {
    const t = TODO_TYPES.find(x => x.id === type);
    return t ? t.label : '';
  }

  function evIcon(type) {
    if (type === 'birthday') {
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s1.5-2 4-2 4 2 4 2 1.5-2 4-2 4 2 4 2"/><path d="M12 4a2 2 0 0 0-2 2v2h4V6a2 2 0 0 0-2-2z"/></svg>';
    }
    if (type === 'holiday') {
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
  }

  function renderCalendar() {
    const now = new Date();
    if (!calYear) { calYear = now.getFullYear(); calMonth = now.getMonth() + 1; }
    const daysInMonth = new Date(calYear, calMonth, 0).getDate();
    const firstDow = new Date(calYear, calMonth - 1, 1).getDay();

    // 构建当天标记映射：dateKey -> Set of types
    const dayMarkers = {};
    state.todos.forEach(t => {
      if (t.done) return;
      const parts = t.date.split('-');
      if (parseInt(parts[0]) === calYear && parseInt(parts[1]) === calMonth) {
        const dk = parts[1] + '-' + parts[2];
        if (!dayMarkers[dk]) dayMarkers[dk] = new Set();
        dayMarkers[dk].add(t.type || 'life');
      }
    });
    state.events.forEach(e => {
      const dk = e.date;
      if (!dayMarkers[dk]) dayMarkers[dk] = new Set();
      dayMarkers[dk].add(e.type);
    });

    // 构建生日/纪念日/假期 标记映射（用于圆底纹 + 假期小字）
    const specialDayMap = {}; // dateKey -> {type:'birthday'|'special'|'holiday', name:''}
    state.events.forEach(e => {
      specialDayMap[e.date] = e; // 同一天有多个事件时，取第一个
    });

    // 本月事件
    const monthPrefix = String(calMonth).padStart(2, '0') + '-';
    const monthEvs = [];
    state.events.forEach(e => {
      if (e.date.startsWith(monthPrefix)) {
        const day = parseInt(e.date.split('-')[1]);
        monthEvs.push({ ...e, day, fullDate: calYear + '-' + String(calMonth).padStart(2, '0') + '-' + String(day).padStart(2, '0') });
      }
    });
    monthEvs.sort((a, b) => a.day - b.day);

    // 构建日历格子
    let cells = '';
    const prevMonthLastDay = new Date(calYear, calMonth - 1, 0).getDate();
    for (let i = firstDow - 1; i >= 0; i--) {
      const d = prevMonthLastDay - i;
      cells += '<div class="cal-day other"><div class="cal-num">' + d + '</div></div>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = String(calMonth).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const fullDate = calYear + '-' + String(calMonth).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const isToday = calYear === now.getFullYear() && calMonth === now.getMonth() + 1 && d === now.getDate();
      const types = dayMarkers[dateKey];
      const sp = specialDayMap[dateKey]; // birthday / special / holiday

      // 判断星期几
      const dowIdx = new Date(calYear, calMonth - 1, d).getDay(); // 0=Sun, 6=Sat
      const isWeekend = dowIdx === 0 || dowIdx === 6;
      const isSat = dowIdx === 6, isSun = dowIdx === 0;
      const isManualHoliday = state.holidays && state.holidays.includes(dateKey);

      // CSS类
      let dayCls = 'cal-day' + (isToday ? ' today' : '');
      if (sp && sp.type === 'birthday') dayCls += ' special-day birthday';
      if (sp && sp.type === 'special') dayCls += ' special-day special';
      if (sp && sp.type === 'holiday') dayCls += ' holiday-day';
      if (isWeekend || isManualHoliday) dayCls += ' weekend' + (isSat ? ' sat' : '') + (isSun ? ' sun' : '');

      let dotsHtml = '';
      if (types && types.size) {
        dotsHtml = '<div class="cal-dots">';
        types.forEach(function (tp) { dotsHtml += '<span class="cal-dot ' + tp + '"></span>' });
        dotsHtml += '</div>';
      }
      let holidayTag = '';
      if (sp && sp.type === 'holiday') {
        holidayTag = '<div class="cal-holiday-tag">假</div>';
      }
      cells += '<div class="' + dayCls + '" onclick="pickCalDay(' + d + ')"><div class="cal-num">' + d + '</div>' + holidayTag + dotsHtml + '</div>';
    }
    var totalCells = firstDow + daysInMonth;
    var remaining = totalCells % 7 === 0 ? 0 : 7 - totalCells % 7;
    for (var d2 = 1; d2 <= remaining; d2++) {
      cells += '<div class="cal-day other"><div class="cal-num">' + d2 + '</div></div>';
    }

    $('calArea').innerHTML =
      '<div class="cal-card">' +
      '<div class="cal-nav">' +
      '<button onclick="prevCalMonth()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>' +
      '<div class="mnth">' + calYear + '年 ' + calMonth + '月</div>' +
      '<button onclick="nextCalMonth()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>' +
      '</div>' +
      '<div class="cal-grid">' +
      '<div class="cal-dow">日</div><div class="cal-dow">一</div><div class="cal-dow">二</div><div class="cal-dow">三</div><div class="cal-dow">四</div><div class="cal-dow">五</div><div class="cal-dow">六</div>' +
      cells +
      '</div>' +
      '<div class="cal-legend">' +
      '<div class="cal-legend-item"><span class="cal-legend-dot life"></span>生活</div>' +
      '<div class="cal-legend-item"><span class="cal-legend-dot work"></span>工作</div>' +
      '<div class="cal-legend-item"><span class="cal-legend-dot exercise"></span>锻炼</div>' +
      '<div class="cal-legend-item"><span class="cal-legend-dot study"></span>学习</div>' +
      '<div class="cal-legend-item"><span class="cal-legend-dot birthday"></span>生日</div>' +
      '<div class="cal-legend-item"><span class="cal-legend-dot special"></span>纪念日</div>' +
      '<div class="cal-legend-item"><span class="cal-legend-dot holiday"></span>假期</div>' +
      '</div>' +
      '</div>' +
      '<div class="cal-ev-list">' +
      '<div class="cal-ev-list-title">' + calMonth + '月纪念日 <span>' + monthEvs.length + '个</span></div>' +
      (monthEvs.length ? monthEvs.map(function (e) {
        return '<div class="cal-ev">' +
          '<div class="cico ' + e.type + '">' + evIcon(e.type) + '</div>' +
          '<div class="ctext">' + esc(e.name) + '<span class="ev-label ' + e.type + '">' + (e.type === 'birthday' ? '生日' : e.type === 'holiday' ? '假期' : '纪念') + '</span>' + (e.note ? '<div style="font-size:10px;color:var(--ink-light);font-weight:400">' + esc(e.note) + '</div>' : '') + '</div>' +
          '<div class="cdt">' + e.day + '日</div>' +
          '<div class="cdel" onclick="delEvent(\'' + e.id + '\')">删除</div>' +
          '</div>';
      }).join('') : '<div style="text-align:center;color:var(--ink-light);font-size:12px;padding:12px">本月暂无纪念日</div>') +
      '</div>';
  }

  /* 点击日历日期 → 弹出快捷添加菜单 */
  function pickCalDay(d) {
    var fd = calYear + '-' + String(calMonth).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    var mmdd = String(calMonth).padStart(2, '0') + '-' + String(d).padStart(2, '0');

    var existingEvts = state.events.filter(function (e) { return e.date === mmdd });
    var existingTodos = state.todos.filter(function (t) { return t.date === fd && !t.done });

    var existHtml = '';
    if (existingEvts.length || existingTodos.length) {
      existHtml = '<div style="margin-bottom:12px;padding:8px 10px;background:var(--bg);border-radius:10px;font-size:11px">';
      existHtml += '<div style="color:var(--ink-soft);margin-bottom:4px">已有 ' + fd + ' 的安排：</div>';
      existingTodos.forEach(function (t) {
        existHtml += '<div style="display:flex;align-items:center;gap:4px;padding:2px 0"><span class="cal-dot ' + (t.type || 'life') + '" style="display:inline-block"></span> ' + todoTypeLabel(t.type) + ' - ' + esc(t.text) + '<button onclick="event.stopPropagation();deleteTodoFromCal(\'' + t.id + '\',\'' + fd + '\')" style="margin-left:auto;width:22px;height:22px;border:none;border-radius:50%;background:transparent;color:var(--ink-light);cursor:pointer;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center" title="删除此待办">×</button></div>';
      });
      existingEvts.forEach(function (e) {
        existHtml += '<div style="display:flex;align-items:center;gap:4px;padding:2px 0;color:var(--p400)"><span class="cal-dot ' + e.type + '" style="display:inline-block"></span> ' + esc(e.name) + '<button onclick="event.stopPropagation();delEventFromPop(\'' + e.id + '\')" style="margin-left:auto;width:22px;height:22px;border:none;border-radius:50%;background:transparent;color:var(--ink-light);cursor:pointer;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center" title="删除此纪念日">×</button></div>';
      });
      existHtml += '<hr style="border:none;border-top:1px dashed var(--line);margin:6px 0 4px"></div>';
    }

    // 假期标记开关
    var isHoliday = state.holidays && state.holidays.includes(mmdd);
    var holidayToggleHtml = '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;margin-bottom:12px;background:var(--bg);border-radius:10px;cursor:pointer" onclick="toggleCalHoliday(\'' + mmdd + '\',\'' + fd + '\')" id="holidayToggle">' +
      '<div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:' + (isHoliday ? 'var(--g400)' : 'var(--ink)') + '">' +
      (isHoliday
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--g400)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/></svg>') +
      (isHoliday ? '已标记为假期 · 点击取消' : '标记为假期（绿色字体）') +
      '</div>' +
      '<div style="width:36px;height:22px;border-radius:11px;background:' + (isHoliday ? 'var(--g400)' : '#D0D0D0') + ';position:relative;transition:background .2s;flex-shrink:0">' +
      '<div style="width:18px;height:18px;border-radius:50%;background:#fff;position:absolute;top:2px;' + (isHoliday ? 'right:2px' : 'left:2px') + ';transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,0.15)"></div>' +
      '</div>' +
      '</div>';

    openModal({
      title: fd + ' · 添加安排',
      body: existHtml + holidayToggleHtml +
        '<div style="display:flex;gap:0;margin-bottom:14px;background:var(--bg);border-radius:10px;padding:3px">' +
        '<div class="quick-tab active" onclick="switchQuickTab(\'todo\')" id="quickTabTodo">📋 待办</div>' +
        '<div class="quick-tab" onclick="switchQuickTab(\'event\')" id="quickTabEvent">📅 纪念日</div>' +
        '</div>' +
        '<div id="quickPanelTodo">' +
        '<div class="chip-group" id="quickTypes" style="margin-bottom:10px">' +
        TODO_TYPES.map(function (t) { return '<div class="chip" data-type="' + t.id + '">' + t.label + '</div>' }).join('') +
        '</div>' +
        '<div class="form-group"><label>内容</label><input class="inp" id="quickText" placeholder="比如：晨跑30分钟"></div>' +
        '</div>' +
        '<div id="quickPanelEvent" style="display:none">' +
        '<div class="chip-group" id="quickEvTypes" style="margin-bottom:10px">' +
        '<div class="chip" data-type="birthday">🎂 生日</div>' +
        '<div class="chip active" data-type="special">⭐ 纪念日</div>' +
        '<div class="chip" data-type="holiday">🏖 假期</div>' +
        '</div>' +
        '<div class="form-group"><label>名称</label><input class="inp" id="quickEvName" placeholder="比如：妈妈的生日"></div>' +
        '<div class="form-group"><label>备注（可选）</label><input class="inp" id="quickEvNote" placeholder="比如：记得打电话"></div>' +
        '<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-soft);margin-top:4px">' +
        '<input type="checkbox" id="quickEvRecur" checked style="width:16px;height:16px"> 每年重复</div>' +
        '</div>',
      foot: '<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveQuickAdd(\'' + fd + '\',\'' + mmdd + '\')">保存</button>'
    });
    setTimeout(function () {
      var qt = document.getElementById('quickTypes'); if (qt) qt.querySelectorAll('.chip').forEach(function (c) { c.onclick = function () { qt.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('active') }); c.classList.add('active') } });
      var qe = document.getElementById('quickEvTypes'); if (qe) qe.querySelectorAll('.chip').forEach(function (c) { c.onclick = function () { qe.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('active') }); c.classList.add('active') } });
    }, 50);
  }

  function switchQuickTab(tab) {
    var t = document.getElementById('quickTabTodo'), e = document.getElementById('quickTabEvent');
    var tp = document.getElementById('quickPanelTodo'), ep = document.getElementById('quickPanelEvent');
    if (tab === 'todo') {
      t.classList.add('active'); e.classList.remove('active');
      tp.style.display = ''; ep.style.display = 'none';
    } else {
      e.classList.add('active'); t.classList.remove('active');
      ep.style.display = ''; tp.style.display = 'none';
    }
  }

  /* 切换某天是否为假期 */
  function toggleCalHoliday(mmdd, fd) {
    if (!state.holidays) state.holidays = [];
    var idx = state.holidays.indexOf(mmdd);
    if (idx >= 0) {
      state.holidays.splice(idx, 1);
      toast('已取消 ' + fd + ' 的假期标记');
    } else {
      state.holidays.push(mmdd);
      toast('已将 ' + fd + ' 标记为假期');
    }
    save();
    closeModal();
    renderCalendar();
  }

  function saveQuickAdd(fd, mmdd) {
    var txt = document.getElementById('quickText').value.trim();
    if (txt) {
      var typeEl = document.getElementById('quickTypes').querySelector('.chip.active');
      var type = typeEl ? typeEl.dataset.type : 'life';
      state.todos.push({ id: uid(), date: fd, text: txt, type: type, done: false });
    }
    var evName = document.getElementById('quickEvName').value.trim();
    if (evName) {
      var evTypeEl = document.getElementById('quickEvTypes').querySelector('.chip.active');
      var evType = evTypeEl ? evTypeEl.dataset.type : 'special';
      var note = document.getElementById('quickEvNote').value.trim();
      var recurring = document.getElementById('quickEvRecur').checked;
      state.events.push({ id: uid(), date: mmdd, type: evType, name: evName, note: note, recurring: recurring });
    }
    if (!txt && !evName) return toast('请至少填写待办或纪念日');
    save(); closeModal(); renderAll(); toast('已保存');
  }

  /* 从日历弹窗中删除待办 */
  function deleteTodoFromCal(tid, fd) {
    var t = state.todos.find(function(t){return t.id===tid});
    conf('确定删除 ' + fd + ' 的待办「' + (t ? t.text : '') + '」？', function() {
      state.todos = state.todos.filter(function(t) { return t.id !== tid; });
      save(); closeModal(); renderAll();
      toast('已删除待办');
    });
  }

  /* 从日历弹窗中删除纪念日 */
  function delEventFromPop(eid) {
    var ev = state.events.find(function(e) { return e.id === eid });
    if (!ev) return;
    conf('确定删除「' + ev.name + '」？', function() {
      state.events = state.events.filter(function(e) { return e.id !== eid; });
      save(); closeModal(); renderAll();
      toast('已删除纪念日');
    });
  }

  function prevCalMonth() { if (calMonth === 1) { calYear--; calMonth = 12 } else calMonth--; renderCalendar() }
  function nextCalMonth() { if (calMonth === 12) { calYear++; calMonth = 1 } else calMonth++; renderCalendar() }
  function delEvent(id) { conf('删除这条记录？', function () { state.events = state.events.filter(function (e) { return e.id !== id }); save(); renderAll() }) }

  /* ===================== 习惯打卡（仅健康页使用） ===================== */
  function renderHabits(containerId) {
    const td = today(), tdh = state.habits[td] || {};
    const all = [...HABITS, ...state.customHabits.map(h => ({ ...h, ico: h.icon ? '<circle cx="12" cy="12" r="10"/>' : '' }))];
    const doneN = all.filter(h => tdh[h.key]).length;
    $(containerId).innerHTML = `
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:12px;color:var(--ink-soft)">
    完成 <b style="color:var(--g500);font-size:14px">${doneN}</b>/${all.length} 项
  </div>
  <div class="habit-grid">
    ${all.map(h => `<div class="habit-card ${tdh[h.key] ? 'done' : ''}" onclick="toggleHabit('${h.key}')">
      <div class="hico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${h.ico || '<circle cx="12" cy="12" r="10"/>'}</svg></div>
      <div class="hlbl">${esc(h.label)}</div>
    </div>`).join('')}
    <div class="habit-card habit-add" onclick="openCustomHabitModal()">
      <div class="hico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>
      <div class="hlbl">自定义</div>
    </div>
  </div>`;
  }
  function toggleHabit(key) {
    const td = today();
    if (!state.habits[td]) state.habits[td] = {};
    state.habits[td][key] = !state.habits[td][key];
    save(); renderAll();
  }

  /* ===================== 工作任务（重构：截止时间 + 完成归档 + 按日期查看） ===================== */
  let workTaskTab = 'active'; // 'active' | 'done'
  let workTaskDoneDate = today();

  function renderWorkTasks(containerId) {
    var activeTasks = state.workTasks.filter(function (t) { return !t.done });
    var doneTasks = state.workTasks.filter(function (t) { return t.done });
    var activeN = activeTasks.length, doneN = doneTasks.length;

    // 进行中按 deadline 排序（逾期排最前，然后按日期升序）
    activeTasks.sort(function (a, b) {
      var now = today();
      var aOver = a.deadline < now ? 0 : 1;
      var bOver = b.deadline < now ? 0 : 1;
      if (aOver !== bOver) return aOver - bOver;
      return a.deadline.localeCompare(b.deadline);
    });

    var html = '';

    // Tab 切换
    html += '<div class="wtask-tabs">' +
      '<div class="wtask-tab ' + (workTaskTab === 'active' ? 'active' : '') + '" onclick="switchWorkTaskTab(\'active\')">进行中 (' + activeN + ')</div>' +
      '<div class="wtask-tab ' + (workTaskTab === 'done' ? 'active' : '') + '" onclick="switchWorkTaskTab(\'done\')">已完成 (' + doneN + ')</div>' +
      '</div>';

    if (workTaskTab === 'active') {
      // ===== 进行中 =====
      var thdA = document.getElementById('taskHdDate'); if (thdA) { thdA.textContent = ''; thdA.classList.remove('is-today'); }
      var pb = document.getElementById('taskPrevBtn'); if (pb) pb.style.display = 'none';
      var nb = document.getElementById('taskNextBtn'); if (nb) nb.style.display = 'none';
      var bb = document.getElementById('taskBackToday'); if (bb) bb.style.display = 'none';
      if (!activeN) {
        html += '<div class="today-empty">暂无进行中的工作任务</div>';
      } else {
        html += activeTasks.map(function (t) {
          var now = today();
          var over = t.deadline < now;
          var days = db(now, t.deadline);
          var stg = t.stages || 1;
          var cs = t.completedStages || 0;
          // 多阶段时 progress = completedStages/stages
          if (stg > 1) { t.progress = Math.round(cs / stg * 100); }
          var pct = t.progress || 0;
          var barCls = pct < 30 ? 'low' : pct < 70 ? 'mid' : pct < 100 ? 'high' : 'done';
          var pctCls = pct < 30 ? 'low' : pct < 70 ? 'mid' : 'high';
          var deadlineHtml = '';
          if (days < 0) {
            deadlineHtml = '<span class="wtask-deadline over">逾期 ' + (-days) + ' 天 · 截止 ' + t.deadline + '</span>';
          } else if (days === 0) {
            deadlineHtml = '<span class="wtask-deadline over">今天截止</span>';
          } else if (days <= 3) {
            deadlineHtml = '<span class="wtask-deadline over">还剩 ' + days + ' 天 · 截止 ' + t.deadline + '</span>';
          } else {
            deadlineHtml = '<span class="wtask-deadline">截止 ' + t.deadline + '</span>';
          }
          var footerHtml = '';
          var inlineCmpl = '';
          var checkboxHtml = '';
          if (stg > 1) {
            // 多阶段模式：分段长条 + "+" 按钮
            var segs = '';
            for (var s = 0; s < stg; s++) {
              var segCls = s < cs ? 'done' : s === cs ? 'current' : '';
              segs += '<div class="wtask-stage-seg ' + segCls + '"></div>';
            }
            var allDone = cs >= stg;
            footerHtml = '<div class="wtask-stages">' + segs + (allDone ? '' : '<div class="wtask-stage-plus" onclick="advanceTaskStage(\'' + t.id + '\',event)" title="完成一个阶段">+</div>') + '</div>';
            footerHtml += '<span class="wtask-stage-label' + (allDone ? ' done' : '') + '">' + Math.min(cs, stg) + '/' + stg + (allDone ? ' · 全部完成！' : '') + '</span>';
            checkboxHtml = '<div class="wtask-cb stage" style="background:var(--g50);border-color:var(--g200);cursor:default" title="阶段任务，逐阶段完成"></div>';
          } else {
            // 单阶段：保留原进度条
            if (pct >= 100 && !t.done) {
              inlineCmpl = '<span class="wtask-progress-cmpl" onclick="completeWorkTask(\'' + t.id + '\',event)">✔ 标记完成</span>';
            }
            footerHtml = '<div class="wtask-progress-wrap" onclick="openProgressEdit(\'' + t.id + '\',event)">' +
              '<div class="wtask-progress-bar"><div class="wtask-progress-fill ' + barCls + '" style="width:' + pct + '%"></div></div>' +
              '<span class="wtask-progress-pct ' + pctCls + '">' + pct + '%</span>' +
              '<span class="wtask-progress-edit" title="快速调整进度">⋯</span>' +
              '</div>';
            checkboxHtml = '<div class="wtask-cb" onclick="completeWorkTask(\'' + t.id + '\',event)" title="标记完成"></div>';
          }
          return '<div class="wtask-item' + (over ? ' urgent' : '') + '">' +
            checkboxHtml +
            '<div class="wtask-info">' +
            '<div class="wtask-title">' + esc(t.text) + '</div>' +
            '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' + deadlineHtml + (inlineCmpl ? ' ' + inlineCmpl : '') + '</div>' +
            footerHtml +
            '</div>' +
            '<button class="task-btn del" onclick="delWorkTask(\'' + t.id + '\')" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
            '</div>';
        }).join('');
      }
    } else {
      // ===== 已完成 =====
      // 更新 card-hd 中的日期和箭头
      var wdObj = new Date(workTaskDoneDate);
      var wk2 = ['日', '一', '二', '三', '四', '五', '六'][wdObj.getDay()];
      var nowD = today();
      var thd = document.getElementById('taskHdDate'); if (thd) { thd.textContent = (wdObj.getMonth() + 1) + '月' + wdObj.getDate() + '日 · 星期' + wk2; thd.classList.toggle('is-today', workTaskDoneDate === nowD); }
      // 箭头和回今天
      var isTodayT = workTaskDoneDate === nowD;
      var prevB = document.getElementById('taskPrevBtn'); if (prevB) prevB.style.display = 'inline-flex';
      var nextB = document.getElementById('taskNextBtn'); if (nextB) nextB.style.display = isTodayT ? 'none' : 'inline-flex';
      var backB = document.getElementById('taskBackToday'); if (backB) backB.style.display = isTodayT ? 'none' : 'inline';

      var dateDone = doneTasks.filter(function (t) { return t.completedDate === workTaskDoneDate });
      if (!dateDone.length) {
        html += '<div class="today-empty">这一天没有完成的工作任务</div>';
      } else {
        html += dateDone.map(function (t) {
          var stg = t.stages || 1;
          var progressLabel = '';
          if (stg > 1) {
            var csDone = t.completedStages || stg;
            progressLabel = '<span class="wtask-stage-done">阶段 ' + Math.min(csDone, stg) + '/' + stg + '</span>';
          } else {
            var pp = t.progress || 100;
            progressLabel = '<span style="font-size:10px;font-weight:700;color:var(--g400);min-width:32px">' + pp + '%</span>';
          }
          return '<div class="wtask-done-item">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="var(--g400)" stroke-width="2.5" stroke-linecap="round" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>' +
            progressLabel +
            '<div class="dn">' + esc(t.text) + '</div>' +
            '<div class="dd">截止 ' + t.deadline + '</div>' +
            '<div class="dl" onclick="undoWorkTask(\'' + t.id + '\')">撤销</div>' +
            '</div>';
        }).join('');
      }
    }

    $(containerId).innerHTML = html;
  }

  function switchWorkTaskTab(tab) {
    workTaskTab = tab;
    if (tab === 'done') workTaskDoneDate = today();
    renderWorkTasks('todayTasks');
  }

  function completeWorkTask(id, e) {
    if (e) e.stopPropagation();
    var t = state.workTasks.find(function (x) { return x.id === id });
    if (!t) return;
    var stg = t.stages || 1;
    if (stg > 1) { t.completedStages = stg; }
    t.done = true; t.completedDate = today(); t.progress = 100; save(); renderToday(); toast('已完成 ✓');
  }

  function advanceTaskStage(id, e) {
    if (e) e.stopPropagation();
    var t = state.workTasks.find(function (x) { return x.id === id });
    if (!t) return;
    var stg = t.stages || 1;
    var cs = (t.completedStages || 0) + 1;
    if (cs > stg) cs = stg;
    t.completedStages = cs;
    t.progress = Math.round(cs / stg * 100);
    if (cs >= stg) {
      t.progress = 100; t.done = true; t.completedDate = today();
      save(); renderToday();
      toast('🎉 全部完成！任务已自动归档已完成');
    } else {
      save(); renderToday();
      toast('阶段 ' + cs + '/' + stg + ' ✓');
    }
  }

  function undoWorkTask(id) {
    var t = state.workTasks.find(function (x) { return x.id === id });
    if (t) { t.done = false; t.completedDate = null; t.completedStages = 0; save(); renderToday(); toast('已撤销') }
  }

  function openProgressEdit(id, e) {
    if (e) e.stopPropagation();
    var t = state.workTasks.find(function (x) { return x.id === id });
    if (!t) return;
    var cur = t.progress || 0;
    openModal({
      title: '调整进度',
      body: '<div style="text-align:center">' +
        '<div style="font-size:13px;color:var(--ink-soft);margin-bottom:8px">' + esc(t.text) + '</div>' +
        '<div style="font-size:40px;font-weight:800;color:' + (cur >= 100 ? 'var(--g400)' : 'var(--pu300)') + ';margin-bottom:12px" id="qpPct">' + cur + '%</div>' +
        '<input type="range" id="qpSlider" min="0" max="100" value="' + cur + '" style="width:100%" oninput="var e=$(\'qpPct\');e.textContent=this.value+\'%\';e.style.color=this.value>=100?\'var(--g400)\':\'var(--pu300)\'">' +
        '<div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;color:var(--ink-light)"><span>0%</span><span>50%</span><span>100%</span></div>' +
        '</div>',
      foot: '<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveProgress(\'' + id + '\')">确定</button>'
    });
  }
  function saveProgress(id) {
    var t = state.workTasks.find(function (x) { return x.id === id });
    if (!t) return;
    var stg = t.stages || 1;
    if (stg > 1) { toast('多阶段任务请在任务卡片点 "+" 推进'); closeModal(); return; }
    var pct = parseInt($('qpSlider').value) || 0;
    t.progress = pct;
    if (pct >= 100 && !t.done) { t.done = true; t.completedDate = today(); }
    else if (pct < 100 && t.done) { t.done = false; t.completedDate = null; }
    save(); closeModal(); renderToday(); toast('进度 ' + pct + '%');
  }

  function delWorkTask(id) {
    conf('删除这个任务？', function () {
      state.workTasks = state.workTasks.filter(function (t) { return t.id !== id });
      save(); renderToday();
    });
  }

  function prevWorkTaskDoneDate() {
    var d = new Date(workTaskDoneDate); d.setDate(d.getDate() - 1);
    workTaskDoneDate = d.toISOString().slice(0, 10); renderWorkTasks('todayTasks');
  }
  function nextWorkTaskDoneDate() {
    var d = new Date(workTaskDoneDate); d.setDate(d.getDate() + 1);
    var nxt = d.toISOString().slice(0, 10);
    if (nxt > today()) return; // 不能超过今天
    workTaskDoneDate = nxt; renderWorkTasks('todayTasks');
  }
  function goTodayWorkTaskDoneDate() {
    workTaskDoneDate = today(); renderWorkTasks('todayTasks');
  }

  function openTaskModal(id) {
    var t = id ? state.workTasks.find(function (x) { return x.id === id }) : null;
    var stg = t ? t.stages || 1 : 1;
    openModal({
      title: t ? '编辑工作任务' : '添加工作任务',
      body: '<div class="form-group"><label>任务名称</label><input class="inp" id="wtText" value="' + (t ? esc(t.text) : '') + '" placeholder="比如：完成需求文档"></div>' +
        '<div class="form-group"><label>截止日期</label><input class="inp" type="date" id="wtDeadline" value="' + (t ? t.deadline : today()) + '"></div>' +
        '<div class="form-group"><label>数量（1 = 无拆分，直接勾选完成）</label><input class="inp" type="number" id="wtStages" min="1" max="20" value="' + stg + '"></div>',
      foot: '<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveTask(' + (t ? '\'' + t.id + '\'' : '') + ')">' + (t ? '保存' : '添加') + '</button>'
    });
  }

  function saveTask(editId) {
    var txt = $('wtText').value.trim();
    if (!txt) return toast('请输入任务名');
    var dl = $('wtDeadline').value || today();
    var stg = parseInt($('wtStages').value) || 1;
    if (stg < 1) stg = 1; if (stg > 20) stg = 20;
    if (editId) {
      var t = state.workTasks.find(function (x) { return x.id === editId });
      if (t) {
        t.text = txt; t.deadline = dl;
        // 如果阶段数变了，重置进度
        if (t.stages !== stg) { t.stages = stg; t.completedStages = 0; t.progress = 0; }
        if (t.progress >= 100 && !t.done) { t.done = true; t.completedDate = today(); }
        else if (t.progress < 100 && t.done) { t.done = false; t.completedDate = null; }
      }
    } else {
      state.workTasks.push({ id: uid(), text: txt, deadline: dl, stages: stg, completedStages: 0, progress: 0, done: false, completedDate: null });
    }
    save(); closeModal(); renderToday(); toast(editId ? '已更新' : '已添加');
  }

  /* ===================== 弹窗：自定义习惯 ===================== */
  function openCustomHabitModal() {
    openModal({
      title: '自定义习惯',
      body: `<div class="form-group"><label>习惯名称</label><input class="inp" id="chlbl" placeholder="比如：拉伸10分钟"></div>`,
      foot: '<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveCustomHabit()">添加</button>'
    });
  }
  function saveCustomHabit() {
    const l = $('chlbl').value.trim(); if (!l) return toast('请输入名称');
    state.customHabits.push({ key: 'ch_' + uid(), label: l, icon: '⭐' });
    save(); closeModal(); renderAll(); toast('已添加');
  }



  /* ===================== 健康页面 ===================== */
  function renderHealthStats() {
    const w = [...state.weight].sort((a, b) => a.date.localeCompare(b.date));
    const cur = w[w.length - 1];
    const startWeight = getStartWeight();
    const start = startWeight != null ? { weight: startWeight } : null;
    const lost = start ? +(start.weight - (cur?.weight || start.weight)).toFixed(1) : 0;
    const tgt = getTargetWeight();
    const toGo = cur && tgt != null ? +(cur.weight - tgt).toFixed(1) : null;
    const pct = cur ? Math.min(100, Math.round(((start.weight - cur.weight) / (start.weight - tgt)) * 100)) : 0;
    const streak = calcStreak();

    $('healthStats').innerHTML = `
  <div class="stat-row">
    <div class="stat"><div class="v">${cur ? cur.weight : '—'}</div><div class="l">当前体重 kg</div></div>
    <div class="stat"><div class="v">${cur && cur.bodyFat != null ? cur.bodyFat + '%' : '—'}</div><div class="l">体脂率</div></div>
    <div class="stat"><div class="v g">${lost > 0 ? '-' + lost : '—'}</div><div class="l">已减重 kg</div></div>
    <div class="stat"><div class="v c">${toGo != null ? (toGo > 0 ? toGo : '🎯') : '—'}</div><div class="l">距目标 kg</div></div>
  </div>
  <div class="prog-card">
    <div class="prog-ring">${ringSvg(pct, 52, 5, '#7AAA67')}</div>
    <div class="prog-info">
      <div class="t1">本月健康进度</div>
      <div class="t2">从 ${start?.weight || '—'} → ${tgt} kg</div>
      <div class="t3">从「设置健康目标」独立设置，与目标激励无关</div>
    </div>
  </div>`;
  }

  function ringSvg(pct, size, sw, color) {
    const r = (size - sw) / 2, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="#E5E8E0" stroke-width="${sw}" fill="none"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${color}" stroke-width="${sw}" fill="none" stroke-dasharray="${c}" stroke-dashoffset="${off}" stroke-linecap="round" transform="rotate(-90 ${size / 2} ${size / 2})"/><text x="${size / 2}" y="${size / 2}" text-anchor="middle" dominant-baseline="central" font-size="${size * 0.28}" font-weight="700" fill="#4A4A4A">${pct}%</text></svg>`;
  }
  function calcStreak() {
    let s = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const h = state.habits[k] || {}; const all = [...HABITS, ...state.customHabits];
      if (all.length === 0) break;
      const dn = all.filter(x => h[x.key]).length;
      if (dn >= 3) s++; else if (i > 0) break;
    } return s;
  }

  function renderWeightRecords() {
    const w = [...state.weight].sort((a, b) => b.date.localeCompare(a.date));
    const showAll = state._weightShowAll || false;
    const sliced = showAll ? w : w.slice(0, 3);
    const html = sliced.map(r => `<div class="rec-row">
  <div class="rec-d">${r.date}</div><div class="rec-v">${r.weight} kg${r.bodyFat != null ? ' · 体脂 ' + r.bodyFat + '%' : ''}</div>
  <div class="rec-del" onclick="event.stopPropagation();delWeight('${r.id}')">删除</div>
</div>`).join('');
    $('weightRecords').innerHTML = w.length ? `<div class="rec-list">${html}</div>` : '<div class="today-empty">还没有体重记录</div>';

    // 展开/收起按钮
    if (w.length > 3) {
      $('weightExpandFn').innerHTML = `<span class="fn-btn" onclick="toggleWeightExpand()">${showAll ? '收起' : '查看全部 (' + w.length + '条)'}</span>`;
    } else {
      $('weightExpandFn').innerHTML = '';
    }
  }

  function toggleWeightExpand() {
    state._weightShowAll = !state._weightShowAll;
    save(); renderWeightRecords();
  }
  function delWeight(id) { conf('删除？', () => { state.weight = state.weight.filter(w => w.id !== id); save(); renderAll() }) }

  function renderMeasureRecords() {
    const m = [...state.measure].sort((a, b) => b.date.localeCompare(a.date));
    const showAll = state._measureShowAll || false;
    const sliced = showAll ? m : m.slice(0, 3);
    const html = sliced.map(r => `<div class="rec-row">
  <div class="rec-d">${r.date}</div>
  <div class="rec-v">腰 ${r.waist || '—'} · 臀 ${r.hip || '—'} · 大腿 ${r.thigh || '—'} · 小腿 ${r.calf || '—'} · 手臂 ${r.arm || '—'} cm</div>
  <div class="rec-del" onclick="event.stopPropagation();delMeasure('${r.id}')">删除</div>
</div>`).join('');
    $('measureRecords').innerHTML = m.length ? `<div class="rec-list">${html}</div>` : '<div class="today-empty">还没有围度记录</div>';

    if (m.length > 3) {
      $('measureExpandFn').innerHTML = `<span class="fn-btn" onclick="toggleMeasureExpand()">${showAll ? '收起' : '查看全部 (' + m.length + '条)'}</span>`;
    } else {
      $('measureExpandFn').innerHTML = '';
    }
  }

  function toggleMeasureExpand() {
    state._measureShowAll = !state._measureShowAll;
    save(); renderMeasureRecords();
  }
  function delMeasure(id) { conf('删除？', () => { state.measure = state.measure.filter(m => m.id !== id); save(); renderAll() }) }

  /* ===================== 趋势图（带切换） ===================== */
  let chartType = 'weight';
  function renderChart() {
    const types = [
      { key: 'weight', label: '体重', unit: 'kg', data: state.weight.map(w => ({ date: w.date, value: w.weight })), color: '#7AAA67' },
      { key: 'bodyFat', label: '体脂率', unit: '%', data: state.weight.filter(w => w.bodyFat != null).map(w => ({ date: w.date, value: w.bodyFat })), color: '#D18888' },
      { key: 'waist', label: '腰围', unit: 'cm', data: state.measure.filter(m => m.waist != null).map(m => ({ date: m.date, value: m.waist })), color: '#E8B0B0' },
      { key: 'thigh', label: '大腿', unit: 'cm', data: state.measure.filter(m => m.thigh != null).map(m => ({ date: m.date, value: m.thigh })), color: '#A0C88E' },
      { key: 'calf', label: '小腿', unit: 'cm', data: state.measure.filter(m => m.calf != null).map(m => ({ date: m.date, value: m.calf })), color: '#F2DF99' },
      { key: 'arm', label: '手臂', unit: 'cm', data: state.measure.filter(m => m.arm != null).map(m => ({ date: m.date, value: m.arm })), color: '#A8C5DC' }
    ];
    const cur = types.find(t => t.key === chartType) || types[0];
    const tgtW = getTargetWeight();

    let chartHtml = '';
    if (cur.data.length >= 2) {
      const W = 600, H = 160, pL = 38, pR = 12, pT = 16, pB = 24;
      const minV = chartType === 'weight' ? Math.min(tgtW, Math.min(...cur.data.map(d => d.value))) - 1 : Math.min(...cur.data.map(d => d.value)) - 2;
      const maxV = Math.max(...cur.data.map(d => d.value)) + 2;
      const xs = i => pL + (W - pL - pR) * i / (cur.data.length - 1);
      const ys = v => pT + (H - pT - pB) * (1 - (v - minV) / (maxV - minV));
      const path = cur.data.map((d, i) => (i ? 'L' : 'M') + xs(i) + ',' + ys(d.value)).join(' ');
      const area = path + ` L${xs(cur.data.length - 1)},${H - pB} L${xs(0)},${H - pB} Z`;
      const labels = [maxV.toFixed(1), ((minV + maxV) / 2).toFixed(1), minV.toFixed(1)];
      let tgtLine = '';
      if (chartType === 'weight') {
        const ty = ys(tgtW);
        tgtLine = `<line x1="${pL}" y1="${ty}" x2="${W - pR}" y2="${ty}" stroke="#D9BD5E" stroke-width="1" stroke-dasharray="4 3"/>
      <text x="${W - pR - 4}" y="${ty - 4}" text-anchor="end" font-size="10" fill="#D9BD5E">目标 ${tgtW}kg</text>`;
      }
      chartHtml = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto">
    <line x1="${pL}" y1="${pT}" x2="${pL}" y2="${H - pB}" stroke="#e5e5e5" stroke-width="1"/>
    <line x1="${pL}" y1="${H - pB}" x2="${W - pR}" y2="${H - pB}" stroke="#e5e5e5" stroke-width="1"/>
    ${labels.map((l, i) => `<text x="${pL - 6}" y="${pT + (H - pT - pB) * i / 2 + 4}" text-anchor="end" font-size="10" fill="#B4B4B4">${l}</text>`).join('')}
    ${tgtLine}
    <defs><linearGradient id="grd" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${cur.color}" stop-opacity="0.3"/><stop offset="100%" stop-color="${cur.color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#grd)"/>
    <path d="${path}" fill="none" stroke="${cur.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    ${cur.data.map((d, i) => `<circle cx="${xs(i)}" cy="${ys(d.value)}" r="3.5" fill="#fff" stroke="${cur.color}" stroke-width="2"/>`).join('')}
  </svg>`;
    } else {
      chartHtml = '<div class="today-empty" style="padding:20px">记满 2 次数据后显示趋势图</div>';
    }

    $('chartArea').innerHTML = `
  <div class="chart-tabs">${types.map(t => `<div class="chart-tab ${chartType === t.key ? 'active' : ''}" onclick="setChartType('${t.key}')">${t.label}</div>`).join('')}</div>
  <div class="chart-wrap">${chartHtml}</div>
  <div class="chart-actions">
    <button onclick="openWeightModal()">记录体重</button>
    <button onclick="openMeasureModal()">记录围度</button>
  </div>`;
  }
  function setChartType(k) { chartType = k; renderChart() }

  /* ===================== 目标页面 ===================== */
  function calcGoalProgress(g) {
    // 统一按任务型：KR 完成数 / 总 KR 数
    const done = g.krs.filter(k => k.done).length;
    const total = g.krs.length || 1;
    const pct = total ? Math.round(done / total * 100) : 0;
    const curLabel = done + '/' + total + ' 个任务';
    return { pct, current: done, curLabel };
  }

  function renderGoals() {
    const gs = state.goals;
    // 过滤：已兑换的不在主列表显示
    const activeGoals = gs.filter(g => !(g.rewardRedeemed && g.reward));
    if (!activeGoals.length && !gs.length) { $('goalList').innerHTML = '<div class="goal-empty">还没有目标，点击「新目标」开始吧</div>'; $('goalSummary').style.display = 'none'; return }

    // 已完成统计
    const completed = gs.filter(g => { const { pct } = calcGoalProgress(g); return pct >= 100 });
    const redeemed = gs.filter(g => g.rewardRedeemed && g.reward);
    const total = gs.length;
    $('goalSummary').style.display = 'block';
    $('goalSummary').innerHTML = completed.length
      ? `<div class="goal-summary-done" onclick="showCompletedGoals()" title="点击查看已完成的目标">
      <div class="goal-summary-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 22V8c0-1.1.9-2 2-2h0c1.1 0 2 .9 2 2v14"/><path d="M8 22V8"/><path d="M16 22V8"/><circle cx="12" cy="4" r="3"/></svg></div>
      <div class="goal-summary-info">
        <div class="goal-summary-label">目标已完成</div>
        <div class="goal-summary-sub">${total} 个目标 · ${Math.round(completed.length / total * 100)}% 达成率${redeemed.length ? ' · 已兑换 ' + redeemed.length + ' 个' : ''}</div>
      </div>
      <span class="goal-summary-num">${completed.length}</span>
      <span class="goal-summary-arrow">&#9654;</span>
     </div>`
      : `<div class="goal-summary-done zero">
      <div class="goal-summary-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
      <div class="goal-summary-info">
        <div class="goal-summary-label">还没有完成的目标</div>
        <div class="goal-summary-sub">${total} 个目标进行中，继续加油！</div>
      </div>
      <span class="goal-summary-num">0</span>
     </div>`;

    $('goalList').innerHTML = activeGoals.length ? activeGoals.map(g => {
      const { pct, curLabel } = calcGoalProgress(g);
      const days = db(today(), g.deadline);
      const urg = days <= 30 && days >= 0, over = days < 0;
      const cb = ({ health: 'g', love: 'p', skill: 'c', work: 'b', life: 'pu', finance: 'c', travel: 'b', hobby: 'p' }[g.category] || 'g');
      const pctClr = g.category === 'health' ? 'var(--g500)' : g.category === 'skill' ? 'var(--c300)' : g.category === 'love' ? 'var(--p300)' : 'var(--ink)';
      const typeLabel = g.category === 'health' ? '🩺 健康' : '📋 任务';
      const typeCls = 'task';
      // 健康目标显示目标信息
      const tgtW = getTargetWeight();
      const healthTgtInfo = g.category === 'health'
        ? (tgtW != null ? ('减到 ' + tgtW + ' kg') : '') + (g.bodyFatTgt ? ' · 体脂 ' + g.bodyFatTgt + '%' : '')
        : '';
      // 进度奖励提示
      return `<div class="goal-card">
    <div class="goal-top">
      <span class="goal-tag ${g.category}">${(CATEGORIES.find(c => c.id === g.category) || { label: g.category }).label}</span>
      <span class="goal-type-tag ${typeCls}">${typeLabel}</span>
      <div class="goal-title">${esc(g.title)}${healthTgtInfo ? `<span style="font-size:10px;font-weight:400;color:var(--ink-light);display:block">${healthTgtInfo}</span>` : ''}</div>
      <div class="goal-pct" style="color:${pctClr}">${pct}%</div>
    </div>
    <div class="goal-bar"><div class="goal-bar-fill ${cb}" style="width:${pct}%"></div></div>
    <div class="goal-meta">
      <span>${curLabel}</span>
      <span class="${urg || over ? 'urgent' : ''}">${over ? '已超期 ' + (-days) + ' 天' : g.deadline === today() ? '今天到期' : g.category === 'health' ? '' : days < 0 ? '' : '还剩 ' + days + ' 天'}</span>
    </div>
    ${g.krs && g.krs.length ? `<div class="goal-kr">${g.krs.map((kr, i) => `<div class="goal-kr-item ${kr.done ? 'done' : ''}" onclick="toggleKR('${g.id}',${i})"><span class="kdot"></span>${esc(kr.title)}</div>`).join('')}</div>` : ''}
    ${pct >= 100 && g.reward && !g.rewardRedeemed ? `<div class="goal-reward-done" onclick="redeemGoalReward('${g.id}',event)" title="点击兑换奖励">🎁 <b>已达成！</b> 点击兑换：${esc(g.reward)}</div>` : ''}
    ${pct < 100 && g.reward ? `<div class="goal-reward-hint">🎁 还有 <b>${100 - pct}%</b> 就可以 ${esc(g.reward)} 啦</div>` : ''}
    <div class="goal-actions">
      <button onclick="openGoalModal('${g.id}')">编辑</button>
      <button class="dg" data-del-goal="${g.id}">删除</button>
    </div></div>`;
    }).join('') : '<div class="goal-empty">所有目标已兑换完成</div>';

    // 绑定删除按钮事件（比 inline onclick 更可靠）
    document.querySelectorAll('.dg[data-del-goal]').forEach(btn => {
      btn.onclick = function () {
        const id = this.dataset.delGoal;
        conf('删除目标？', () => {
          state.goals = state.goals.filter(g => g.id !== id);
          save(); renderAll();
        });
      };
    });
  }

  function redeemGoalReward(id, e) {
    if (e) e.stopPropagation();
    const g = state.goals.find(x => x.id === id);
    if (!g || !g.reward || g.rewardRedeemed) return;
    conf(`兑换奖励：「${g.reward}」？`, () => {
      g.rewardRedeemed = true;
      save(); renderAll();
      toast('奖励已兑换！好好享受吧~');
    });
  }

  function showCompletedGoals() {
    const gs = state.goals.filter(g => { const { pct } = calcGoalProgress(g); return pct >= 100 });
    if (!gs.length) return toast('还没有完成的目标');
    const list = gs.map(g => {
      const { pct, curLabel } = calcGoalProgress(g);
      const catName = (CATEGORIES.find(c => c.id === g.category) || { label: g.category }).label;
      const redeemedTag = g.rewardRedeemed && g.reward ? `<span style="font-size:10px;background:var(--c50);color:var(--c300);padding:1px 6px;border-radius:8px;white-space:nowrap">已兑换</span>` : '';
      const rewardInfo = g.reward && !g.rewardRedeemed ? `<span style="font-size:10px;color:var(--warning);white-space:nowrap">待兑换: ${esc(g.reward)}</span>` : '';
      return `<div class="completed-goal-row" onclick="viewCompletedGoalDetail('${g.id}')" style="display:flex;align-items:center;gap:8px;padding:10px 8px;border-bottom:1px solid var(--line);flex-wrap:wrap;cursor:pointer;border-radius:8px;transition:background .15s" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
    <span class="goal-tag ${g.category}" style="font-size:10px">${catName}</span>
    <span style="flex:1;font-size:13px;font-weight:500;min-width:100px">${esc(g.title)} ${redeemedTag} ${rewardInfo}</span>
    <span style="font-size:12px;color:var(--success)">${curLabel}</span>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="color:var(--ink-light);flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>
  </div>`;
    }).join('');
    openModal({ title: '已完成的目标（共 ' + gs.length + ' 个，点击查看详情）', body: list, foot: '<button class="btn" onclick="closeModal()">关闭</button>' });
  }

  function viewCompletedGoalDetail(gid) {
    const g = state.goals.find(x => x.id === gid);
    if (!g) return;
    const { pct, curLabel } = calcGoalProgress(g);
    const catName = (CATEGORIES.find(c => c.id === g.category) || { label: g.category }).label;
    const deadlineStr = g.deadline || '未设截止';
    const completedDate = today();
    const rewardStatus = g.reward
      ? (g.rewardRedeemed ? '<span style="color:var(--success)">奖励已兑换：' + esc(g.reward) + '</span>'
        : `<span style="color:var(--warning)">奖励待兑换：${esc(g.reward)} <button class="btn" style="font-size:11px;padding:4px 12px;margin-left:8px" onclick="redeemGoalReward('${g.id}')">立即兑换</button></span>`)
      : '<span style="color:var(--ink-light)">未设置奖励</span>';
    const krHTML = g.krs && g.krs.length
      ? `<div style="margin-top:10px"><div style="font-size:12px;font-weight:600;color:var(--ink-soft);margin-bottom:6px">关键结果</div>${g.krs.map((kr, i) => `<div class="goal-kr-item ${kr.done ? 'done' : ''}" style="padding:4px 0"><span class="kdot"></span>${esc(kr.title)}</div>`).join('')}</div>`
      : '';
    const body = `<div style="padding:4px 0">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
    <span class="goal-tag ${g.category}" style="font-size:11px">${catName}</span>
    <span style="font-size:12px;color:var(--ink-soft)">截止：${deadlineStr}</span>
  </div>
  <div style="font-size:15px;font-weight:600;margin-bottom:10px">${esc(g.title)}</div>
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
    <span style="font-size:24px;font-weight:700;color:var(--success)">${pct}%</span>
    <span style="font-size:13px;color:var(--ink-soft)">${curLabel}</span>
    <span style="font-size:12px;color:var(--ink-light)">完成于 ${completedDate}</span>
  </div>
  <div class="goal-bar" style="margin-bottom:12px"><div class="goal-bar-fill g" style="width:${pct}%"></div></div>
  <div style="font-size:13px;margin-bottom:4px">${rewardStatus}</div>
  ${krHTML}
</div>`;
    openModal({ title: '目标详情', body: body, foot: `<button class="btn" onclick="closeModal()">关闭</button><button class="btn" style="color:var(--danger);margin-left:8px" onclick="conf('删除已完成的目标：${esc(g.title)}？',function(){state.goals=state.goals.filter(x=>x.id!=='${gid}');save();renderAll();closeModal();toast('已删除')})">删除</button>` });
  }
  function catLabel(c) { return (CATEGORIES.find(x => x.id === c) || { label: c }).label }
  function toggleKR(gid, idx) {
    const g = state.goals.find(x => x.id === gid); if (!g) return;
    if (g.type === 'metric') return toast('数值型目标进度自动从数据读取');
    g.krs[idx].done = !g.krs[idx].done;
    save(); renderAll();
  }
  function delGoal(id) { conf('删除目标？', () => { state.goals = state.goals.filter(g => g.id !== id); save(); renderAll() }) }

  function redeemReward(gid) {
    const g = state.goals.find(x => x.id === gid);
    if (!g || !g.reward) return;
    conf(`🎁 兑换奖励"${g.reward}"，确认后将删除此目标`, () => {
      state.goals = state.goals.filter(x => x.id !== gid);
      save(); renderAll(); toast('🎉 奖励已兑换！享受你的"' + g.reward + '"吧~');
    });
  }

  /* ===================== 学习页面 ===================== */
  let skillFilter = 'all';
  let studyTimer = { running: false, paused: false, module: '', startTime: 0, elapsed: 0, pauseTime: 0, interval: null, mode: 'up', targetMin: 25 };
  let selTimerModule = '';
  let showCharts = false;
  let showChartInline = false;
  let chartInlineType = 'week'; // 'week', 'month', 'year', 'module'
  let selTimerContent = '';
  let selTimerMode = 'up';
  let selTimerTarget = 25;
  function drawModuleChart(all) {
    var byMod = {};
    all.forEach(function (s) { byMod[s.skill] = (byMod[s.skill] || 0) + (s.duration || 0) });
    var entries = Object.entries(byMod).sort(function (a, b) { return b[1] - a[1] });
    if (!entries.length) return '';
    var maxV = entries[0][1] || 1;
    var colors = ['#7EC8A0', '#6BB5D9', '#D4A0C8', '#F0C060', '#E8887A', '#8DB8A8', '#C0A0E0', '#F8A080'];
    var rowH = 24, gap = 36, padTop = 16, padLeft = 88;
    var totalH = entries.length * gap + padTop + 8;
    var chartW = 400, barMaxW = 270;
    var svg = '<svg viewBox="0 0 ' + chartW + ' ' + totalH + '" class="study-chart-svg">';
    // 背景网格线
    for (var g = 1; g < entries.length; g++) {
      svg += '<line x1="' + padLeft + '" y1="' + (padTop + g * gap - rowH / 2 - 4) + '" x2="' + (padLeft + barMaxW) + '" y2="' + (padTop + g * gap - rowH / 2 - 4) + '" stroke="var(--line)" stroke-width="0.5" stroke-dasharray="3,3"/>';
    }
    entries.forEach(function (e, i) {
      var pct = Math.min(e[1] / maxV, 1) * barMaxW;
      var c = colors[i % colors.length];
      var h = Math.round(e[1] / 60 * 10) / 10;
      var y = padTop + i * gap;
      svg += '<text x="2" y="' + (y + 7) + '" font-size="13" fill="var(--ink)">' + esc(e[0]) + '</text>';
      svg += '<rect x="' + padLeft + '" y="' + (y - rowH / 2) + '" width="' + Math.max(pct, 6) + '" height="' + rowH + '" rx="5" fill="' + c + '" opacity="0.85"/>';
      svg += '<text x="' + (padLeft + Math.max(pct, 6) + 8) + '" y="' + (y + 6) + '" font-size="12" fill="var(--ink)" font-weight="600">' + h + 'h</text>';
    });
    svg += '</svg>';
    return svg;
  }
  function drawWeekChart(all) {
    var days = []; var labels = ['日', '一', '二', '三', '四', '五', '六'];
    for (var i = 6; i >= 0; i--) { var d = new Date(); d.setDate(d.getDate() - i); days.push(d.toISOString().slice(0, 10)) }
    var byDay = {}; days.forEach(function (d) { byDay[d] = 0 });
    all.forEach(function (s) { if (byDay[s.date] !== undefined) byDay[s.date] += (s.duration || 0) });
    var vals = days.map(function (d) { return byDay[d] });
    var maxV = Math.max.apply(null, vals.concat([1]));
    var td = today();
    var w = 420, h = 200, mL = 44, mR = 16, mT = 24, mB = 28;
    var chartW = w - mL - mR, chartH = h - mT - mB;
    var barW = 36, gap = (chartW - barW * 7) / 6;
    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" class="study-chart-svg">';
    // 网格线 + Y轴标签
    var gridLines = 5;
    for (var g = 0; g <= gridLines; g++) {
      var gy = mT + g * (chartH / gridLines);
      svg += '<line x1="' + mL + '" y1="' + gy + '" x2="' + (w - mR) + '" y2="' + gy + '" stroke="var(--line)" stroke-width="0.5" stroke-dasharray="3,3"/>';
      svg += '<text x="' + (mL - 6) + '" y="' + (gy + 4) + '" font-size="10" fill="var(--ink-light)" text-anchor="end">' + (maxV / 60 / gridLines * g).toFixed(1) + 'h</text>';
    }
    days.forEach(function (d, i) {
      var dayOfWeek = new Date(d + 'T00:00:00').getDay();
      var val = byDay[d]; var bh = Math.max(val / maxV * chartH, val > 0 ? 5 : 0);
      var isToday = d === td;
      var x = mL + i * (barW + gap);
      svg += '<rect x="' + x + '" y="' + (mT + chartH - bh) + '" width="' + barW + '" height="' + bh + '" rx="4" fill="' + (isToday ? '#7EC8A0' : '#6BB5D9') + '" opacity="' + (isToday ? '0.9' : '0.7') + '"/>';
      if (val > 0) svg += '<text x="' + (x + barW / 2) + '" y="' + (mT + chartH - bh - 6) + '" text-anchor="middle" font-size="10" fill="var(--ink)" font-weight="600">' + Math.round(val / 60 * 10) / 10 + 'h</text>';
      svg += '<text x="' + (x + barW / 2) + '" y="' + (h - 6) + '" text-anchor="middle" font-size="11" fill="' + (isToday ? 'var(--g500)' : 'var(--ink-light)') + '" font-weight="' + (isToday ? '600' : '400') + '">' + labels[dayOfWeek] + '</text>';
    });
    svg += '</svg>';
    return svg;
  }
  function drawMonthChart(all) {
    var td = today(); var tdDate = new Date(td + 'T00:00:00');
    var year = tdDate.getFullYear(), month = tdDate.getMonth();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var days = [];
    for (var i = 1; i <= daysInMonth; i++) { days.push(monthPad(year) + '-' + monthPad(month + 1) + '-' + monthPad(i)) }
    var byDay = {}; days.forEach(function (d) { byDay[d] = 0 });
    all.forEach(function (s) { if (byDay[s.date] !== undefined) byDay[s.date] += (s.duration || 0) });
    var vals = days.map(function (d) { return byDay[d] });
    var maxV = Math.max.apply(null, vals.concat([1]));
    var h = 200, mL = 44, mR = 16, mT = 24, mB = 28;
    var chartH = h - mT - mB;
    var barW = Math.max(4, Math.floor((380 - mL - mR) / daysInMonth - 6)), gap = 6;
    var w = Math.max(380, mL + daysInMonth * (barW + gap) + mR);
    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" class="study-chart-svg">';
    var gridLines = 5;
    for (var g = 0; g <= gridLines; g++) {
      var gy = mT + g * (chartH / gridLines);
      svg += '<line x1="' + mL + '" y1="' + gy + '" x2="' + (w - mR) + '" y2="' + gy + '" stroke="var(--line)" stroke-width="0.5" stroke-dasharray="3,3"/>';
      svg += '<text x="' + (mL - 6) + '" y="' + (gy + 4) + '" font-size="10" fill="var(--ink-light)" text-anchor="end">' + (maxV / 60 / gridLines * g).toFixed(1) + 'h</text>';
    }
    days.forEach(function (d, i) {
      var val = byDay[d]; var bh = Math.max(val / maxV * chartH, val > 0 ? 4 : 0);
      var isToday = d === td;
      var x = mL + i * (barW + gap);
      svg += '<rect x="' + x + '" y="' + (mT + chartH - bh) + '" width="' + barW + '" height="' + bh + '" rx="2" fill="' + (isToday ? '#7EC8A0' : '#6BB5D9') + '" opacity="' + (isToday ? '0.9' : '0.6') + '"/>';
      if (i % 5 === 0 || i === 0 || i === daysInMonth - 1) svg += '<text x="' + (x + barW / 2) + '" y="' + (h - 6) + '" text-anchor="middle" font-size="9" fill="' + (isToday ? 'var(--g500)' : 'var(--ink-light)') + '" font-weight="' + (isToday ? '600' : '400') + '">' + (i + 1) + '</text>';
    });
    svg += '</svg>';
    return svg;
  }
  function drawYearChart(all) {
    var td = today(); var year = new Date(td + 'T00:00:00').getFullYear();
    var months = [];
    for (var i = 0; i < 12; i++) { months.push({ label: (i + 1) + '月', key: monthPad(year) + '-' + monthPad(i + 1) }) }
    var byMon = {}; months.forEach(function (m) { byMon[m.key] = 0 });
    all.forEach(function (s) { if (s.date) { var mk = s.date.slice(0, 7); if (byMon[mk] !== undefined) byMon[mk] += (s.duration || 0) } });
    var vals = months.map(function (m) { return byMon[m.key] });
    var maxV = Math.max.apply(null, vals.concat([1]));
    var w = 420, h = 200, mL = 44, mR = 16, mT = 24, mB = 28;
    var chartW = w - mL - mR, chartH = h - mT - mB;
    var barW = 22, gap = (chartW - barW * 12) / 11;
    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" class="study-chart-svg">';
    var gridLines = 5;
    for (var g = 0; g <= gridLines; g++) {
      var gy = mT + g * (chartH / gridLines);
      svg += '<line x1="' + mL + '" y1="' + gy + '" x2="' + (w - mR) + '" y2="' + gy + '" stroke="var(--line)" stroke-width="0.5" stroke-dasharray="3,3"/>';
      svg += '<text x="' + (mL - 6) + '" y="' + (gy + 4) + '" font-size="10" fill="var(--ink-light)" text-anchor="end">' + (maxV / 60 / gridLines * g).toFixed(1) + 'h</text>';
    }
    var curMon = monthPad(year) + '-' + monthPad(new Date(td + 'T00:00:00').getMonth() + 1);
    months.forEach(function (m, i) {
      var val = byMon[m.key]; var bh = Math.max(val / maxV * chartH, val > 0 ? 5 : 0);
      var isCur = m.key === curMon;
      var x = mL + i * (barW + gap);
      svg += '<rect x="' + x + '" y="' + (mT + chartH - bh) + '" width="' + barW + '" height="' + bh + '" rx="4" fill="' + (isCur ? '#7EC8A0' : '#6BB5D9') + '" opacity="' + (isCur ? '0.9' : '0.7') + '"/>';
      if (val > 0) svg += '<text x="' + (x + barW / 2) + '" y="' + (mT + chartH - bh - 6) + '" text-anchor="middle" font-size="10" fill="var(--ink)" font-weight="600">' + Math.round(val / 60 * 10) / 10 + 'h</text>';
      svg += '<text x="' + (x + barW / 2) + '" y="' + (h - 6) + '" text-anchor="middle" font-size="11" fill="' + (isCur ? 'var(--g500)' : 'var(--ink-light)') + '" font-weight="' + (isCur ? '600' : '400') + '">' + m.label + '</text>';
    });
    svg += '</svg>';
    return svg;
  }
  function monthPad(n) { return n < 10 ? '0' + n : '' + n }
  function renderStudy() {
    const all = [...state.study].sort((a, b) => b.date.localeCompare(a.date));
    const modules = state.studyModules || [];
    const dataSkills = [...new Set(all.map(s => s.skill))];
    const tabSkills = dataSkills;
    const list = skillFilter === 'all' ? all : all.filter(s => s.skill === skillFilter);
    const tM = all.reduce((a, b) => a + (b.duration || 0), 0);
    const wRecs = all.filter(s => db(s.date, today()) >= 0 && db(s.date, today()) <= 7);
    const wM = wRecs.reduce((a, b) => a + (b.duration || 0), 0);
    const t = studyTimer;
    var timerHTML = '';
    if (t.running || t.paused) {
      var now = t.paused ? t.pauseTime : Date.now();
      var disp = t.elapsed + (t.paused ? 0 : now - t.startTime);
      if (t.mode === 'down') {
        var remaining = t.targetMin * 60000 - disp;
        if (remaining <= 0) { endStudyTimer(); return; }
        var rm = Math.floor(remaining / 60000);
        var rs = Math.floor((remaining % 60000) / 1000);
        var flashing = remaining < 60000 ? ' timer-flash' : '';
        timerHTML = '<div class="study-timer">' +
          '<div class="timer-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" style="vertical-align:-2px;margin-right:2px"><path d="M5 22h14M5 2h14M17 22v-4.17a3 3 0 00-.88-2.12L12 11.59 7.88 15.7A3 3 0 007 17.83V22M7 2v4.17a3 3 0 00.88 2.12L12 12.41l4.12-4.12A3 3 0 0017 6.17V2"/></svg>' + (t.paused ? '已暂停' : '倒计时中') + '</div>' +
          '<div class="timer-display' + flashing + '">' + String(rm).padStart(2, '0') + ':' + String(rs).padStart(2, '0') + '</div>' +
          '<div class="timer-module">模块：<span>' + esc(t.module) + '</span></div>' +
          '<div class="timer-btns">' +
          (t.paused
            ? '<button class="btn-timer-resume" onclick="resumeStudyTimer()"><svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12" style="vertical-align:-1px;margin-right:2px"><polygon points="6,3 20,12 6,21"/></svg>继续</button>'
            : '<button class="btn-timer-pause" onclick="pauseStudyTimer()"><svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12" style="vertical-align:-1px;margin-right:2px"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>暂停</button>') +
          '<button class="btn-timer-end" onclick="endStudyTimer()"><svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12" style="vertical-align:-1px;margin-right:2px"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>结束学习</button>' +
          '</div></div>';
      } else {
        var m = Math.floor(disp / 60000), s = Math.floor((disp % 60000) / 1000);
        timerHTML = '<div class="study-timer">' +
          '<div class="timer-label"><svg viewBox="0 0 24 24" fill="none" stroke="#E74C3C" stroke-width="2" width="14" height="14" style="vertical-align:-2px;margin-right:2px"><circle cx="12" cy="13" r="8"/><polyline points="12 7 12 13 16 15"/></svg>' + (t.paused ? '已暂停' : '学习计时中') + '</div>' +
          '<div class="timer-display">' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '</div>' +
          '<div class="timer-module">模块：<span>' + esc(t.module) + '</span></div>' +
          '<div class="timer-btns">' +
          (t.paused
            ? '<button class="btn-timer-resume" onclick="resumeStudyTimer()"><svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12" style="vertical-align:-1px;margin-right:2px"><polygon points="6,3 20,12 6,21"/></svg>继续</button>'
            : '<button class="btn-timer-pause" onclick="pauseStudyTimer()"><svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12" style="vertical-align:-1px;margin-right:2px"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>暂停</button>') +
          '<button class="btn-timer-end" onclick="endStudyTimer()"><svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12" style="vertical-align:-1px;margin-right:2px"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>结束学习</button>' +
          '</div></div>';
      }
    } else {
      var selMod = selTimerModule;
      var ready = selMod && selTimerContent;
      var modeUp = selTimerMode === 'up';
      timerHTML = '<div class="study-timer" style="background:var(--bg);padding:28px 20px">' +
        '<div style="display:flex;flex-direction:column;align-items:center;gap:10px">' +
        '<button class="btn-timer-pick" onclick="openTimerModuleModal()">' + (selMod ? esc(selMod) + ' · ' + esc(selTimerContent) : '+ 选择学习模块') + '</button>' +
        '<div class="timer-mode-toggle">' +
        '<span class="tmode-opt' + (modeUp ? ' active' : '') + '" onclick="selTimerMode=\'up\';renderStudy()">正计时</span>' +
        '<span class="tmode-opt' + (!modeUp ? ' active' : '') + '" onclick="selTimerMode=\'down\';renderStudy()">倒计时</span>' +
        '</div>' +
        (!modeUp
          ? '<div class="timer-target-row">' + [15, 25, 30, 45, 60].map(function (v) { return '<span class="tchip' + (selTimerTarget === v ? ' active' : '') + '" onclick="selTimerTarget=' + v + ';renderStudy()">' + v + 'min</span>' }).join('') + '<input class="tchip-inp" type="number" id="tcustMin" placeholder="自定义" min="1" max="180" onchange="selTimerTarget=+this.value||25;renderStudy()"></div>'
          : '') +
        '<button class="btn-timer-start" onclick="startStudyTimer()"' + (ready ? '' : ' disabled') + '><svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="vertical-align:-1px;margin-right:2px"><polygon points="6,3 20,12 6,21"/></svg>开始学习</button>' +
        '</div>' +
        '</div>';
    }
    $('studyArea').innerHTML = timerHTML + `
  <div class="study-stats">
    <div class="study-stat">
      <div class="v">${(wM / 60).toFixed(1)}</div>
      <div class="l">本周累计小时</div>
    </div>
    <div class="study-stat">
      <div class="v">${wRecs.length}</div>
      <div class="l">本周学习次数</div>
    </div>
  </div>
  <div class="study-tabs">
    <div class="study-tab ${skillFilter === 'all' ? 'active' : ''}" onclick="skillFilter='all';renderStudy()">全部</div>
    ${tabSkills.map(s => `<div class="study-tab ${skillFilter === s ? 'active' : ''}" onclick="skillFilter='${esc(s)}';renderStudy()">${esc(s)}</div>`).join('')}
    ${all.length ? `<button class="chart-trigger-inline ${showChartInline ? 'active' : ''}" onclick="showChartInline=!showChartInline;renderStudy()" title="数据可视化"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>` : ''}
    <a class="study-manage" onclick="manageStudyModules()" title="管理学习模块">⚙</a>
  </div>
  ${all.length && showChartInline ? `
  <div class="chart-inline-area">
    <div class="chart-inline-tabs">
      <span class="chart-mtab ${chartInlineType === 'week' ? 'active' : ''}" onclick="chartInlineType='week';renderStudy()">周</span>
      <span class="chart-mtab ${chartInlineType === 'month' ? 'active' : ''}" onclick="chartInlineType='month';renderStudy()">月</span>
      <span class="chart-mtab ${chartInlineType === 'year' ? 'active' : ''}" onclick="chartInlineType='year';renderStudy()">年</span>
      <span class="chart-mtab ${chartInlineType === 'module' ? 'active' : ''}" onclick="chartInlineType='module';renderStudy()">模块</span>
    </div>
    <div style="margin-top:12px">${drawInlineChart(all)}</div>
  </div>`: ''}
  <div class="study-list">
    ${list.length ? list.map(s => `<div class="study-item">
      <div class="si">${esc(s.skill)}</div>
      <div class="st">${esc(s.content || '无')}</div>
      <div class="sd">${s.date} · ${s.duration}min</div>
      <div class="sa"><span class="sa-btn" onclick="openStudyModal('${s.id}')">编辑</span><span class="sa-btn del" onclick="delStudy('${s.id}')">删除</span></div>
    </div>`).join('') : '<div class="today-empty">还没有学习记录</div>'}
  </div>`;
  }
  function manageStudyModules() {
    const modules = state.studyModules || [];
    const list = modules.length
      ? '<div class="chip-group" id="manageModList">' + modules.map(function (m) {
        return '<div class="chip" style="cursor:default;position:relative">' + esc(m) +
          '<span class="chip-del" onclick="delStudyModule(\'' + esc(m) + '\')">&times;</span>' +
          '</div>';
      }).join('') + '</div>'
      : '<div id="manageModWrap"><div style="font-size:13px;color:var(--ink-light);padding:12px 0;text-align:center">还没有学习模块</div></div>';
    openModal({
      title: '管理学习模块',
      body: list +
        '<div style="margin-top:14px;text-align:center">' +
        '<button class="btn ghost" style="font-size:12px" id="btnShowModInput" onclick="showModInput()">+ 新增模块</button>' +
        '<div id="modInputRow" style="margin-top:8px;display:none;gap:4px">' +
        '<input class="inp" id="modNew" placeholder="输入模块名称" style="flex:1;font-size:13px">' +
        '<button class="btn ghost" style="padding:6px 14px;white-space:nowrap" onclick="addModuleFromManage()">确认</button>' +
        '</div>' +
        '</div>',
      foot: '<button class="btn" onclick="closeModal()">完成</button>'
    });
  }
  function showModInput() {
    var row = document.getElementById('modInputRow');
    if (row) { row.style.display = 'flex' }
    var btn = document.getElementById('btnShowModInput');
    if (btn) { btn.style.display = 'none' }
  }
  function addModuleFromManage() {
    var n = $('modNew').value.trim(); if (!n) return toast('请输入名称');
    if (state.studyModules.includes(n)) return toast('已存在');
    state.studyModules.push(n); save();
    // 更新弹窗内模块列表
    var group = document.getElementById('manageModList');
    if (!group) {
      // 之前是空状态，替换为 chip-group
      var wrap = document.getElementById('manageModWrap');
      if (wrap) { wrap.innerHTML = '<div class="chip-group" id="manageModList"></div>'; group = document.getElementById('manageModList'); }
    }
    if (group) {
      var div = document.createElement('div'); div.className = 'chip'; div.style.cssText = 'cursor:default;position:relative';
      div.innerHTML = esc(n) + '<span class="chip-del" onclick="delStudyModule(\'' + esc(n) + '\')">&times;</span>';

      group.appendChild(div);
    }
    $('modNew').value = '';
    var row = document.getElementById('modInputRow'); if (row) row.style.display = 'none';
    var btn = document.getElementById('btnShowModInput'); if (btn) btn.style.display = 'inline-block';
    toast('已添加「' + n + '」');
  }
  function delStudyModule(name) {
    conf('删除模块「' + name + '」？（已有学习记录不受影响）', () => {
      state.studyModules = state.studyModules.filter(m => m !== name);
      save(); renderStudy();
      manageStudyModules();
    });
  }
  function delStudy(id) { conf('删除？', () => { state.study = state.study.filter(s => s.id !== id); save(); renderStudy() }) }
  function drawInlineChart(all) {
    var svg = ''; var vt = chartInlineType || 'week';
    if (vt === 'module') svg = drawModuleChart(all);
    else {
      if (vt === 'month') svg = drawMonthChart(all);
      else if (vt === 'year') svg = drawYearChart(all);
      else svg = drawWeekChart(all);
    }
    return svg;
  }

  /* ===================== 番茄计时 ===================== */
  function openTimerModuleModal() {
    selTimerModule = ''; selTimerContent = '';
    var modules = state.studyModules || [];
    var listHTML = modules.length
      ? '<div class="chip-group" id="timerModalChips">' + modules.map(function (m) { return '<div class="chip" data-mod="' + esc(m) + '" onclick="pickTimerModule(this)">' + esc(m) + '</div>' }).join('') + '</div>'
      : '<div style="font-size:13px;color:var(--ink-light);padding:12px 0;text-align:center">还没有学习模块</div>';
    openModal({
      title: '选择学习模块',
      body: listHTML +
        '<div style="margin-top:14px;text-align:center">' +
        '<button class="btn ghost" style="font-size:12px" id="btnShowTimerModInput" onclick="showTimerModInput()">+ 新增模块</button>' +
        '<div id="timerModInputRow" style="margin-top:8px;display:none;gap:4px">' +
        '<input class="inp" id="tmodNew" placeholder="输入模块名称" style="flex:1;font-size:13px">' +
        '<button class="btn ghost" style="padding:6px 14px;white-space:nowrap" onclick="addTimerModule()">确认</button>' +
        '</div>' +
        '</div>' +
        '<div class="form-group" style="margin-top:12px"><label>学习内容</label><input class="inp" id="tcontent" placeholder="正在学什么？" style="font-size:13px"></div>',
      foot: '<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" style="background:var(--g500);color:#fff" onclick="confirmTimerPick()">确认</button>'
    });
  }
  function showTimerModInput() {
    var row = document.getElementById('timerModInputRow');
    if (row) row.style.display = 'flex';
    var btn = document.getElementById('btnShowTimerModInput');
    if (btn) btn.style.display = 'none';
  }
  function pickTimerModule(el) {
    document.querySelectorAll('#timerModalChips .chip').forEach(function (c) { c.classList.remove('active') });
    el.classList.add('active');
  }
  function confirmTimerPick() {
    var sel = document.querySelector('#timerModalChips .chip.active');
    if (!sel) return toast('请先选择学习模块');
    var content = $('tcontent').value.trim();
    if (!content) return toast('请填写学习内容');
    selTimerModule = sel.dataset.mod;
    selTimerContent = content;
    closeModal(); renderStudy();
  }
  function addTimerModule() {
    var n = $('tmodNew').value.trim(); if (!n) return toast('请输入名称');
    if (state.studyModules.includes(n)) return toast('已存在');
    state.studyModules.push(n); save();
    closeModal(); openTimerModuleModal();
    toast('已添加「' + n + '」');
  }
  function startStudyTimer() {
    if (!selTimerModule) return toast('请先选择学习模块');
    if (!selTimerContent) return toast('请先填写学习内容');
    studyTimer.running = true; studyTimer.paused = false; studyTimer.module = selTimerModule;
    studyTimer.mode = selTimerMode; studyTimer.targetMin = selTimerTarget;
    studyTimer.startTime = Date.now(); studyTimer.elapsed = 0;
    studyTimer.interval = setInterval(function () { renderStudy() }, 1000);
    renderStudy();
  }
  function pauseStudyTimer() {
    studyTimer.paused = true; studyTimer.pauseTime = Date.now();
    studyTimer.elapsed += studyTimer.pauseTime - studyTimer.startTime;
    clearInterval(studyTimer.interval); studyTimer.interval = null;
    renderStudy();
  }
  function resumeStudyTimer() {
    studyTimer.paused = false; studyTimer.startTime = Date.now();
    studyTimer.interval = setInterval(function () { renderStudy() }, 1000);
    renderStudy();
  }
  function endStudyTimer() {
    clearInterval(studyTimer.interval); studyTimer.interval = null;
    var t = studyTimer; var now = Date.now();
    var total = t.elapsed + (t.paused ? 0 : now - t.startTime);
    var mins = Math.round(total / 60000);
    if (mins < 1) mins = 1;
    var content = selTimerContent || ('学习 ' + t.module);
    state.study.push({ id: uid(), date: today(), skill: t.module, duration: mins, content: content });
    studyTimer.running = false; studyTimer.paused = false; studyTimer.module = '';
    selTimerModule = ''; selTimerContent = '';
    save(); renderStudy(); toast('已记录 ' + mins + ' min');
  }

  /* ===================== 弹窗封装 ===================== */
  function openModal({ title, body, foot }) {
    $('modalTitle').textContent = title || '';
    $('modalBody').innerHTML = body || '';
    $('modalFoot').innerHTML = foot || '';
    $('modal').classList.add('show');
  }
  function closeModal() { $('modal').classList.remove('show'); editingStudyId = null; editingTodoId = null }

  /* ===================== 弹窗：体重 ===================== */
  function openWeightModal() {
    const ex = state.weight.find(w => w.date === today());
    openModal({
      title: '记体重',
      body: `<div class="form-group"><label>日期</label><input class="inp" type="date" id="wd" value="${today()}"></div>
    <div class="form-grid">
      <div class="form-group"><label>体重 (kg)</label><input class="inp" type="number" id="wv" step="0.1" placeholder="比如 61.0" value="${ex ? ex.weight : ''}"></div>
      <div class="form-group"><label>体脂率 (%) <span style="font-weight:400;color:var(--ink-light);font-size:10px">可选</span></label><input class="inp" type="number" id="wbf" step="0.1" placeholder="比如 22.5" value="${ex && ex.bodyFat ? ex.bodyFat : ''}"></div>
    </div>`,
      foot: '<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveWeight()">保存</button>'
    });
  }
  function saveWeight() {
    const d = $('wd').value, v = parseFloat($('wv').value);
    if (!d || isNaN(v)) return toast('请填写完整');
    const bf = $('wbf') ? parseFloat($('wbf').value) || null : null;
    const ex = state.weight.find(w => w.date === d);
    if (ex) { ex.weight = v; ex.bodyFat = bf; } else state.weight.push({ id: uid(), date: d, weight: v, bodyFat: bf });
    state.weight.sort((a, b) => a.date.localeCompare(b.date));
    save(); closeModal(); renderAll(); toast('已记录');
  }

  /* ===================== 弹窗：围度 ===================== */
  function openMeasureModal() {
    openModal({
      title: '记围度',
      body: `<div class="form-group"><label>日期</label><input class="inp" type="date" id="md" value="${today()}"></div>
    <div class="form-grid">
      <div class="form-group"><label>腰围 (cm)</label><input class="inp" type="number" id="waist" step="0.5" placeholder="腰围"></div>
      <div class="form-group"><label>臀围 (cm)</label><input class="inp" type="number" id="hip" step="0.5" placeholder="臀围"></div>
      <div class="form-group"><label>大腿 (cm)</label><input class="inp" type="number" id="thigh" step="0.5" placeholder="大腿"></div>
      <div class="form-group"><label>小腿 (cm)</label><input class="inp" type="number" id="calf" step="0.5" placeholder="小腿"></div>
      <div class="form-group"><label>手臂 (cm)</label><input class="inp" type="number" id="arm" step="0.5" placeholder="手臂"></div>
    </div>`,
      foot: '<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveMeasure()">保存</button>'
    });
  }
  function saveMeasure() {
    const d = $('md').value;
    const data = { date: d, waist: +$('waist').value || null, hip: +$('hip').value || null, thigh: +$('thigh').value || null, calf: +$('calf').value || null, arm: +$('arm').value || null };
    if (!d) return toast('请选择日期');
    const ex = state.measure.find(m => m.date === d);
    if (ex) Object.assign(ex, data); else state.measure.push({ id: uid(), ...data });
    state.measure.sort((a, b) => a.date.localeCompare(b.date));
    save(); closeModal(); renderAll(); toast('已记录');
  }

  /* ===================== 弹窗：自定义习惯（健康页用） ===================== */
  function openCustomHabitModal() {
    openModal({
      title: '自定义习惯',
      body: `<div class="form-group"><label>习惯名称</label><input class="inp" id="chlbl" placeholder="比如：拉伸10分钟"></div>`,
      foot: '<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveCustomHabit()">添加</button>'
    });
  }
  function saveCustomHabit() {
    const l = $('chlbl').value.trim(); if (!l) return toast('请输入名称');
    state.customHabits.push({ key: 'ch_' + uid(), label: l, icon: '⭐' });
    save(); closeModal(); renderAll(); toast('已添加');
  }
  function delCustomHabit(key) {
    conf('删除这个习惯？不会清除已打卡的历史记录。', function () {
      state.customHabits = state.customHabits.filter(function (h) { return h.key !== key });
      save(); renderAll(); toast('已删除');
    });
  }
  function toggleHabit(key) {
    const td = today();
    if (!state.habits[td]) state.habits[td] = {};
    state.habits[td][key] = !state.habits[td][key];
    save(); renderAll();
  }
  function renderHabits(containerId) {
    const td = today(), tdh = state.habits[td] || {};
    const builtins = HABITS;
    const customs = state.customHabits.map(h => ({ ...h, ico: h.icon ? '<circle cx="12" cy="12" r="10"/>' : '', _isCustom: true }));
    const all = [...builtins, ...customs];
    const doneN = all.filter(h => tdh[h.key]).length;
    $(containerId).innerHTML = `
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:12px;color:var(--ink-soft)">
    完成 <b style="color:var(--g500);font-size:14px">${doneN}</b>/${all.length} 项
  </div>
  <div class="habit-grid">
    ${all.map(h => {
      var delBtn = h._isCustom ? `<div class="habit-del" onclick="event.stopPropagation();delCustomHabit('${h.key}')" title="删除">` +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>' : '';
      return `<div class="habit-card ${tdh[h.key] ? 'done' : ''} ${h._isCustom ? 'custom' : ''}" onclick="toggleHabit('${h.key}')">
      <div class="hico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${h.ico || '<circle cx="12" cy="12" r="10"/>'}</svg></div>
      <div class="hlbl">${esc(h.label)}</div>
      ${delBtn}
    </div>`;
    }).join('')}
    <div class="habit-card habit-add" onclick="openCustomHabitModal()">
      <div class="hico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>
      <div class="hlbl">添加</div>
    </div>
  </div>`;
  }

  /* ===================== 弹窗：目标 ===================== */
  function openGoalModal(id) {
    const g = id ? state.goals.find(x => x.id === id) : null;
    const defaultCat = g ? g.category : 'life';
    openModal({
      title: g ? '编辑目标' : '新目标',
      body: `<div class="form-group"><label>目标名称</label><input class="inp" id="gtitle" value="${g ? esc(g.title) : ''}" placeholder="比如：减到55kg / 学完3个模块"></div>
    <div class="form-group"><label>分类</label>
      <div class="chip-group" id="gcats">${CATEGORIES.map(c => `<div class="chip ${c.cls || ''} ${g && g.category === c.id || (!g && c.id === defaultCat) ? 'active' : ''}" data-cat="${c.id}">${c.label}</div>`).join('')}</div>
    </div>
    <div class="form-group"><label>关键结果 KR（可选，每行一个）</label><textarea class="inp" id="gkr" placeholder="比如：&#10;每周运动≥3次&#10;21点后不吃东西">${g ? g.krs.map(k => k.title).join('\n') : ''}</textarea></div>
    <div class="form-group"><label>🎁 达成奖励</label><input class="inp" id="greward" value="${g && g.reward ? esc(g.reward) : ''}" placeholder="达到目标后奖励自己什么？（比如：买新裙子、去吃大餐、去旅行）"></div>`,
      foot: '<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveGoal(\'' + (g ? g.id : '') + '\')">保存</button>'
    });
    $('gcats').querySelectorAll('.chip').forEach(c => {
      c.onclick = () => {
        $('gcats').querySelectorAll('.chip').forEach(x => x.classList.remove('active')); c.classList.add('active');
      }
    });
  }

  function saveGoal(id) {
    const t = $('gtitle').value.trim(); if (!t) return toast('请输入名称');
    const cat = $('gcats').querySelector('.chip.active')?.dataset.cat || 'life';

    const data = {
      title: t, category: cat, type: 'task',
      target: 1, unit: '个任务',
      deadline: today(),
      reward: $('greward').value.trim() || '',
      krs: $('gkr').value.split('\n').map(s => s.trim()).filter(Boolean).map(s => ({ title: s, done: false }))
    };
    // 编辑时保留已有 KR 的 done 状态
    if (id) { const og = state.goals.find(x => x.id === id); if (og && og.krs) { data.krs = data.krs.map((k, i) => og.krs[i] ? { ...k, done: og.krs[i].done } : k) } }
    if (id) { const g = state.goals.find(x => x.id === id); Object.assign(g, data) }
    else state.goals.push({ id: uid(), ...data });
    save(); closeModal(); renderAll(); toast(id ? '已更新' : '已创建目标')
  }

  /* ===================== 弹窗：学习 ===================== */
  let editingStudyId = null;
  function openStudyModal(id) {
    editingStudyId = id || null;
    var record = id ? state.study.find(function (s) { return s.id === id }) : null;
    var sdate = record ? record.date : today();
    var sdur = record ? record.duration : 30;
    var scontent = record ? record.content : '';
    var sskill = record ? record.skill : '';
    const modules = state.studyModules || [];
    const chipHTML = modules.length
      ? modules.map(function (m, i) {
        var active = m === sskill || (!sskill && i === 0) ? 'active' : '';
        return '<div class="chip ' + active + '" data-mod="' + esc(m) + '">' + esc(m) + '<span class="chip-del" onclick="event.stopPropagation();delChipMod(\'' + esc(m) + '\')">&times;</span></div>';
      }).join('')
      : '<div class="chip-empty" style="font-size:12px;color:var(--ink-light);padding:8px 0">还没有模块，在下方添加第一个</div>';
    openModal({
      title: id ? '编辑学习记录' : '记学习',
      body: '<div class="form-group"><label>日期</label><input class="inp" type="date" id="sdate" value="' + sdate + '"></div>' +
        '<div class="form-group"><label>学习模块</label>' +
        '<div class="chip-group" id="studyModChips">' + chipHTML + '</div>' +
        '<div style="display:flex;gap:4px;margin-top:6px">' +
        '<input class="inp" id="snewmod" placeholder="添加新模块…" style="font-size:12px;flex:1">' +
        '<button class="btn ghost" style="padding:6px 12px;font-size:11px;white-space:nowrap" onclick="addStudyModule()">+ 添加</button>' +
        '</div>' +
        '</div>' +
        '<div class="form-group"><label>学习内容</label><input class="inp" id="scontent" placeholder="学了什么" value="' + esc(scontent) + '"></div>' +
        '<div class="form-group"><label>时长 <span style="font-weight:400;color:var(--ink-light)">(分钟)</span></label>' +
        '<div class="range-wrap"><input type="range" id="sdur" min="5" max="180" step="5" value="' + sdur + '"><span class="range-val" id="sdurVal">' + sdur + ' min</span></div>' +
        '</div>',
      foot: '<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveStudy()">保存</button>'
    });
    // 绑定芯片点击
    document.querySelectorAll('#studyModChips .chip').forEach(function (c) {
      c.onclick = function (e) {
        if (e.target.classList.contains('chip-del')) return;
        document.querySelectorAll('#studyModChips .chip').forEach(function (x) { x.classList.remove('active') });
        this.classList.add('active');
      };
    });
    // 绑定 range 显示
    var r = $('sdur'); if (r) {
      r.oninput = function () { $('sdurVal').textContent = this.value + ' min' };
      $('sdurVal').textContent = r.value + ' min';
    }
  }
  // 从记录弹窗中删除模块
  function delChipMod(name) {
    conf('删除模块「' + name + '」？（已有记录不受影响）', function () {
      state.studyModules = state.studyModules.filter(function (m) { return m !== name });
      save(); closeModal(); renderStudy(); toast('已删除');
    });
  }
  function addStudyModule() {
    var inp = $('snewmod'); if (!inp) return;
    var name = inp.value.trim();
    if (!name) return toast('请输入模块名');
    if (state.studyModules.includes(name)) return toast('该模块已存在');
    state.studyModules.push(name);
    save();
    // 在当前弹窗中增量添加
    var chips = $('studyModChips'); if (!chips) return;
    // 移除空模块提示
    var empty = chips.querySelector('.chip-empty'); if (empty) chips.innerHTML = '';
    var div = document.createElement('div'); div.className = 'chip active'; div.dataset.mod = name;
    div.innerHTML = esc(name) + '<span class="chip-del" onclick="event.stopPropagation();delChipMod(\'' + esc(name) + '\')">&times;</span>';
    chips.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('active') });
    div.onclick = function (e) { if (e.target.classList.contains('chip-del')) return; chips.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('active') }); div.classList.add('active') };
    chips.appendChild(div);
    inp.value = ''; toast('模块已添加');
  }
  function saveStudy() {
    var sel = document.querySelector('#studyModChips .chip.active');
    if (!sel) return toast('请先选择或添加学习模块');
    var skill = sel.dataset.mod;
    var sdate = $('sdate').value || today();
    var sdur = +($('sdur').value) || 0;
    var scontent = $('scontent').value.trim();
    if (editingStudyId) {
      var idx = state.study.findIndex(function (s) { return s.id === editingStudyId });
      if (idx >= 0) {
        state.study[idx].date = sdate; state.study[idx].skill = skill;
        state.study[idx].duration = sdur; state.study[idx].content = scontent;
      }
      editingStudyId = null;
    } else {
      state.study.push({ id: uid(), date: sdate, skill: skill, duration: sdur, content: scontent });
    }
    save(); closeModal(); renderStudy(); toast(editingStudyId ? '已更新' : '已记录');
    editingStudyId = null;
  }

  /* ==================== 页面设置 ==================== */

  function loadSettings() {
    try {
      const r = localStorage.getItem(SETTINGS_KEY);
      if (r) { appSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(r) }; }
      // 始终以白天模式启动
      appSettings.theme = 'light';
    } catch (e) { appSettings = DEFAULT_SETTINGS; }
    // 迁移旧数据：没有 accentColor 的补上预设色值
    if (!appSettings.accentColor) {
      var preset = SETTINGS_ACCENTS.find(function (a) { return a.id === appSettings.accent; });
      appSettings.accentColor = preset ? preset.c : DEFAULT_SETTINGS.accentColor;
      saveSettings();
    }
  }

  function applySettings() {
    const html = document.documentElement;
    html.setAttribute('data-theme', appSettings.theme);
    html.setAttribute('data-font', appSettings.fontSize);
    const mc = document.querySelector('meta[name="theme-color"]');
    if (mc) mc.setAttribute('content', appSettings.theme === 'dark' ? '#1E1E24' : '#FAF7F2');

    // 强调色：预设走 CSS 块，自定义走 JS 动态生成
    if (appSettings.accent === 'custom' && appSettings.accentColor) {
      html.removeAttribute('data-accent');
      var isDarkCustom = appSettings.theme === 'dark';
      var pal = generateAccentPalette(appSettings.accentColor);
      var el = html.style;
      el.setProperty('--acc', pal['--acc']);
      if (isDarkCustom) {
        // 夜间模式：生成暗色调色板
        var cc = hexToRgb(appSettings.accentColor);
        var chsl = rgbToHsl(cc.r, cc.g, cc.b);
        var h = chsl.h, s = chsl.s;
        var c500 = hslToRgb(h, Math.min(0.8, s*1.1), 0.45);
        var c400 = hslToRgb(h, Math.min(0.75, s), 0.38);
        var c300 = hslToRgb(h, Math.min(0.6, s*0.7), 0.28);
        var c200 = hslToRgb(h, Math.min(0.5, s*0.5), 0.20);
        var c100 = hslToRgb(h, Math.min(0.4, s*0.35), 0.14);
        var c50 = hslToRgb(h, Math.min(0.35, s*0.25), 0.10);
        el.setProperty('--g500', rgbToHex(c500.r, c500.g, c500.b));
        el.setProperty('--g400', rgbToHex(c400.r, c400.g, c400.b));
        el.setProperty('--g300', rgbToHex(c300.r, c300.g, c300.b));
        el.setProperty('--g200', rgbToHex(c200.r, c200.g, c200.b));
        el.setProperty('--g100', rgbToHex(c100.r, c100.g, c100.b));
        el.setProperty('--g50', rgbToHex(c50.r, c50.g, c50.b));
      } else {
        el.setProperty('--g500', pal['--g500']);
        el.setProperty('--g400', pal['--g400']);
        el.setProperty('--g300', pal['--g300']);
        el.setProperty('--g200', pal['--g200']);
        el.setProperty('--g100', pal['--g100']);
        el.setProperty('--g50', pal['--g50']);
      }
    } else {
      html.setAttribute('data-accent', appSettings.accent);
      // 清除 JS 动态设置的变量，回退到 CSS 预定义
      var vars = ['--acc', '--g50', '--g100', '--g200', '--g300', '--g400', '--g500'];
      vars.forEach(function (v) { html.style.removeProperty(v); });
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(appSettings));
    applySettings();
  }

  let SETTINGS_ACCENTS = []; // 从 data.json 加载
  let SETTINGS_FONTS = [];   // 从 data.json 加载
  function refreshSettingsUI() {
    var s = appSettings;
    var dots = document.querySelectorAll('.color-dot');
    dots.forEach(function (d) { d.classList.remove('active'); });
    if (s.accent === 'custom') {
      var customDot = document.getElementById('customColorDot');
      if (customDot) customDot.classList.add('active');
    } else {
      dots.forEach(function (d) {
        if (d.getAttribute('data-id') === s.accent) d.classList.add('active');
      });
    }
    var cp = document.getElementById('settingsColorPicker');
    if (cp) cp.value = s.accentColor;
    var hint = document.getElementById('settingsAccentHint');
    if (hint) {
      if (s.accent === 'custom') { hint.textContent = '当前：自定义 ' + s.accentColor; }
      else { var pa = SETTINGS_ACCENTS.find(function (a) { return a.id === s.accent; }); hint.textContent = '当前：' + (pa ? pa.label : s.accentColor); }
    }
  }

  function openSettings() {
    var s = appSettings;
    var isCustom = s.accent === 'custom';
    var curAcc = SETTINGS_ACCENTS.find(function (a) { return a.id === s.accent; }) || SETTINGS_ACCENTS[0];
    var hintText = isCustom ? ('自定义 ' + s.accentColor) : curAcc.label;

    // 构建个人资料摘要
    var profile = getUserProfile();
    var avatarHtml = getAvatarHtml(profile, 44);
    var genderLabel = { female: '女', male: '男', other: '其他' };
    var profileInfoRows = [
      { label: '手机号', value: profile.phone || '未设置' },
      { label: '邮箱', value: profile.email || '未设置' },
      { label: '性别', value: genderLabel[profile.gender] || '未设置' },
      { label: '生日', value: profile.birthday || '未设置' },
      { label: '身高', value: profile.height ? (profile.height + ' cm') : '未设置' }
    ];

    var profileSection = '' +
      '<div style="background:var(--g50);border-radius:12px;padding:14px;margin-bottom:16px;border:1.5px solid var(--line)">' +
        '<div class="settings-row" style="margin-bottom:0;padding:0">' +
          '<div style="display:flex;align-items:center;gap:12px">' +
            avatarHtml +
            '<div>' +
              '<div style="font-weight:600;font-size:15px;color:var(--text)">' + (profile.nickname || '用户') + '</div>' +
              '<div style="font-size:11px;color:var(--ink-light);margin-top:2px">个人信息</div>' +
            '</div>' +
          '</div>' +
          '<button class="btn ghost" onclick="closeModal();openProfileEditor()" style="padding:6px 14px;font-size:12px;border-radius:8px">编辑</button>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:10px;font-size:11px;color:var(--ink-light)">' +
          profileInfoRows.map(function(r) {
            return '<span><span style="color:var(--g300)">' + r.label + '：</span>' + r.value + '</span>';
          }).join('') +
        '</div>' +
      '</div>';

    openModal({
      title: '设置',
      body: profileSection +
        '<div style="font-size:12px;color:var(--g300);font-weight:600;margin-bottom:8px">页面偏好</div>' +
        '<div class="settings-grid">' +
        '<div class="settings-row">' +
        '<div><div class="label">夜间模式</div><div class="hint">深色背景，更适合夜间阅读</div></div>' +
        '<label class="toggle-sw"><input type="checkbox" id="setTheme" ' + (s.theme === 'dark' ? 'checked' : '') + ' onchange="updateSetting(\'theme\',this.checked?\'dark\':\'light\')"><span class="track"></span></label>' +
        '</div>' +
        '<div class="settings-row" style="align-items:flex-start">' +
        '<div><div class="label">强调色</div><div class="hint" id="settingsAccentHint">当前：' + hintText + '</div>' +
        '<div style="margin-top:12px;display:flex;align-items:center;gap:10px">' +
        '<div class="color-input-wrap">' +
        '<input type="color" id="settingsColorPicker" value="' + s.accentColor + '" oninput="onCustomColorPick(this.value)">' +
        '</div>' +
        '<span style="font-size:11px;color:var(--ink-light)">自定义</span>' +
        '</div>' +
        '</div>' +
        '<div class="color-dots" style="flex-wrap:wrap;justify-content:flex-end;max-width:140px">' +
        SETTINGS_ACCENTS.map(function (a) {
          return '<div class="color-dot' + (s.accent === a.id ? ' active' : '') + '" data-id="' + a.id + '" style="background:' + a.c + '" title="' + a.label + '" onclick="onPresetAccentClick(\'' + a.id + '\')"></div>';
        }).join('') +
        '<div class="color-dot' + (isCustom ? ' active' : '') + '" id="customColorDot" style="background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red)" title="自定义颜色" onclick="onPresetAccentClick(\'custom\')"></div>' +
        '</div>' +
        '</div>' +
        '<div class="settings-row">' +
        '<div><div class="label">字体大小</div><div class="hint">调整整体文字大小</div></div>' +
        '<div class="font-btns">' +
        SETTINGS_FONTS.map(function (f) {
          return '<div class="font-btn' + (s.fontSize === f.id ? ' active' : '') + '" onclick="onFontSizeClick(\'' + f.id + '\')">' + f.label + '</div>';
        }).join('') +
        '</div>' +
        '</div>' +
        '<div style="border-top:1px solid var(--line);padding-top:12px">' +
        '<button class="btn ghost" onclick="resetSettings()" style="width:100%;justify-content:center;color:var(--danger-soft)">恢复默认设置</button>' +
        '</div>' +
        '</div>',
      foot: '<button class="btn ghost" onclick="closeModal()">关闭</button>'
    });
  }

  function onPresetAccentClick(id) {
    if (id === 'custom') {
      // 切换到自定义模式，用当前 accentColor
      updateSetting('accent', 'custom');
    } else {
      var preset = SETTINGS_ACCENTS.find(function (a) { return a.id === id; });
      appSettings.accent = id;
      appSettings.accentColor = preset.c;
      saveSettings();
    }
    refreshSettingsUI();
  }
  function onCustomColorPick(hex) {
    appSettings.accent = 'custom';
    appSettings.accentColor = hex;
    saveSettings();
    refreshSettingsUI();
  }
  function onFontSizeClick(id) {
    updateSetting('fontSize', id);
    closeModal();
    setTimeout(openSettings, 50);
  }
  function updateSetting(key, val) {
    appSettings[key] = val;
    saveSettings();
  }
  function resetSettings() {
    conf('恢复默认设置（浅色 · 绿色 · 中号字体）？', () => {
      appSettings = { ...DEFAULT_SETTINGS };
      saveSettings();
      closeModal();
      toast('已恢复默认设置');
    });
  }

  /* ===================== 数据管理 ===================== */
  function openDataMgmt() {
    openModal({
      title: '数据管理',
      body: '<div style="display:flex;flex-direction:column;gap:10px">' +
        '<button class="btn ghost" onclick="closeModal();clearAll()" style="width:100%;justify-content:center;color:var(--danger-soft)">清空所有数据</button>' +
        '<div style="font-size:11px;color:var(--ink-light);text-align:center">数据通过云同步备份，清空前请确认云端已有最新数据</div>' +
        '</div>',
      foot: '<button class="btn ghost" onclick="closeModal()">关闭</button>'
    });
  }

  function clearAll() {
    conf('⚠ 清空所有数据（包括示例）。确定？', () => {
      conf('再次确认：全部清空？', () => { localStorage.removeItem(STORE_KEY); state = loadData(); renderAll(); toast('已清空') });
    });
  }

  /* ===================== 健康页渲染 ===================== */
  var healthSubTab = 'health';
  function switchHealthTab(tab) {
    healthSubTab = tab;
    var a = document.getElementById('hstabHealth'), b = document.getElementById('hstabTrain');
    var pa = document.getElementById('hpanelHealth'), pb = document.getElementById('hpanelTrain');
    if (tab === 'health') {
      a.classList.add('active'); b.classList.remove('active');
      pa.classList.add('active'); pb.classList.remove('active');
      renderHealthStats(); renderWeightRecords(); renderMeasureRecords(); renderChart();
    } else {
      b.classList.add('active'); a.classList.remove('active');
      pb.classList.add('active'); pa.classList.remove('active');
      trainWeekStart = getMonday(new Date());
      renderHabits('healthHabits'); renderTrainLogs('trainRecords');
    }
  }

  /* ===================== 训练计划（周视图） ===================== */
  var trainWeekStart;
  var EXERCISE_DB = {
    gym: [
      { t: '跑步机', n: 'time_incline' }, { t: '椭圆机', n: 'time' }, { t: '动感单车', n: 'time' },
      { t: '史密斯机深蹲', n: 'sets' }, { t: '杠铃硬拉', n: 'sets' }, { t: '杠铃卧推', n: 'sets' },
      { t: '哑铃弯举', n: 'sets' }, { t: '哑铃飞鸟', n: 'sets' }, { t: '坐姿划船', n: 'sets' },
      { t: '高位下拉', n: 'sets' }, { t: '腿举', n: 'sets' }, { t: '腿弯举', n: 'sets' },
      { t: '卷腹机', n: 'sets' }, { t: '龙门架夹胸', n: 'sets' }, { t: '臀桥', n: 'sets' },
      { t: '仰卧起坐', n: 'sets' }, { t: '平板支撑', n: 'time' }, { t: '战绳', n: 'time' },
      { t: '哈克深蹲', n: 'sets' }, { t: '坐姿推肩', n: 'sets' }, { t: '蝴蝶机夹胸', n: 'sets' },
      { t: '罗马尼亚硬拉', n: 'sets' }, { t: '引体向上', n: 'sets' }, { t: '双杠臂屈伸', n: 'sets' },
      { t: '绳索下压', n: 'sets' }
    ],
    home: [
      { t: '瑜伽', n: 'time' }, { t: '平板支撑', n: 'time' }, { t: '仰卧起坐', n: 'sets' },
      { t: '俯卧撑', n: 'sets' }, { t: '深蹲', n: 'sets' }, { t: '波比跳', n: 'sets' },
      { t: '开合跳', n: 'sets' }, { t: '高抬腿', n: 'sets' }, { t: '跳绳', n: 'time' },
      { t: '哑铃训练', n: 'sets' }, { t: '弹力带训练', n: 'sets' }, { t: '壶铃摇摆', n: 'sets' },
      { t: 'HIIT', n: 'time' }, { t: '普拉提', n: 'time' }, { t: '拉伸放松', n: 'time' },
      { t: '臀桥', n: 'sets' }, { t: '靠墙静蹲', n: 'time' }, { t: '卷腹', n: 'sets' },
      { t: '俄罗斯转体', n: 'sets' }, { t: '登山跑', n: 'time' }, { t: '弓步蹲', n: 'sets' },
      { t: '健身操', n: 'time' }
    ],
    outdoor: [
      { t: '跑步', n: 'time' }, { t: '快走', n: 'time' }, { t: '骑行', n: 'time' },
      { t: '爬山', n: 'time' }, { t: '跳绳', n: 'time' }, { t: '游泳', n: 'time' },
      { t: '篮球', n: 'time' }, { t: '羽毛球', n: 'time' }, { t: '网球', n: 'time' },
      { t: '足球', n: 'time' }, { t: '飞盘', n: 'time' }, { t: '户外瑜伽', n: 'time' },
      { t: '徒步', n: 'time' }, { t: '滑板', n: 'time' }, { t: '攀岩', n: 'time' },
      { t: '皮划艇', n: 'time' }, { t: '冲浪', n: 'time' }, { t: '轮滑', n: 'time' },
      { t: '慢跑', n: 'time' }, { t: '广场舞/街舞', n: 'time' }
    ]
  };
  function getMonday(d) { var day = d.getDay(), diff = d.getDate() - (day === 0 ? 6 : day - 1); var m = new Date(d); m.setDate(diff); m.setHours(0, 0, 0, 0); return m }

  // 从 localStorage 恢复自定义训练项目顺序
  (function () {
    ['gym', 'home', 'outdoor'].forEach(function (cat) {
      try {
        var saved = localStorage.getItem('wb_xm_workout_' + cat);
        if (!saved) return;
        var names = JSON.parse(saved);
        if (!Array.isArray(names) || !names.length) return;
        // 按保存的顺序重排 EXERCISE_DB
        var arr = EXERCISE_DB[cat];
        var oldMap = {}; arr.forEach(function (e) { oldMap[e.t] = e });
        var reordered = names.map(function (n) { return oldMap[n] }).filter(Boolean);
        // 保留新增的项（不在保存列表中的放末尾）
        arr.forEach(function (e) { if (reordered.indexOf(e) < 0) reordered.push(e) });
        EXERCISE_DB[cat] = reordered;
      } catch (ee) { }
    });
  })();
  function fmtWeekRange(mon) { var sun = new Date(mon); sun.setDate(mon.getDate() + 6); return (mon.getMonth() + 1) + '/' + mon.getDate() + ' - ' + (sun.getMonth() + 1) + '/' + sun.getDate() }
  function initTrainWeek() { if (!trainWeekStart || isNaN(trainWeekStart.getTime())) { trainWeekStart = getMonday(new Date()) } }
  function fmtTrainDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

  // 计算所有休息日（手动 + 姨妈期自动推算）
  function computeRestDays() {
    var set = {};
    state.restDays.forEach(function (d) { set[d] = 'rest' });
    if (isFemaleUser()) {
      state.periods.forEach(function (p) {
        var start = new Date(p.start);
        var dur = p.duration || 5;
        for (var i = 0; i < dur; i++) {
          var d = new Date(start); d.setDate(start.getDate() + i);
          set[fmtTrainDate(d)] = 'period';
        }
      });
    }
    return set;
  }

  // 切换手动休息日
  function toggleRestDay(dateStr) {
    var idx = state.restDays.indexOf(dateStr);
    if (idx === -1) { state.restDays.push(dateStr); toast('已设为休息日') }
    else { state.restDays.splice(idx, 1); toast('已取消休息日') }
    save(); renderTrainLogs('trainRecords');
  }

  // 记录姨妈期弹窗（仅女性可用）
  function openPeriodModal() {
    if (!isFemaleUser()) { toast('仅女性用户可使用经期记录'); return; }
    var listHtml = '';
    if (state.periods.length) {
      listHtml = '<div style="margin-bottom:12px;font-size:11px;color:var(--ink-soft)">历史记录：</div>';
      state.periods.forEach(function (p, idx) {
        var start = new Date(p.start);
        var dur = p.duration || 5;
        listHtml += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;padding:6px 8px;background:var(--p50);border-radius:6px;font-size:12px">' +
          '<span class="period-dot"></span>' +
          '<span style="flex:1;color:var(--p300);font-weight:500">' + (start.getMonth() + 1) + '月' + start.getDate() + '日 起 · 持续' + dur + '天</span>' +
          '<button onclick="delPeriod(' + idx + ')" style="background:none;border:none;color:var(--ink-light);cursor:pointer;font-size:14px;padding:2px 6px">&times;</button>' +
          '</div>';
      });
    }
    openModal({
      title: '记录姨妈期',
      body: listHtml +
        '<div class="form-group"><label>开始日期</label><input class="inp" type="date" id="periodStart" value="' + today() + '"></div>' +
        '<div class="form-group" style="margin-top:12px"><label>持续天数</label>' +
        '<select class="inp" id="periodDuration" style="width:100%">' +
        '<option value="3">3 天</option><option value="4">4 天</option><option value="5" selected>5 天</option>' +
        '<option value="6">6 天</option><option value="7">7 天</option><option value="8">8 天</option>' +
        '</select>' +
        '<div style="font-size:11px;color:var(--ink-light);margin-top:4px">期间自动标记为姨妈期休息日</div>' +
        '</div>',
      foot: '<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="savePeriod()">记录</button>'
    });
  }
  function savePeriod() {
    var d = $('periodStart').value;
    if (!d) return toast('请选择日期');
    var durEl = $('periodDuration');
    var dur = durEl ? parseInt(durEl.value) || 5 : 5;
    state.periods.push({ start: d, duration: dur });
    state.periods.sort(function (a, b) { return b.start.localeCompare(a.start) });
    save(); closeModal(); renderTrainLogs('trainRecords'); toast('已记录姨妈期');
  }
  function delPeriod(idx) {
    conf('删除这条姨妈期记录？', function () {
      state.periods.splice(idx, 1);
      save(); renderTrainLogs('trainRecords');
    });
  }

  function prevTrainWeek() { initTrainWeek(); var d = new Date(trainWeekStart); d.setDate(d.getDate() - 7); trainWeekStart = d; renderTrainLogs('trainRecords') }
  function nextTrainWeek() { initTrainWeek(); var d = new Date(trainWeekStart); d.setDate(d.getDate() + 7); trainWeekStart = d; renderTrainLogs('trainRecords') }
  function goThisTrainWeek() { trainWeekStart = getMonday(new Date()); renderTrainLogs('trainRecords') }

  function copyLastWeekTrain() {
    initTrainWeek();
    var lastMon = new Date(trainWeekStart); lastMon.setDate(lastMon.getDate() - 7);
    var total = 0;
    for (var i = 0; i < 7; i++) { var d = new Date(lastMon); d.setDate(d.getDate() + i); var ds = fmtTrainDate(d); state.trainLogs.filter(function (l) { return l.date === ds }).forEach(function (l) { state.trainLogs.push({ id: uid(), date: fmtTrainDate(new Date(trainWeekStart.getTime() + i * 864e5)), text: l.text, done: false }); total++ }) }
    if (!total) return toast('上周没有训练计划');
    conf('从上周复制 ' + total + ' 项训练到本周？', function () { save(); renderTrainLogs('trainRecords'); toast('已复制 ' + total + ' 项') });
  }

  function renderTrainLogs(containerId) {
    initTrainWeek();
    // 控制经期链接可见性
    var pl = document.getElementById('periodLink');
    if (pl) pl.style.display = isFemaleUser() ? '' : 'none';
    var todayStr = today();
    var isThisWeek = fmtTrainDate(getMonday(new Date())) === fmtTrainDate(trainWeekStart);
    var restMap = computeRestDays();

    // 导航栏：加入姨妈期提示（仅女性显示）
    var periodHint = '';
    if (isFemaleUser()) {
      state.periods.forEach(function (p) {
        var pStart = new Date(p.start); var dur = p.duration || 5;
        var pEnd = new Date(p.start); pEnd.setDate(pStart.getDate() + dur - 1);
        if (pEnd >= trainWeekStart && pStart < new Date(trainWeekStart.getTime() + 7 * 864e5)) {
          periodHint = '<span style="font-size:10px;color:var(--p300);white-space:nowrap">' + (pStart.getMonth() + 1) + '/' + pStart.getDate() + '起姨妈期 · ' + dur + '天</span>';
        }
      });
    }
    var navHtml = '<button onclick="prevTrainWeek()" title="上一周">&larr;</button>' +
      '<div class="week-label">' + fmtWeekRange(trainWeekStart) + (isThisWeek ? '（本周）' : '') + '</div>' +
      '<button onclick="nextTrainWeek()" title="下一周">&rarr;</button>' +
      (!isThisWeek ? '<div class="week-btn" onclick="goThisTrainWeek()">回本周</div>' : '') +
      '<div class="week-btn" onclick="copyLastWeekTrain()" style="background:var(--pu50);color:var(--pu300)">复制上周</div>';
    var tnv = document.getElementById('trainWeekNav'); if (tnv) tnv.innerHTML = navHtml;

    // 更新 header 日期
    var thd2 = document.getElementById('trainHdDate'); if (thd2) thd2.textContent = '· ' + fmtWeekRange(trainWeekStart) + (isThisWeek ? '（本周）' : '');

    // 姨妈期提示条
    if (periodHint) {
      var barHtml = '<div class="period-bar"><span class="period-dot"></span>' + periodHint + '</div>';
      tnv.insertAdjacentHTML('afterend', '<div id="periodBar">' + barHtml + '</div>');
    } else {
      var pb = document.getElementById('periodBar'); if (pb) pb.remove();
    }

    var wk = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    var html = '<div class="train-list">';

    for (var i = 0; i < 7; i++) {
      var dayDate = new Date(trainWeekStart); dayDate.setDate(trainWeekStart.getDate() + i);
      var dateStr = fmtTrainDate(dayDate);
      var isToday = dateStr === todayStr;
      var restType = restMap[dateStr]; // 'rest' | 'period' | undefined
      var items = state.trainLogs.filter(function (l) { return l.date === dateStr });
      var isRest = !!restType;

      // 日头样式
      var hdCls = 'train-list-day-hd';
      if (restType === 'period') hdCls += ' period';
      else if (restType === 'rest') hdCls += ' rest';
      else if (isToday) hdCls += ' today';

      html += '<div class="train-list-day">' +
        '<div class="' + hdCls + '">' +
        '<span class="train-list-day-label">' + wk[i] + '</span>' +
        '<span class="train-list-day-date">' + (dayDate.getMonth() + 1) + '月' + dayDate.getDate() + '日' + (isToday ? ' · 今天' : '') + '</span>' +
        '<div class="train-rest-toggle' + (isRest ? ' on' : '') + '" onclick="event.stopPropagation();toggleRestDay(\'' + dateStr + '\')">' + (isRest ? '取消休息' : '设休息') + '</div>' +
        '</div>';

      // 休息日徽章
      if (restType === 'period') {
        html += '<div class="train-rest-badge period"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>姨妈期休息日</div>';
      } else if (restType === 'rest') {
        html += '<div class="train-rest-badge rest"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>休息日</div>';
      }

      // 训练项（休息日也显示已有的训练，方便查看）
      if (!items.length) {
        html += isRest ? '<div class="train-list-empty" style="color:var(--ink-soft);font-style:italic">好好休息，恢复精力~</div>' : '<div class="train-list-empty">暂无训练安排</div>';
      } else {
        items.sort(function (a, b) { return (a.order || 0) - (b.order || 0) });
        items.forEach(function (l) {
          var meta = '';
          if (l.sets && l.reps) meta = '<span class="train-list-meta">' + l.sets + '组×' + l.reps + '次</span>';
          else if (l.duration) meta = '<span class="train-list-meta">' + l.duration + '分钟</span>';
          var catTag = l.cat ? '<span class="train-list-cat ' + l.cat + '">' + ({ 'gym': '健身房', 'home': '居家', 'outdoor': '户外' })[l.cat] + '</span>' : '';
          html += '<div class="train-list-item' + (l.done ? ' done' : '') + '" data-tid="' + l.id + '"' +
            ' draggable="true"' +
            ' onclick="event.stopPropagation();toggleTrain(\'' + l.id + '\')"' +
            ' ondragstart="event.stopPropagation();trDragStart(event,\'' + l.id + '\')"' +
            ' ondragend="trDragEnd(event,\'' + l.id + '\')"' +
            ' ondragover="trDragOver(event,\'' + l.id + '\')"' +
            ' ondrop="event.stopPropagation();trDrop(event,\'' + l.id + '\')"' +
            ' ontouchstart="trTouchStart(event,this,\'' + l.id + '\')"' +
            ' ontouchmove="trTouchMove(event)"' +
            ' ontouchend="trTouchEnd(event)">' +
            '<div class="train-list-dot' + (l.done ? ' done' : '') + '" onclick="event.stopPropagation();toggleTrain(\'' + l.id + '\')">' + (l.done ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg>' : '') + '</div>' +
            '<div class="train-handle" onclick="event.stopPropagation()" title="拖拽排序">' +
            '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><rect x="4" y="5" width="16" height="2" rx="1"/><rect x="4" y="11" width="16" height="2" rx="1"/><rect x="4" y="17" width="16" height="2" rx="1"/></svg>' +
            '</div>' +
            '<div class="train-list-text">' + esc(l.text) + '</div>' +
            meta + catTag +
            '<div class="train-list-del" onclick="event.stopPropagation();delTrain(\'' + l.id + '\')" title="删除">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</div>' +
            '</div>';
        });
      }
      html += '<div class="train-list-add" onclick="event.stopPropagation();quickTrainAdd(\'' + dateStr + '\')">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="12" height="12"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>添加训练' +
        '</div></div>';
    }
    html += '</div>';
    var target = document.getElementById(containerId);
    if (target) {
      target.innerHTML = html;
      // 自动滚动到今天在顶端
      var todayHd = target.querySelector('.train-list-day-hd.today');
      if (todayHd) {
        var list = target.querySelector('.train-list');
        if (list) {
          list.scrollTop = todayHd.parentElement.offsetTop - 4;
        }
      }
    }
  }

  /* ===================== 训练弹窗：分类+下拉+参数 ===================== */
  var _trainPrefillDate = '';
  function quickTrainAdd(dateStr) { _trainPrefillDate = dateStr; openTrainModal() }

  function openTrainModal(prefillDate) {
    if (prefillDate) _trainPrefillDate = prefillDate;
    var body = '<div class="form-group"><label>日期</label><input class="inp" type="date" id="trainDate" value="' + (_trainPrefillDate || today()) + '"></div>' +
      '<label style="font-size:11px;color:var(--ink-soft);margin-bottom:6px;display:block;font-weight:500">训练类型</label>' +
      '<div class="train-cat-tabs" id="trainCats">' +
      '<div class="train-cat-tab sel" data-cat="gym" onclick="switchTrainCat(this,\'gym\')"><span class="cat-icon">🏋</span>健身房</div>' +
      '<div class="train-cat-tab" data-cat="home" onclick="switchTrainCat(this,\'home\')"><span class="cat-icon">🏠</span>居家</div>' +
      '<div class="train-cat-tab" data-cat="outdoor" onclick="switchTrainCat(this,\'outdoor\')"><span class="cat-icon">🌳</span>户外</div>' +
      '</div>' +
      '<div class="form-group"><label>训练项目 <span style="font-size:10px;color:var(--ink-light);font-weight:400">（拖拽可排序）</span></label>' +
      '<div class="ex-dropdown" id="exDropdown">' +
      '<div class="ex-dropdown-btn" id="exBtn">' +
      '<span id="exBtnText">-- 选择训练项目 --</span>' +
      '<span class="ex-dropdown-arrow">&#9660;</span>' +
      '</div>' +
      '<div class="ex-dropdown-panel" id="exPanel"></div>' +
      '</div>' +
      '</div>' +
      '<div class="train-params" id="trainParams"></div>' +
      '<div class="form-group" style="margin-top:10px">' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:12px">' +
      '<input type="checkbox" id="trRepeat" style="width:18px;height:18px" onchange="toggleTrRepeat()"> 每周重复（一键规划本周）' +
      '</label>' +
      '<div id="trWeekdays" style="display:none;margin-top:6px" class="chip-group">' +
      '<div class="chip" data-dow="1">周一</div><div class="chip active" data-dow="2">周二</div>' +
      '<div class="chip active" data-dow="3">周三</div><div class="chip active" data-dow="4">周四</div>' +
      '<div class="chip active" data-dow="5">周五</div><div class="chip" data-dow="6">周六</div>' +
      '<div class="chip" data-dow="0">周日</div>' +
      '</div>' +
      '</div>';
    openModal({ title: '添加训练', body: body, foot: '<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveTrain()">添加</button>' });
    setTimeout(function () {
      switchTrainCat(document.querySelector('#trainCats .train-cat-tab.sel'), 'gym');
      // 点击弹窗其他地方关闭下拉
      document.getElementById('exBtn').addEventListener('click', function (e) { e.stopPropagation(); toggleExDropdown() });
      var wds = document.getElementById('trWeekdays'); if (!wds) return;
      wds.querySelectorAll('.chip').forEach(function (c) { c.onclick = function () { c.classList.toggle('active') } });
      var selDate = new Date(document.getElementById('trainDate').value);
      var selDow = selDate.getDay();
      wds.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active') });
      var target = wds.querySelector('.chip[data-dow="' + selDow + '"]');
      if (target) target.classList.add('active');
    }, 80);
  }

  var _selectedEx = null; // {cat, etype, need}
  var _exPanelOpen = false;

  function toggleExDropdown() {
    var panel = document.getElementById('exPanel');
    var btn = document.getElementById('exBtn');
    _exPanelOpen = !_exPanelOpen;
    if (_exPanelOpen) { panel.classList.add('show'); btn.classList.add('open') }
    else { panel.classList.remove('show'); btn.classList.remove('open') }
  }

  function closeExDropdown() {
    _exPanelOpen = false;
    var panel = document.getElementById('exPanel');
    var btn = document.getElementById('exBtn');
    if (panel) panel.classList.remove('show');
    if (btn) btn.classList.remove('open');
  }

  // 点击弹窗其他地方关闭下拉
  document.addEventListener('click', function (e) {
    if (_exPanelOpen && !e.target.closest('#exDropdown')) closeExDropdown();
  });

  function switchTrainCat(el, cat) {
    document.querySelectorAll('#trainCats .train-cat-tab').forEach(function (c) { c.classList.remove('sel') });
    el.classList.add('sel');
    _selectedEx = null;
    document.getElementById('exBtnText').textContent = '-- 选择训练项目 --';
    document.getElementById('trainParams').classList.remove('show');
    document.getElementById('trainParams').innerHTML = '';
    buildExPanel(cat);
  }

  function buildExPanel(cat) {
    var panel = document.getElementById('exPanel');
    var exercises = EXERCISE_DB[cat];
    var catName = { 'gym': '健身房', 'home': '居家', 'outdoor': '户外' }[cat];
    var html = '<div class="ex-panel-cat">' + catName + ' — ' + exercises.length + '项</div>';
    exercises.forEach(function (e, i) {
      html += '<div class="ex-panel-item" data-etype="' + esc(e.t) + '" data-need="' + e.n + '" data-idx="' + i + '"' +
        ' draggable="true"' +
        ' onclick="selectEx(this,\'' + cat + '\',\'' + esc(e.t) + '\',\'' + e.n + '\')"' +
        ' ondragstart="exDragStart(event,this)"' +
        ' ondragend="exDragEnd(event,this)"' +
        ' ondragover="exDragOver(event)"' +
        ' ondrop="exDrop(event,this,\'' + cat + '\')"' +
        ' ontouchstart="exTouchStart(event,this,\'' + cat + '\')"' +
        ' ontouchmove="exTouchMove(event)"' +
        ' ontouchend="exTouchEnd(event)">' +
        '<div class="ex-panel-handle" onclick="event.stopPropagation()" ontouchstart="event.stopPropagation()">' +
        '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><circle cx="7" cy="5" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="7" cy="19" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="15" cy="19" r="2"/></svg>' +
        '</div>' +
        '<span class="ex-panel-name">' + esc(e.t) + '</span>' +
        '</div>';
    });
    panel.innerHTML = html;
  }

  var _exDragSrc = null;
  function exDragStart(e, el) {
    _exDragSrc = el;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', el.dataset.idx);
  }
  function exDragEnd(e, el) { el.classList.remove('dragging'); _exDragSrc = null }
  function exDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }

  // === 触屏拖拽排序（训练项目下拉面板） ===
  var _exDragCat = null;
  var _exTouchTimer = null;
  function exTouchStart(e, el, cat) {
    if (e.touches.length !== 1) return;
    // 长按200ms才开始拖拽，避免和滚动冲突
    _exTouchTimer = setTimeout(function () {
      _exDragSrc = el; _exDragCat = cat;
      el.classList.add('dragging');
      // 震动反馈
      if (navigator.vibrate) navigator.vibrate(15);
    }, 200);
  }
  function exTouchMove(e) {
    if (!_exDragSrc) { clearTimeout(_exTouchTimer); return }
    e.preventDefault();
    var touch = e.touches[0];
    var panel = document.getElementById('exPanel');
    if (!panel) return;
    panel.querySelectorAll('.ex-panel-item').forEach(function (it) { it.classList.remove('drag-over') });
    var target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (target) {
      var item = target.closest('.ex-panel-item');
      if (item && item !== _exDragSrc) item.classList.add('drag-over');
    }
  }
  function exTouchEnd(e) {
    clearTimeout(_exTouchTimer);
    if (!_exDragSrc) { _exDragSrc = null; return }
    _exDragSrc.classList.remove('dragging');
    var touch = e.changedTouches[0];
    var panel = document.getElementById('exPanel');
    if (panel) panel.querySelectorAll('.ex-panel-item').forEach(function (it) { it.classList.remove('drag-over') });
    var target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (target) {
      var item = target.closest('.ex-panel-item');
      if (item && item !== _exDragSrc) {
        var items = Array.from(panel.querySelectorAll('.ex-panel-item'));
        var srcIdx = items.indexOf(_exDragSrc);
        var tgtIdx = items.indexOf(item);
        if (srcIdx >= 0 && tgtIdx >= 0) {
          var arr = EXERCISE_DB[_exDragCat];
          var moved = arr.splice(srcIdx, 1)[0];
          arr.splice(tgtIdx, 0, moved);
          try { localStorage.setItem('wb_xm_workout_' + _exDragCat, JSON.stringify(arr.map(function (x) { return x.t }))) } catch (ee) { }
          rebuildExPanelContent(_exDragCat);
          closeExDropdown(); openExDropdown();
        }
      }
    }
    _exDragSrc = null; _exDragCat = null;
  }
  function exDrop(e, target, cat) {
    e.preventDefault();
    if (!_exDragSrc || _exDragSrc === target) return;
    var panel = document.getElementById('exPanel');
    var items = Array.from(panel.querySelectorAll('.ex-panel-item'));
    var srcIdx = items.indexOf(_exDragSrc);
    var tgtIdx = items.indexOf(target);
    if (srcIdx < 0 || tgtIdx < 0) return;

    // 调整 EXERCISE_DB 数据顺序
    var arr = EXERCISE_DB[cat];
    var moved = arr.splice(srcIdx, 1)[0];
    arr.splice(tgtIdx, 0, moved);
    // 保存自定义顺序
    try { localStorage.setItem('wb_xm_workout_' + cat, JSON.stringify(arr.map(function (x) { return x.t }))) } catch (ee) { }

    // 重新渲染面板
    rebuildExPanelContent(cat);
    closeExDropdown(); openExDropdown();
  }

  function rebuildExPanelContent(cat) {
    var panel = document.getElementById('exPanel');
    var exercises = EXERCISE_DB[cat];
    var catName = { 'gym': '健身房', 'home': '居家', 'outdoor': '户外' }[cat];
    var html = '<div class="ex-panel-cat">' + catName + ' — ' + exercises.length + '项</div>';
    exercises.forEach(function (e, i) {
      var selCls = _selectedEx && _selectedEx.etype === e.t && _selectedEx.cat === cat ? ' sel' : '';
      html += '<div class="ex-panel-item' + selCls + '" data-etype="' + esc(e.t) + '" data-need="' + e.n + '" data-idx="' + i + '"' +
        ' draggable="true"' +
        ' onclick="selectEx(this,\'' + cat + '\',\'' + esc(e.t) + '\',\'' + e.n + '\')"' +
        ' ondragstart="exDragStart(event,this)"' +
        ' ondragend="exDragEnd(event,this)"' +
        ' ondragover="exDragOver(event)"' +
        ' ondrop="exDrop(event,this,\'' + cat + '\')"' +
        ' ontouchstart="exTouchStart(event,this,\'' + cat + '\')"' +
        ' ontouchmove="exTouchMove(event)"' +
        ' ontouchend="exTouchEnd(event)">' +
        '<div class="ex-panel-handle" onclick="event.stopPropagation()" ontouchstart="event.stopPropagation()">' +
        '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><circle cx="7" cy="5" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="7" cy="19" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="15" cy="19" r="2"/></svg>' +
        '</div>' +
        '<span class="ex-panel-name">' + esc(e.t) + '</span>' +
        '</div>';
    });
    panel.innerHTML = html;
  }

  function selectEx(el, cat, etype, need) {
    _selectedEx = { cat: cat, etype: etype, need: need };
    document.getElementById('exBtnText').textContent = etype;
    closeExDropdown();
    // 更新选中高亮
    var panel = document.getElementById('exPanel');
    panel.querySelectorAll('.ex-panel-item').forEach(function (c) { c.classList.remove('sel') });
    el.classList.add('sel');
    // 显示参数面板
    showTrainParams(need);
  }

  function showTrainParams(need) {
    var box = document.getElementById('trainParams');
    if (!need) { box.classList.remove('show'); box.innerHTML = ''; return }
    box.classList.add('show');
    if (need === 'sets') {
      box.innerHTML = '<div class="train-param-row">' +
        '<div class="form-group"><label>组数</label><input class="inp" type="number" id="trSets" value="4" min="1" max="20"></div>' +
        '<div class="form-group"><label>每组次数</label><input class="inp" type="number" id="trReps" value="12" min="1" max="100"></div>' +
        '</div><div class="train-param-hint">器械训练：填写组数 × 次数</div>';
    } else if (need === 'time') {
      box.innerHTML = '<div class="form-group"><label>时长（分钟）</label><input class="inp" type="number" id="trDur" value="30" min="1" max="300"></div>' +
        '<div class="train-param-hint">填写运动时长</div>';
    } else if (need === 'time_incline') {
      box.innerHTML = '<div class="train-param-row">' +
        '<div class="form-group"><label>时长（分钟）</label><input class="inp" type="number" id="trDur" value="30" min="1" max="300"></div>' +
        '<div class="form-group"><label>坡度（%）</label><input class="inp" type="number" id="trIncline" value="3" min="0" max="15"></div>' +
        '</div><div class="train-param-hint">跑步机：填写时长和坡度</div>';
    }
  }

  function openExDropdown() {
    var panel = document.getElementById('exPanel');
    var btn = document.getElementById('exBtn');
    _exPanelOpen = true; panel.classList.add('show'); btn.classList.add('open');
  }

  function toggleTrRepeat() {
    var wds = document.getElementById('trWeekdays');
    if (wds) wds.style.display = document.getElementById('trRepeat').checked ? 'flex' : 'none';
  }

  function saveTrain() {
    var d = document.getElementById('trainDate').value;
    if (!d) return toast('请选择日期');
    if (!_selectedEx) return toast('请选择训练项目');
    var etype = _selectedEx.etype;
    var cat = _selectedEx.cat;
    var need = _selectedEx.need;

    var sets = 0, reps = 0, duration = 0, incline = 0;
    var desc = '';
    if (need === 'sets') {
      sets = parseInt(document.getElementById('trSets').value) || 0;
      reps = parseInt(document.getElementById('trReps').value) || 0;
      if (!sets || !reps) return toast('请填写组数和次数');
      desc = etype + ' ' + sets + '组×' + reps + '次';
    } else if (need === 'time') {
      duration = parseInt(document.getElementById('trDur').value) || 0;
      if (!duration) return toast('请填写时长');
      desc = etype + ' ' + duration + '分钟';
    } else if (need === 'time_incline') {
      duration = parseInt(document.getElementById('trDur').value) || 0;
      incline = parseInt(document.getElementById('trIncline').value) || 0;
      if (!duration) return toast('请填写时长');
      desc = etype + ' ' + duration + '分钟 坡度' + incline + '%';
    }
    var order = nextTrainOrder(d);
    var item = { id: uid(), date: d, text: desc, done: false, cat: cat, etype: etype, order: order };
    if (sets) { item.sets = sets; item.reps = reps }
    if (duration) { item.duration = duration }
    if (incline !== undefined) { item.incline = incline }

    var repeat = document.getElementById('trRepeat').checked;
    if (repeat) {
      var activeDows = [];
      document.getElementById('trWeekdays').querySelectorAll('.chip.active').forEach(function (c) { activeDows.push(parseInt(c.dataset.dow)) });
      if (!activeDows.length) return toast('请至少选一个重复日');
      var selDate = new Date(d);
      var dow = selDate.getDay();
      var monOff = dow === 0 ? -6 : 1 - dow;
      var wMon = new Date(selDate); wMon.setDate(selDate.getDate() + monOff);
      var added = 0;
      activeDows.forEach(function (dw) {
        var tg = new Date(wMon);
        tg.setDate(wMon.getDate() + (dw === 0 ? 6 : dw - 1));
        var tDate = fmtTrainDate(tg);
        var exists = state.trainLogs.some(function (l) { return l.date === tDate && l.text === desc });
        if (!exists) { var it = { id: uid(), date: tDate, text: desc, done: false, cat: cat, etype: etype, order: nextTrainOrder(tDate) }; if (sets) { it.sets = sets; it.reps = reps } if (duration) { it.duration = duration } if (incline !== undefined) { it.incline = incline } state.trainLogs.push(it); added++ }
      });
      save(); closeModal();
      trainWeekStart = getMonday(new Date(d)); renderTrainLogs('trainRecords');
      toast('已为本周 ' + activeDows.length + ' 天创建训练（共 ' + added + ' 项）');
    } else {
      state.trainLogs.push(item);
      save(); closeModal();
      trainWeekStart = getMonday(new Date(d)); renderTrainLogs('trainRecords'); toast('已添加');
    }
  }

  function toggleTrain(id) {
    var t = state.trainLogs.find(function (x) { return x.id === id });
    if (t) { t.done = !t.done; save(); renderTrainLogs('trainRecords'); toast(t.done ? '完成 ✓' : '已撤销') }
  }

  function delTrain(id) {
    conf('删除这条训练记录？', function () {
      state.trainLogs = state.trainLogs.filter(function (t) { return t.id !== id });
      save(); renderTrainLogs('trainRecords');
    });
  }

  // 训练列表拖拽排序
  function nextTrainOrder(dateStr) {
    var same = state.trainLogs.filter(function (l) { return l.date === dateStr });
    return same.length;
  }
  function ensureTrainOrders() {
    // 给所有没有 order 的项补上
    var byDate = {};
    state.trainLogs.forEach(function (l) {
      if (!byDate[l.date]) byDate[l.date] = [];
      byDate[l.date].push(l);
    });
    var updated = false;
    for (var d in byDate) {
      var items = byDate[d];
      items.forEach(function (l, i) {
        if (l.order === undefined) { l.order = i; updated = true }
      });
    }
    if (updated) save();
  }

  var _trDragItem = null;
  function trDragStart(e, id) {
    _trDragItem = id;
    var el = document.querySelector('.train-list-item[data-tid="' + id + '"]');
    if (el) el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }
  function trDragEnd(e, id) {
    var el = document.querySelector('.train-list-item[data-tid="' + id + '"]');
    if (el) el.classList.remove('dragging');
    _trDragItem = null;
    // 清除所有拖拽视觉
    document.querySelectorAll('.train-list-item.drag-over-top,.train-list-item.drag-over-bot').forEach(function (c) {
      c.classList.remove('drag-over-top', 'drag-over-bot');
    });
  }
  function trDragOver(e, id) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!_trDragItem || _trDragItem === id) return;
    var el = document.querySelector('.train-list-item[data-tid="' + id + '"]');
    if (!el) return;
    // 清除旧高亮
    document.querySelectorAll('.train-list-item.drag-over-top,.train-list-item.drag-over-bot').forEach(function (c) {
      if (c !== el) { c.classList.remove('drag-over-top', 'drag-over-bot') }
    });
    // 判断光标在上半还是下半
    var rect = el.getBoundingClientRect();
    var mid = rect.top + rect.height / 2;
    if (e.clientY < mid) {
      el.classList.add('drag-over-top'); el.classList.remove('drag-over-bot');
    } else {
      el.classList.add('drag-over-bot'); el.classList.remove('drag-over-top');
    }
  }
  function trDrop(e, targetId) {
    e.preventDefault();
    document.querySelectorAll('.train-list-item.drag-over-top,.train-list-item.drag-over-bot').forEach(function (c) {
      c.classList.remove('drag-over-top', 'drag-over-bot');
    });
    if (!_trDragItem || _trDragItem === targetId) return;

    var src = state.trainLogs.find(function (l) { return l.id === _trDragItem });
    var tgt = state.trainLogs.find(function (l) { return l.id === targetId });
    if (!src || !tgt || src.date !== tgt.date) return; // 只能同一天内拖拽

    // 找到同一天的所有项
    var same = state.trainLogs.filter(function (l) { return l.date === src.date }).sort(function (a, b) { return (a.order || 0) - (b.order || 0) });
    var srcIdx = same.findIndex(function (l) { return l.id === src.id });
    var tgtIdx = same.findIndex(function (l) { return l.id === tgt.id });
    if (srcIdx < 0 || tgtIdx < 0) return;

    // 判断插入位置
    var el = document.querySelector('.train-list-item[data-tid="' + targetId + '"]');
    var rect = el.getBoundingClientRect();
    var mid = rect.top + rect.height / 2;
    var insertAfter = e.clientY >= mid;

    // 从数组中移除src
    same.splice(srcIdx, 1);
    // 重新计算target idx
    tgtIdx = same.findIndex(function (l) { return l.id === tgt.id });

    var newIdx = insertAfter ? tgtIdx + 1 : tgtIdx;
    same.splice(newIdx, 0, src);

    // 更新所有order
    same.forEach(function (l, i) { l.order = i });
    save(); renderTrainLogs('trainRecords');
  }

  // === 触屏拖拽排序（训练列表） ===
  var _trTouchItem = null;
  var _trTouchTarget = null;
  var _trTouchTimer = null;
  function trTouchStart(e, el, id) {
    if (e.touches.length !== 1) return;
    _trTouchTimer = setTimeout(function () {
      _trTouchItem = id;
      el.classList.add('dragging');
      if (navigator.vibrate) navigator.vibrate(15);
    }, 250);
  }
  function trTouchMove(e) {
    if (!_trTouchItem) { clearTimeout(_trTouchTimer); return }
    e.preventDefault();
    var touch = e.touches[0];
    document.querySelectorAll('.train-list-item.drag-over-top,.train-list-item.drag-over-bot').forEach(function (c) {
      c.classList.remove('drag-over-top', 'drag-over-bot');
    });
    var target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (target) {
      var item = target.closest('.train-list-item');
      if (item && item.dataset.tid !== _trTouchItem) {
        _trTouchTarget = item.dataset.tid;
        var rect = item.getBoundingClientRect();
        var mid = rect.top + rect.height / 2;
        if (touch.clientY < mid) {
          item.classList.add('drag-over-top'); item.classList.remove('drag-over-bot');
        } else {
          item.classList.add('drag-over-bot'); item.classList.remove('drag-over-top');
        }
      }
    }
  }
  function trTouchEnd(e) {
    clearTimeout(_trTouchTimer);
    if (!_trTouchItem) { _trTouchItem = null; return }
    var srcId = _trTouchItem; var tgtId = _trTouchTarget;
    document.querySelectorAll('.train-list-item.dragging,.train-list-item.drag-over-top,.train-list-item.drag-over-bot').forEach(function (c) {
      c.classList.remove('dragging', 'drag-over-top', 'drag-over-bot');
    });
    if (!tgtId || srcId === tgtId) { _trTouchItem = null; _trTouchTarget = null; return }

    var src = state.trainLogs.find(function (l) { return l.id === srcId });
    var tgt = state.trainLogs.find(function (l) { return l.id === tgtId });
    if (!src || !tgt || src.date !== tgt.date) { _trTouchItem = null; _trTouchTarget = null; return }

    var same = state.trainLogs.filter(function (l) { return l.date === src.date }).sort(function (a, b) { return (a.order || 0) - (b.order || 0) });
    var srcIdx = same.findIndex(function (l) { return l.id === srcId });
    var tgtIdx = same.findIndex(function (l) { return l.id === tgtId });
    if (srcIdx < 0 || tgtIdx < 0) { _trTouchItem = null; _trTouchTarget = null; return }

    same.splice(srcIdx, 1);
    tgtIdx = same.findIndex(function (l) { return l.id === tgtId });
    var el = document.querySelector('.train-list-item[data-tid="' + tgtId + '"]');
    var rect = el.getBoundingClientRect();
    var mid = rect.top + rect.height / 2;
    var insertAfter = e.changedTouches[0].clientY >= mid;
    var newIdx = insertAfter ? tgtIdx + 1 : tgtIdx;
    same.splice(newIdx, 0, src);
    same.forEach(function (l, i) { l.order = i });
    save(); renderTrainLogs('trainRecords');
    _trTouchItem = null; _trTouchTarget = null;
  }

  /* ===================== 渲染全体 ===================== */
  function renderAll() {
    renderHead(); renderBkHint(); renderSoulQuote();
    // 初始化日历月份
    if (!calYear) { const now = new Date(); calYear = now.getFullYear(); calMonth = now.getMonth() + 1; }
    if (curPage === 'today') { renderToday(); renderCalendar() }
    else if (curPage === 'health') {
      if (healthSubTab === 'health') { renderHealthStats(); renderWeightRecords(); renderMeasureRecords(); renderChart() }
      else { renderHabits('healthHabits'); renderTrainLogs('trainRecords') }
    }
    else if (curPage === 'goal') { renderGoals() }
    else if (curPage === 'study') { renderStudy() }
  }



  // ============ 异步加载 data.json 并初始化应用 ============
  (async function initApp() {
    var step = '';
    try {
      // 使用 ?v 参数破坏 Service Worker 缓存
      step = 'fetch data.json';
      var fetchUrl = 'data.json?v=' + Date.now();
      var resp = await fetch(fetchUrl);
      if (!resp.ok) throw new Error('HTTP ' + resp.status + ' (URL: ' + fetchUrl + ')');
      step = 'parse JSON';
      var appData = await resp.json();
      var _td = today();
      var _yd = yday();

      step = 'resolvePlaceholders';
      resolvePlaceholders(appData, _td, _yd);

      step = 'init globals';
      defData = appData.defaultData;
      DEFAULT_SETTINGS = appData.defaultSettings || {};
      MOODS = appData.moods || [];
      WEATHER_CODES = appData.weatherCodes || [];
      SETTINGS_ACCENTS = appData.accentPresets || [];
      SETTINGS_FONTS = appData.fontSizes || [];
      HABITS = appData.habits || [];
      CATEGORIES = appData.categories || [];
      appSettings = DEFAULT_SETTINGS;

      step = 'loadData';
      state = loadData();
      step = 'loadSettings';
      loadSettings();
      step = 'applySettings';
      if (document.documentElement) applySettings();
      else console.warn('[App] document.documentElement 不可用，跳过 applySettings');
      todoViewDate = today();

      step = 'ensure fields';
      if (!state.trainLogs) state.trainLogs = [];
      ensureTrainOrders();
      if (!state.restDays) state.restDays = [];
      if (!state.periods) state.periods = [];
      if (!state.workTasks) state.workTasks = [];
      if (!state.events) state.events = [];
      if (!state.customHabits) state.customHabits = [];
      if (!state.studyModules) state.studyModules = [];
      if (!state.holidays) state.holidays = [];
      if (!state.healthTarget) state.healthTarget = null;

      step = 'renderAll';
      renderAll();
      setTimeout(function () { fetchWeather(); }, 500);

      console.log('[App] ✅ 初始化完成');
    } catch (e) {
      console.error('[App] ❌ 初始化失败 (step=' + step + '):', e);
      document.body.innerHTML = '<div style="padding:40px;text-align:center;font-family:system-ui"><h2>⚠ 应用加载失败</h2><p>步骤: ' + step + '</p><p style="color:#c0392b;font-size:14px;margin:12px 0">' + e.message + '</p><p style="color:#888;font-size:12px;margin-top:20px">请尝试 <a href="javascript:location.reload(true)" style="color:#7AAA67">强制刷新</a> 或清除浏览器缓存后重试</p></div>';
    }
  })();

  // 防止弹窗内回车提交
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.closest('.modal') && e.target.tagName !== 'TEXTAREA') e.preventDefault();
  });
  // 刷新后滚动到顶部，避免缓存页面滚动位置
  window.addEventListener('pageshow', function() { setTimeout(function() { window.scrollTo(0, 0); }, 50); });

  /* ===================== 个人资料编辑 ===================== */
  // 头像完整数据（含背景色，与 auth.html 一致）
  var AVATAR_FULL = [
    { emoji:'🌸', bg:'#FFE4E1' }, { emoji:'🌿', bg:'#E8F5E9' },
    { emoji:'☀️', bg:'#FFF8E1' }, { emoji:'🌙', bg:'#E3F2FD' },
    { emoji:'⭐', bg:'#FFF3E0' }, { emoji:'🦋', bg:'#E0F7FA' },
    { emoji:'🐱', bg:'#FCE4EC' }, { emoji:'🌈', bg:'#F3E5F5' },
    { emoji:'🍀', bg:'#C8E6C9' }, { emoji:'💜', bg:'#EDE7F6' },
    { emoji:'🌊', bg:'#BBDEFB' }, { emoji:'🔥', bg:'#FFEBEE' },
    { emoji:'🌻', bg:'#FFF9C4' }, { emoji:'🐼', bg:'#EFEBE9' },
    { emoji:'🍓', bg:'#F8BBD0' }, { emoji:'🎀', bg:'#F48FB1' },
    { emoji:'💎', bg:'#B3E5FC' }, { emoji:'🌹', bg:'#FFCDD2' },
    { emoji:'🦊', bg:'#FFE0B2' }, { emoji:'🐰', bg:'#F5F5F5' }
  ];

  function openProfileEditor() {
    var profile = getUserProfile();
    var overlay = document.getElementById('profileOverlay');
    if (!overlay) return;

    // 构建头像选择器
    var ai = profile.avatar_idx !== undefined ? profile.avatar_idx : 0;
    var html = '';
    AVATAR_FULL.forEach(function(a, i) {
      var sel = i === ai ? ' selected' : '';
      html += '<div class="avatar-option' + sel + '" data-idx="' + i +
        '" style="background:' + a.bg + '" onclick="selectProfileAvatar(this, ' + i + ')" title="头像' + (i+1) + '">' +
        a.emoji + '</div>';
    });
    var picker = document.getElementById('profileAvatarPicker');
    if (picker) picker.innerHTML = html;

    // 填入当前值
    var setVal = function(id, val) { var el = document.getElementById(id); if (el && val !== null && val !== undefined) el.value = val; };
    setVal('profileAvatarIdx', ai);
    setVal('profileNickname', profile.nickname || '');
    setVal('profileGender', profile.gender || '');
    setVal('profilePhone', profile.phone || '');
    setVal('profileEmail', profile.email || '');
    setVal('profileBirthday', profile.birthday || '');
    setVal('profileHeight', profile.height || '');

    var errEl = document.getElementById('profileError');
    if (errEl) errEl.textContent = '';

    // 初始化自定义头像
    pendingAvatarUrl = null;
    var avatarUrl = profile.avatar_url || '';
    var urlInput = document.getElementById('profileAvatarUrl');
    if (urlInput) urlInput.value = avatarUrl;
    var clearBtn = document.getElementById('profileAvatarClearBtn');
    if (clearBtn) clearBtn.style.display = avatarUrl ? '' : 'none';

    overlay.style.display = 'flex';
    updateAvatarPreview();
  }

  function selectProfileAvatar(el, idx) {
    document.querySelectorAll('#profileAvatarPicker .avatar-option').forEach(function(o) { o.classList.remove('selected'); });
    el.classList.add('selected');
    document.getElementById('profileAvatarIdx').value = idx;
    // 选择 emoji 头像时清除自定义上传
    pendingAvatarUrl = null;
    document.getElementById('profileAvatarUrl').value = '';
    var clearBtn = document.getElementById('profileAvatarClearBtn');
    if (clearBtn) clearBtn.style.display = 'none';
    updateAvatarPreview();
  }

  function closeProfileEditor() {
    var overlay = document.getElementById('profileOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  // 点击遮罩关闭
  (function() {
    var overlay = document.getElementById('profileOverlay');
    if (overlay) overlay.addEventListener('click', function(e) { if (e.target === e.currentTarget) closeProfileEditor(); });
  })();

  function saveProfileChanges() {
    var errEl = document.getElementById('profileError');
    var val = function(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };

    var avatarIdx = parseInt(document.getElementById('profileAvatarIdx').value) || 0;
    var avatarUrl = document.getElementById('profileAvatarUrl').value.trim() || oldProfile.avatar_url || '';
    var nickname = val('profileNickname');
    var gender = val('profileGender');
    var phone = val('profilePhone').replace(/\D/g, '');
    var email = val('profileEmail');
    var birthday = val('profileBirthday');
    var heightStr = val('profileHeight');
    var height = heightStr ? parseFloat(heightStr) : null;

    if (!nickname) { if (errEl) errEl.textContent = '请输入昵称'; return; }
    if (nickname.length > 16) { if (errEl) errEl.textContent = '昵称最多16个字符'; return; }

    var oldProfile = getUserProfile();
    var newProfile = {
      nickname: nickname,
      avatar_idx: avatarIdx,
      avatar_url: avatarUrl,
      avatar_emoji: AVATAR_FULL[avatarIdx].emoji,
      avatar_bg: AVATAR_FULL[avatarIdx].bg,
      gender: gender,
      phone: phone || oldProfile.phone || '',
      email: email || oldProfile.email || '',
      birthday: birthday || oldProfile.birthday || null,
      height: height !== null ? height : (oldProfile.height || null),
      session_key: oldProfile.session_key || '',
      created_at: oldProfile.created_at || '',
      updated_at: new Date().toISOString()
    };

    // 更新本地
    var authData = localStorage.getItem('wb_auth_data');
    if (authData) {
      try {
        var parsed = JSON.parse(authData);
        parsed.profile = newProfile;
        parsed.last_active = Date.now();
        localStorage.setItem('wb_auth_data', JSON.stringify(parsed));
      } catch(e) {}
    }

    // 更新全局
    window.__profile = newProfile;

    // 异步上传到云端 profile store
    var userId = getUserId();
    if (userId && syncConfig) {
      sbFetch(syncConfig, 'POST', 'sync_store', {
        group_key: 'profile_' + userId,
        store: 'wb_user_profile',
        data: newProfile,
        updated_at: new Date().toISOString()
      }, 'Prefer: resolution=merge-duplicates').then(function() {
        // 如果手机号变了，更新 phone lookup
        if (phone && phone !== oldProfile.phone) {
          return sbFetch(syncConfig, 'POST', 'sync_store', {
            group_key: 'profile_by_phone_' + phone,
            store: 'wb_profile_lookup',
            data: {
              user_id: userId,
              email: email || oldProfile.email,
              session_key: newProfile.session_key,
              password_hash: oldProfile.password_hash || ''
            },
            updated_at: new Date().toISOString()
          });
        }
      }).catch(function(e) {
        console.log('云端 profile 更新失败:', e.message);
      });
    }

    // 刷新 UI
    renderHead();
    closeProfileEditor();
    toast('个人资料已更新 ✅');
  }

  // ============ 自定义头像上传 ============
  var pendingAvatarUrl = null;

  function handleAvatarUpload(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('图片不能超过 2MB'); input.value = ''; return; }
    if (!file.type.match(/^image\/(jpeg|png|webp|gif)$/)) { toast('仅支持 JPG/PNG/WebP/GIF'); input.value = ''; return; }

    var reader = new FileReader();
    reader.onload = function(e) {
      pendingAvatarUrl = e.target.result;
      // 更新预览
      updateAvatarPreview();
      // 取消 emoji 选中
      document.querySelectorAll('#profileAvatarPicker .avatar-option').forEach(function(o) { o.classList.remove('selected'); });
      document.getElementById('profileAvatarUrl').value = pendingAvatarUrl;
      // 显示/隐藏清除按钮
      var clearBtn = document.getElementById('profileAvatarClearBtn');
      if (clearBtn) clearBtn.style.display = '';
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  function clearCustomAvatar() {
    pendingAvatarUrl = null;
    document.getElementById('profileAvatarUrl').value = '';
    updateAvatarPreview();
    var clearBtn = document.getElementById('profileAvatarClearBtn');
    if (clearBtn) clearBtn.style.display = 'none';
    // 恢复 emoji 选中
    var ai = parseInt(document.getElementById('profileAvatarIdx').value) || 0;
    var opts = document.querySelectorAll('#profileAvatarPicker .avatar-option');
    opts.forEach(function(o, i) { o.classList.toggle('selected', i === ai); });
  }

  function updateAvatarPreview() {
    var preview = document.getElementById('profileAvatarPreview');
    if (!preview) return;
    var url = pendingAvatarUrl || document.getElementById('profileAvatarUrl').value;
    if (url) {
      preview.innerHTML = '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover" alt="头像预览">';
    } else {
      var profile = getUserProfile();
      var ai = parseInt(document.getElementById('profileAvatarIdx').value) || profile.avatar_idx || 0;
      if (ai >= 0 && ai < AVATAR_FULL.length) {
        var a = AVATAR_FULL[ai];
        preview.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:' + a.bg + ';font-size:28px">' + a.emoji + '</span>';
      }
    }
  }