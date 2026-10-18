// TikTok Live Overlay Lite — proses utama (Electron, ESM)
//
// Prinsip hemat resource:
//  - Library TikTok baru dimuat saat tombol "Hubungkan" ditekan (startup cepat di HDD).
//  - Semua event dikumpulkan lalu dikirim ke jendela dalam 1 paket tiap ~350 ms.
//  - Event "bergabung" & "like" digabung (tidak 1 event = 1 update layar).
//  - Tanpa gambar/avatar, tanpa animasi, tanpa web font.
//  - GPU dimatikan secara default (komposisi pakai CPU, tapi UI sangat ringan).

import { app, BrowserWindow, ipcMain, globalShortcut, screen, Menu, net } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_FLAG = process.argv.includes('--demo');

/* ------------------------------------------------------------------ */
/*  Pengaturan (file JSON kecil di folder data aplikasi)               */
/* ------------------------------------------------------------------ */

const DEFAULTS = {
  username: '',
  apiKey: '',
  bounds: { width: 380, height: 520 },
  bgAlpha: 0.75,
  fontSize: 13,
  maxLines: 35,
  alwaysOnTop: true,
  clickThrough: false,
  showJoin: true,
  autoReconnect: true,
  hardwareAcceleration: false,
  lowPriority: true,
  // Suara komentar (TTS)
  ttsEnabled: false,
  ttsEngine: 'google', // 'google' (pilih bahasa, butuh internet) | 'system' (suara Windows, offline)
  ttsLang: 'id',
  ttsVoice: '', // nama suara Windows; kosong = otomatis mengikuti bahasa
  ttsVolume: 1,
  ttsRate: 1,
  ttsReadName: false,
  ttsMaxQueue: 5,
  ttsMaxChars: 100,
  ttsBlock: '', // kata yang tidak dibacakan, dipisah koma
};

const num = (v, lo, hi) => {
  v = Number(v);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null;
};
const bool = (v) => (typeof v === 'boolean' ? v : null);
const int = (lo, hi) => (v) => { const n = num(v, lo, hi); return n === null ? null : Math.round(n); };
const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/; // kode bahasa seperti id, ms, en, zh-CN

// Setiap nilai dari jendela divalidasi dulu sebelum disimpan.
const RULES = {
  username: (v) => (typeof v === 'string' ? v.slice(0, 60) : null),
  apiKey: (v) => (typeof v === 'string' ? v.trim().slice(0, 200) : null),
  bgAlpha: (v) => num(v, 0.15, 1),
  fontSize: (v) => { const n = num(v, 10, 22); return n === null ? null : Math.round(n); },
  maxLines: (v) => { const n = num(v, 10, 80); return n === null ? null : Math.round(n); },
  alwaysOnTop: bool,
  clickThrough: bool,
  showJoin: bool,
  autoReconnect: bool,
  hardwareAcceleration: bool,
  lowPriority: bool,
  ttsEnabled: bool,
  ttsEngine: (v) => (v === 'google' || v === 'system' ? v : null),
  ttsLang: (v) => (typeof v === 'string' && LANG_RE.test(v) ? v : null),
  ttsVoice: (v) => (typeof v === 'string' ? v.slice(0, 120) : null),
  ttsVolume: (v) => num(v, 0, 1),
  ttsRate: (v) => num(v, 0.5, 2),
  ttsReadName: bool,
  ttsMaxQueue: int(1, 20),
  ttsMaxChars: int(30, 160),
  ttsBlock: (v) => (typeof v === 'string' ? v.slice(0, 300) : null),
};

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    // clickThrough sengaja selalu mati saat aplikasi dibuka, supaya overlay tidak terlihat "macet".
    return { ...DEFAULTS, ...raw, clickThrough: false, bounds: { ...DEFAULTS.bounds, ...(raw.bounds || {}) } };
  } catch {
    return { ...DEFAULTS, bounds: { ...DEFAULTS.bounds } };
  }
}

let settings = loadSettings();
let saveTimer = null;

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings));
  } catch { /* disk penuh / terkunci: abaikan */ }
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}

/* ------------------------------------------------------------------ */
/*  Switch Chromium untuk laptop spek rendah (harus sebelum ready)     */
/* ------------------------------------------------------------------ */

if (!settings.hardwareAcceleration) app.disableHardwareAcceleration();
app.commandLine.appendSwitch('in-process-gpu'); // gabungkan proses GPU ke proses utama: 1 proses lebih sedikit

app.commandLine.appendSwitch(
  'disable-features',
  'CalculateNativeWinOcclusion,MediaRouter,Translate,OptimizationHints,AutofillServerCommunication'
);
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128');
app.commandLine.appendSwitch('num-raster-threads', '1');
app.commandLine.appendSwitch('enable-low-end-device-mode');

// Library TikTok tidak resmi: jangan sampai error kecil memunculkan dialog crash.
process.on('uncaughtException', (e) => console.error('[uncaught]', e));
process.on('unhandledRejection', (e) => console.error('[unhandled]', e));

function applyPriority() {
  try {
    os.setPriority(0, settings.lowPriority ? os.constants.priority.PRIORITY_BELOW_NORMAL : os.constants.priority.PRIORITY_NORMAL);
  } catch { /* tidak masalah */ }
}
applyPriority(); // proses anak (jendela) mewarisi prioritas ini

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/* ------------------------------------------------------------------ */
/*  Jendela overlay                                                    */
/* ------------------------------------------------------------------ */

const PRESETS = { small: [300, 380], medium: [380, 520], large: [460, 680] };
let win = null;
let boundsTimer = null;

function toWin(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function initialBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const b = settings.bounds || {};
  const width = Math.round(num(b.width, 260, wa.width) ?? 380);
  const height = Math.round(num(b.height, 200, wa.height) ?? 520);
  let x = Number(b.x);
  let y = Number(b.y);
  const ok = Number.isFinite(x) && Number.isFinite(y) && (() => {
    const a = screen.getDisplayMatching({ x, y, width, height }).workArea;
    return x + width > a.x + 80 && x < a.x + a.width - 80 && y >= a.y - 10 && y < a.y + a.height - 40;
  })();
  if (!ok) {
    x = wa.x + wa.width - width - 16;
    y = wa.y + 40;
  }
  return { x: Math.round(x), y: Math.round(y), width, height };
}

function createWindow() {
  win = new BrowserWindow({
    ...initialBounds(),
    minWidth: 260,
    minHeight: 200,
    frame: false,
    transparent: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    alwaysOnTop: settings.alwaysOnTop,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    title: 'TikTok Live Overlay Lite',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged,
      webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required', // suara TTS boleh diputar tanpa klik
    },
  });

  if (settings.alwaysOnTop) win.setAlwaysOnTop(true, 'screen-saver');
  if (settings.clickThrough) win.setIgnoreMouseEvents(true);

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.once('ready-to-show', () => win && win.show());
  win.loadFile(path.join(__dirname, 'index.html'));

  const rememberBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (win && !win.isDestroyed() && !win.isMinimized()) {
        settings.bounds = win.getBounds();
        scheduleSave();
      }
    }, 700);
  };
  win.on('resize', rememberBounds);
  win.on('move', rememberBounds);
  win.on('closed', () => { win = null; });
}

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p || !win) return;
  const cur = win.getBounds();
  const wa = screen.getDisplayMatching(cur).workArea;
  const width = Math.min(p[0], wa.width);
  const height = Math.min(p[1], wa.height);
  const x = Math.min(Math.max(cur.x, wa.x), wa.x + wa.width - width);
  const y = Math.min(Math.max(cur.y, wa.y), wa.y + wa.height - height);
  win.setBounds({ x, y, width, height });
}

function setClickThrough(on) {
  settings.clickThrough = !!on;
  if (win) win.setIgnoreMouseEvents(settings.clickThrough);
  toWin('state', { clickThrough: settings.clickThrough });
  scheduleSave();
}

function applyPatch(patch) {
  if (!patch || typeof patch !== 'object') return;
  const changed = [];
  for (const [key, rule] of Object.entries(RULES)) {
    if (!(key in patch)) continue;
    const v = rule(patch[key]);
    if (v === null || v === undefined) continue;
    if (settings[key] !== v) {
      settings[key] = v;
      changed.push(key);
    }
  }
  if (!changed.length) return;
  if (changed.includes('alwaysOnTop') && win) win.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
  if (changed.includes('clickThrough') && win) win.setIgnoreMouseEvents(settings.clickThrough);
  if (changed.includes('lowPriority')) applyPriority();
  if (changed.includes('showJoin') && !settings.showJoin) joinCount = 0;
  scheduleSave();
}

/* ------------------------------------------------------------------ */
/*  Penampung event + pengiriman batch ke jendela                      */
/* ------------------------------------------------------------------ */

const stats = { viewers: null, likes: null, diamonds: 0, top: [] };
let statsDirty = false;
let pendingChat = [];
let pendingEvents = [];
const pendingGifts = new Map();
let joinLast = '';
let joinCount = 0;
let flushTimer = null;

const FLUSH_MS = 350;
const MAX_CHAT_PER_BATCH = 30; // saat ramai sekali, buang komentar lama (layar cuma muat sedikit)

const nick = (u) => {
  const s = String(u?.nickname || u?.uniqueId || '???');
  return s.length > 24 ? s.slice(0, 24) + '…' : s;
};

function kick() {
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
}

function flush() {
  flushTimer = null;
  if (!win || win.isDestroyed()) return;
  const b = {};
  if (pendingChat.length) {
    b.c = pendingChat.length > MAX_CHAT_PER_BATCH ? pendingChat.slice(-MAX_CHAT_PER_BATCH) : pendingChat;
    pendingChat = [];
  }
  if (pendingEvents.length) {
    b.f = pendingEvents.length > 10 ? pendingEvents.slice(-10) : pendingEvents;
    pendingEvents = [];
  }
  if (pendingGifts.size) {
    b.g = [...pendingGifts.values()];
    pendingGifts.clear();
  }
  if (joinCount) {
    b.j = { n: joinLast, k: joinCount };
    joinCount = 0;
  }
  if (statsDirty) {
    b.s = { v: stats.viewers, l: stats.likes, d: stats.diamonds, t: stats.top };
    statsDirty = false;
  }
  if (b.c || b.f || b.g || b.j || b.s) win.webContents.send('batch', b);
}

function resetStats() {
  stats.viewers = null;
  stats.likes = null;
  stats.diamonds = 0;
  stats.top = [];
  statsDirty = false;
  pendingChat = [];
  pendingEvents = [];
  pendingGifts.clear();
  joinCount = 0;
  clearTimeout(flushTimer);
  flushTimer = null;
  toWin('reset');
}

let lastStatus = { state: 'idle', text: 'Masukkan username lalu klik Hubungkan.' };
function sendStatus(state, text) {
  lastStatus = { state, text };
  toWin('status', lastStatus);
}

/* ------------------------------------------------------------------ */
/*  Koneksi TikTok LIVE                                                */
/* ------------------------------------------------------------------ */

let lib = null; // modul tiktok-live-connector (dimuat saat dibutuhkan)
let conn = null;
let wantConnected = false;
let retryTimer = null;
let retryCount = 0;
let session = 0; // naik tiap percobaan: callback lama diabaikan
let fieldMiss = false; // ada event (chat/gift/follow/share) yang field pentingnya tidak terbaca
let eventCount = 0; // jumlah event yang benar-benar diterima dari TikTok (untuk diagnosis)
let liveSince = 0;
let watchTimer = null;
let infoTimer = null; // cadangan: ambil data ruangan berkala (like/penonton)
let infoFirstTimer = null;

const RETRY_LADDER = [5000, 10000, 20000, 40000, 80000, 120000];

function parseUsername(raw) {
  let s = String(raw ?? '').trim();
  const m = s.match(/tiktok\.com\/@([^/?#\s]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@+/, '');
  return /^[A-Za-z0-9._]{1,40}$/.test(s) ? s : null;
}

// Ambil angka pertama yang valid (>0) dari beberapa kemungkinan nama field.
// Library TikTok kadang mengganti nama field antar versi, jadi kita terima beberapa nama.
const pickNum = (o, keys) => {
  if (!o || typeof o !== 'object') return null;
  for (const k of keys) {
    const n = Number(o[k]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
};

// Catat nama field asli dari TikTok (sekali per jenis event) untuk petunjuk diagnosis.
const seenKeys = {};
function peek(name, d) {
  if (!seenKeys[name] && d && typeof d === 'object') seenKeys[name] = Object.keys(d).slice(0, 16).join(',');
}

function stopWatch() {
  clearInterval(watchTimer);
  clearInterval(infoTimer);
  clearTimeout(infoFirstTimer);
  watchTimer = null;
  infoTimer = null;
  infoFirstTimer = null;
}

// Tiap 5 dtk, tampilkan jumlah event yang diterima. Kalau lama tidak ada data, beri petunjuk.
function startWatch(user) {
  stopWatch();
  liveSince = Date.now();
  eventCount = 0;
  fieldMiss = false;
  for (const k of Object.keys(seenKeys)) delete seenKeys[k];
  watchTimer = setInterval(() => {
    if (lastStatus.state !== 'live') return;
    let text = `Terhubung ke @${user}`;
    if (eventCount === 0 && Date.now() - liveSince > 25000) {
      text += ', tapi TikTok belum mengirim data. Pastikan LIVE sedang berjalan & publik, atau isi API key di ⚙.';
    } else if (fieldMiss && Date.now() - liveSince > 20000) {
      // Hanya muncul kalau ada data yang gagal dibaca (bukan pada pemakaian normal).
      const parts = Object.entries(seenKeys).map(([k, v]) => `${k}[${v}]`);
      if (parts.length) text += ` · field: ${parts.join(' ')}`;
    }
    if (text !== lastStatus.text) sendStatus('live', text); // tidak kirim ulang kalau teks sama
  }, 5000);
}

async function teardown() {
  stopWatch();
  const c = conn;
  conn = null;
  if (!c) return;
  try { c.removeAllListeners(); } catch { /* */ }
  try { c.on('error', () => {}); } catch { /* */ } // cegah 'error' tak tertangani
  try {
    await Promise.race([c.disconnect(), new Promise((r) => setTimeout(r, 2000))]);
  } catch { /* */ }
}

function classify(err) {
  const is = (C) => typeof C === 'function' && err instanceof C;
  const text = String(err?.message || err || '');
  const label = `${err?.name || ''} ${text}`;
  if (lib && is(lib.UserOfflineError)) return { kind: 'offline' };
  if (lib && is(lib.InvalidUniqueIdError)) return { kind: 'fatal', msg: 'Username tidak ditemukan.' };
  if (lib && is(lib.SignatureRateLimitError)) {
    return { kind: 'rate', msg: 'Terkena batas permintaan server signing. Isi API key di Pengaturan atau tunggu sebentar.' };
  }
  if (/offline|not currently live|isn't live|not live/i.test(label)) return { kind: 'offline' };
  if (/room ?id/i.test(text)) {
    return { kind: 'retry', msg: 'Gagal membaca data LIVE. Pastikan akun sedang LIVE, username benar, dan internet aktif.' };
  }
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|network|socket/i.test(label)) {
    return { kind: 'retry', msg: 'Koneksi internet bermasalah.' };
  }
  return { kind: 'retry', msg: text.replace(/\s+/g, ' ').slice(0, 100) || 'Gagal terhubung.' };
}

function handleFail(err) {
  const user = settings.username;
  const info = classify(err);
  teardown();
  if (!wantConnected) return;

  if (info.kind === 'fatal') {
    wantConnected = false;
    sendStatus('error', info.msg);
    return;
  }
  if (!settings.autoReconnect) {
    wantConnected = false;
    sendStatus('error', info.kind === 'offline' ? `@${user} tidak sedang LIVE.` : info.msg);
    return;
  }

  retryCount++;
  let delay = RETRY_LADDER[Math.min(retryCount - 1, RETRY_LADDER.length - 1)];
  if (info.kind === 'offline') delay = 45000;
  if (info.kind === 'rate') delay = Math.max(delay, 90000);

  const why = info.kind === 'offline' ? `@${user} belum LIVE.` : info.msg;
  sendStatus(info.kind === 'offline' ? 'wait' : 'retry', `${why} Coba lagi ${Math.round(delay / 1000)} dtk…`);
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connectNow, delay);
}

// Isi awal penonton & like dari data ruangan saat baru terhubung (sebelum event pertama datang).
function applyRoomInfo(info) {
  if (!info || typeof info !== 'object') return;
  peek('roomInfo', info);
  const d1 = info.data && typeof info.data === 'object' ? info.data : info;
  const inner = d1.data && typeof d1.data === 'object' ? d1.data : d1;
  const st = inner.stats && typeof inner.stats === 'object' ? inner.stats : {};
  const v = pickNum(inner, ['user_count', 'userCount', 'viewerCount']) ?? pickNum(st, ['user_count', 'total_user', 'userCount']);
  const l = pickNum(st, ['like_count', 'likeCount']) ?? pickNum(inner, ['like_count', 'likeCount']);
  if (stats.viewers === null && v !== null) { stats.viewers = v; statsDirty = true; }
  if (l !== null && l > (stats.likes || 0)) { stats.likes = l; statsDirty = true; } // like hanya boleh naik
  if (statsDirty) kick();
}

// Cadangan: TikTok sering tidak mengirim event like di LIVE sepi, jadi ambil total like dari data ruangan.
async function pollRoomInfo(c, my) {
  if (my !== session || c !== conn || !wantConnected) return;
  if (typeof c.fetchRoomInfo !== 'function') return;
  try {
    const info = await c.fetchRoomInfo();
    if (my !== session || c !== conn) return;
    applyRoomInfo(info);
  } catch { /* hanya cadangan: abaikan kalau gagal */ }
}

function wire(c, my) {
  const E = lib.WebcastEvent;
  const C = lib.ControlEvent;
  // Semua event pesan dihitung supaya kelihatan apakah TikTok benar-benar mengirim data.
  const on = (name, fn) => c.on(name, (d) => { eventCount++; fn(d); });

  on(E.CHAT, (d) => {
    // Nama field teks komentar bisa berbeda antar versi library: comment / content.
    const text = d?.comment ?? d?.content ?? d?.text ?? d?.message;
    if (!text) {
      peek('chat', d); // tidak ada teks: simpan nama field asli untuk petunjuk di status
      fieldMiss = true;
      return;
    }
    pendingChat.push({ n: nick(d.user), m: String(text).slice(0, 200) });
    if (pendingChat.length > 60) pendingChat.splice(0, pendingChat.length - 60);
    kick();
  });

  on(E.MEMBER, (d) => {
    if (!settings.showJoin) return;
    joinLast = nick(d?.user);
    joinCount++;
    kick();
  });

  on(E.LIKE, (d) => {
    peek('like', d);
    const total = pickNum(d, ['totalLikeCount', 'totalLikes', 'total', 'likesTotal']);
    const add = pickNum(d, ['likeCount', 'count', 'likes']) || 0;
    stats.likes = total !== null ? total : (stats.likes || 0) + add;
    statsDirty = true;
    kick();
  });

  on(E.ROOM_USER, (d) => {
    peek('roomUser', d);
    const v = pickNum(d, ['viewerCount', 'total', 'userCount', 'onlineCount']);
    if (v !== null) stats.viewers = v;
    const ranks = Array.isArray(d?.ranksList) ? d.ranksList : Array.isArray(d?.topViewers) ? d.topViewers : [];
    stats.top = ranks.slice(0, 3).map((r) => ({ n: nick(r?.user), c: Number(r?.coinCount) || 0 }));
    statsDirty = true;
    kick();
  });

  on(E.GIFT, (d) => {
    const det = d?.giftDetails || d?.gift || {};
    if (!(det.giftName || det.name) || !(det.diamondCount ?? det.diamond_count)) {
      peek('gift', d); // nama/harga gift tidak terbaca: simpan nama field asli untuk petunjuk
      fieldMiss = true;
    }
    const gType = det.giftType ?? det.type;
    const streakable = gType === 1;
    const final = !streakable || !!d.repeatEnd; // gift beruntun: hitung hanya saat streak selesai
    const count = Number(d?.repeatCount) || 1;
    const who = nick(d?.user);
    const key = `${String(d?.user?.userId ?? d?.user?.uniqueId ?? who)}|${String(d?.giftId)}`;
    if (final) {
      stats.diamonds += (Number(det.diamondCount ?? det.diamond_count) || 0) * count;
      statsDirty = true;
    }
    pendingGifts.set(key, {
      k: key,
      n: who,
      g: String(det.giftName || det.name || `Gift #${d?.giftId}`).slice(0, 30),
      c: count,
      e: final ? 1 : 0,
    });
    kick();
  });

  on(E.FOLLOW, (d) => {
    if (!d?.user) { peek('follow', d); fieldMiss = true; }
    pendingEvents.push({ k: 'f', n: nick(d?.user) });
    kick();
  });
  on(E.SHARE, (d) => {
    if (!d?.user) { peek('share', d); fieldMiss = true; }
    pendingEvents.push({ k: 's', n: nick(d?.user) });
    kick();
  });

  c.on(E.STREAM_END, () => {
    if (my !== session) return;
    wantConnected = false;
    sendStatus('ended', 'LIVE telah berakhir.');
    teardown();
  });

  c.on(C.DISCONNECTED, () => {
    if (my !== session || c !== conn || !wantConnected) return;
    handleFail(new Error('Koneksi terputus.'));
  });

  c.on(C.ERROR, () => { /* error per-pesan: abaikan agar tidak berisik */ });
}

async function connectNow() {
  const my = ++session;
  clearTimeout(retryTimer);
  await teardown();
  if (my !== session || !wantConnected) return;

  const user = settings.username;
  sendStatus('connecting', `Menghubungkan ke @${user}…`);
  try {
    lib = lib || (await import('tiktok-live-connector'));
    if (my !== session) return;

    const options = { processInitialData: false, enableExtendedGiftInfo: false };
    if (settings.apiKey) options.signApiKey = settings.apiKey;

    const c = new lib.TikTokLiveConnection(user, options);
    conn = c;
    wire(c, my);
    const state = await c.connect();
    if (my !== session) return;

    retryCount = 0;
    sendStatus('live', `Terhubung ke @${user}`);
    applyRoomInfo(state?.roomInfo);
    startWatch(user);
    infoFirstTimer = setTimeout(() => pollRoomInfo(c, my), 6000);
    infoTimer = setInterval(() => pollRoomInfo(c, my), 45000);
  } catch (err) {
    if (my !== session) return;
    handleFail(err);
  }
}

async function disconnectAll() {
  wantConnected = false;
  session++;
  clearTimeout(retryTimer);
  stopDemo();
  await teardown();
}

/* ------------------------------------------------------------------ */
/*  Mode demo (data contoh untuk mencoba tampilan tanpa LIVE)          */
/* ------------------------------------------------------------------ */

const DEMO_NAMES = ['Budi', 'Siti', 'Rizky', 'Dewi', 'Agus', 'Putri', 'Joko', 'Nadia', 'Fajar', 'Lestari'];
const DEMO_TEXT = [
  'halo kak 👋', 'semangat live-nya!', 'salam dari Indonesia', 'lagu apa ini kak?', 'ikut nonton ya',
  'keren banget', 'follow back dong', 'gas terus 🔥', 'suaranya jernih', 'mampir kak, baru gabung',
];
const DEMO_GIFTS = [['Rose', 1], ['Finger Heart', 5], ['TikTok', 1], ['Galaxy', 1000]];
let demoTimer = null;
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function stopDemo() {
  clearInterval(demoTimer);
  demoTimer = null;
}

async function startDemo() {
  await disconnectAll();
  resetStats();
  stats.viewers = 120;
  stats.likes = 3200;
  stats.top = DEMO_NAMES.slice(0, 3).map((n, i) => ({ n, c: 900 - i * 250 }));
  statsDirty = true;
  sendStatus('demo', 'Mode demo — data contoh, bukan LIVE sungguhan');
  let n = 0;
  demoTimer = setInterval(() => {
    n++;
    if (Math.random() < 0.75) pendingChat.push({ n: pick(DEMO_NAMES), m: pick(DEMO_TEXT) });
    if (n % 3 === 0) { stats.likes += 5 + Math.floor(Math.random() * 40); statsDirty = true; }
    if (n % 5 === 0) { stats.viewers = Math.max(1, stats.viewers + Math.floor(Math.random() * 9) - 4); statsDirty = true; }
    if (n % 7 === 0 && settings.showJoin) { joinLast = pick(DEMO_NAMES); joinCount = 1 + Math.floor(Math.random() * 4); }
    if (n % 11 === 0) {
      const who = pick(DEMO_NAMES);
      const [g, d] = pick(DEMO_GIFTS);
      const c = 1 + Math.floor(Math.random() * 9);
      stats.diamonds += d * c;
      statsDirty = true;
      pendingGifts.set(`${who}|${g}`, { k: `${who}|${g}`, n: who, g, c, e: 1 });
    }
    if (n % 17 === 0) pendingEvents.push({ k: 'f', n: pick(DEMO_NAMES) });
    if (n % 23 === 0) pendingEvents.push({ k: 's', n: pick(DEMO_NAMES) });
    kick();
  }, 700);
}

/* ------------------------------------------------------------------ */
/*  Suara komentar (TTS Google)                                        */
/*  Diunduh di proses utama supaya jendela overlay tetap tanpa akses   */
/*  internet (CSP-nya tetap ketat).                                    */
/* ------------------------------------------------------------------ */

const TTS_TIMEOUT_MS = 6000;
const TTS_MAX_BYTES = 500 * 1024;
const TTS_MAX_PARALLEL = 3;
const TTS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
let ttsRunning = 0;

async function fetchTts(text, lang) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TTS_TIMEOUT_MS);
  try {
    const url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob'
      + `&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`;
    const res = await net.fetch(url, { headers: { 'User-Agent': TTS_UA }, signal: ctrl.signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    if (!/audio/i.test(res.headers.get('content-type') || '')) return { ok: false, error: 'Bukan audio' };
    const buf = await res.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > TTS_MAX_BYTES) return { ok: false, error: 'Ukuran audio tidak wajar' };
    return { ok: true, data: new Uint8Array(buf) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/*  IPC (hanya diterima dari jendela overlay sendiri)                  */
/* ------------------------------------------------------------------ */

const fromUs = (e) => !!win && e.sender === win.webContents;

ipcMain.handle('init', async (e) => {
  if (!fromUs(e)) return null;
  if (DEMO_FLAG && !demoTimer && !wantConnected && lastStatus.state === 'idle') startDemo();
  return { settings: { ...settings, apiKey: settings.apiKey }, status: lastStatus };
});

ipcMain.handle('connect', async (e, raw) => {
  if (!fromUs(e)) return { ok: false };
  const user = parseUsername(raw);
  if (!user) return { ok: false, error: 'Username tidak valid. Contoh: namaakun atau https://www.tiktok.com/@namaakun/live' };
  await disconnectAll();
  resetStats();
  settings.username = user;
  scheduleSave();
  wantConnected = true;
  retryCount = 0;
  connectNow();
  return { ok: true, username: user };
});

ipcMain.handle('disconnect', async (e) => {
  if (!fromUs(e)) return { ok: false };
  await disconnectAll();
  resetStats();
  sendStatus('idle', 'Belum terhubung.');
  return { ok: true };
});

ipcMain.handle('demo', async (e) => {
  if (!fromUs(e)) return { ok: false };
  await startDemo();
  return { ok: true };
});

ipcMain.handle('tts:fetch', async (e, text, lang) => {
  if (!fromUs(e)) return { ok: false };
  const line = typeof text === 'string' ? text.trim().slice(0, 200) : '';
  if (!line || typeof lang !== 'string' || !LANG_RE.test(lang)) return { ok: false, error: 'Data tidak valid' };
  if (ttsRunning >= TTS_MAX_PARALLEL) return { ok: false, error: 'Sibuk' };
  ttsRunning++;
  try {
    return await fetchTts(line, lang);
  } finally {
    ttsRunning--;
  }
});

ipcMain.on('settings:set', (e, patch) => { if (fromUs(e)) applyPatch(patch); });
ipcMain.on('win:preset', (e, name) => { if (fromUs(e)) applyPreset(String(name)); });
ipcMain.on('win:resize', (e, w, h) => {
  if (!fromUs(e) || !win) return;
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  const width = num(w, 260, wa.width);
  const height = num(h, 200, wa.height);
  if (width !== null && height !== null) win.setSize(Math.round(width), Math.round(height));
});
ipcMain.on('win:minimize', (e) => { if (fromUs(e) && win) win.minimize(); });
ipcMain.on('win:close', (e) => { if (fromUs(e) && win) win.close(); });
ipcMain.on('app:relaunch', (e) => {
  if (!fromUs(e)) return;
  saveNow();
  app.relaunch();
  app.exit(0);
});

/* ------------------------------------------------------------------ */
/*  Siklus hidup aplikasi                                              */
/* ------------------------------------------------------------------ */

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  // Ctrl+Shift+X: klik-tembus on/off dari aplikasi mana pun. Ctrl+Shift+H: sembunyikan/tampilkan.
  globalShortcut.register('CommandOrControl+Shift+X', () => setClickThrough(!settings.clickThrough));
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (!win) return;
    if (win.isVisible()) win.hide();
    else win.showInactive();
  });
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  stopDemo();
  clearTimeout(retryTimer);
  globalShortcut.unregisterAll();
  saveNow();
  teardown();
});
