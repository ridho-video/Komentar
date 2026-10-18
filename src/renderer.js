'use strict';
// Logika tampilan overlay. Update layar hanya terjadi saat paket (batch) dari proses utama tiba,
// sekitar 3x per detik, jadi CPU hampir 0 saat LIVE sepi.

const $ = (id) => document.getElementById(id);
const root = document.documentElement;

const chat = $('chat');
const giftsBox = $('gifts');
const joinBox = $('join');
const topBox = $('top');
const statusBox = $('status');
const dot = $('dot');
const title = $('title');
const userInput = $('user');
const goBtn = $('bGo');
const settingsBox = $('settings');

const MAX_GIFT_ROWS = 3;
const TITLE_NORMAL = 'TikTok Live';
const TITLE_GHOST = '🖱 Klik-tembus aktif · Ctrl+Shift+X';

let cfg = {};
TTS.init(() => cfg); // TTS selalu membaca pengaturan terbaru dari cfg
let maxLines = 35;
let active = false; // sedang menghubungkan / terhubung / demo
const giftRows = new Map(); // key -> { node, until }
let giftTimer = 0;
let joinTimer = 0;

/* ---------- format ---------- */

function fmt(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n));
}

function colorIndex(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return (h >>> 0) % 8;
}

/* ---------- statistik ---------- */

function applyStats(s) {
  $('sV').textContent = fmt(s.v);
  $('sL').textContent = fmt(s.l);
  $('sD').textContent = fmt(s.d);
  if (Array.isArray(s.t) && s.t.length) {
    topBox.textContent = '🏆 ' + s.t.map((x, i) => `${i + 1}. ${x.n}`).join('   ');
    topBox.classList.add('on');
  } else {
    topBox.classList.remove('on');
  }
}

/* ---------- komentar ---------- */

function trimChat() {
  let extra = chat.childElementCount - maxLines;
  while (extra-- > 0) chat.firstElementChild.remove();
}

function appendChat(chats, events) {
  const frag = document.createDocumentFragment();

  if (chats) {
    for (const m of chats) {
      const row = document.createElement('div');
      row.className = 'm';
      const who = document.createElement('b');
      who.className = 'u c' + colorIndex(m.n);
      who.textContent = m.n;
      row.append(who, ': ' + m.m); // textContent-style: aman dari HTML
      frag.append(row);
    }
  }
  if (events) {
    for (const e of events) {
      const row = document.createElement('div');
      row.className = 'm ev ' + e.k;
      row.textContent = e.k === 'f' ? `➕ ${e.n} mengikuti` : `🔗 ${e.n} membagikan LIVE`;
      frag.append(row);
    }
  }

  chat.append(frag);
  trimChat();
}

/* ---------- gift ---------- */

function applyGifts(list) {
  const now = Date.now();
  for (const g of list) {
    let row = giftRows.get(g.k);
    if (!row) {
      if (giftRows.size >= MAX_GIFT_ROWS) {
        const oldest = giftRows.keys().next().value;
        giftRows.get(oldest).node.remove();
        giftRows.delete(oldest);
      }
      row = { node: document.createElement('div'), until: 0 };
      giftsBox.append(row.node);
      giftRows.set(g.k, row);
    }
    row.node.className = g.e ? 'g' : 'g live'; // oranye = combo masih berjalan
    row.node.textContent = `🎁 ${g.n} mengirim ${g.g}` + (g.c > 1 ? ` ×${g.c}` : '');
    row.until = now + (g.e ? 6000 : 12000);
  }
  if (!giftTimer) giftTimer = setInterval(sweepGifts, 1000);
}

function sweepGifts() {
  const now = Date.now();
  for (const [key, row] of giftRows) {
    if (row.until <= now) {
      row.node.remove();
      giftRows.delete(key);
    }
  }
  if (!giftRows.size) {
    clearInterval(giftTimer); // timer berhenti saat tidak ada gift: 0 CPU
    giftTimer = 0;
  }
}

/* ---------- bergabung ---------- */

function showJoin(j) {
  joinBox.textContent = '👋 ' + j.n + (j.k > 1 ? ` +${j.k - 1} lainnya` : '') + ' bergabung';
  joinBox.classList.add('on');
  clearTimeout(joinTimer);
  joinTimer = setTimeout(() => joinBox.classList.remove('on'), 5000);
}

/* ---------- reset ---------- */

function clearAll() {
  TTS.stop(); // sambung/putus/demo baru: buang antrean suara lama
  chat.replaceChildren();
  giftsBox.replaceChildren();
  giftRows.clear();
  clearInterval(giftTimer);
  giftTimer = 0;
  joinBox.classList.remove('on');
  topBox.classList.remove('on');
  $('sV').textContent = '—';
  $('sL').textContent = '—';
  $('sD').textContent = '0';
}

/* ---------- status & tombol hubungkan ---------- */

function setActive(on) {
  active = on;
  userInput.disabled = on;
  goBtn.textContent = on ? 'Putus' : 'Hubungkan';
  goBtn.classList.toggle('off', on);
}

function applyStatus(s) {
  dot.className = 'dot ' + s.state;
  statusBox.textContent = s.text;
  setActive(['connecting', 'live', 'retry', 'wait', 'demo'].includes(s.state));
}

$('connect').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (active) {
    await window.api.disconnect();
    return;
  }
  const res = await window.api.connect(userInput.value);
  if (res && !res.ok) {
    dot.className = 'dot error';
    statusBox.textContent = res.error || 'Gagal.';
  }
});

/* ---------- pengaturan ---------- */

function applyLocal(key, value) {
  cfg[key] = value;
  if (key === 'bgAlpha') root.style.setProperty('--a', value);
  else if (key === 'fontSize') root.style.setProperty('--fs', value + 'px');
  else if (key === 'maxLines') { maxLines = value; trimChat(); }
  else if (key === 'alwaysOnTop') $('bPin').classList.toggle('on', !!value);
  else if (key === 'clickThrough') {
    document.body.classList.toggle('ghost', !!value);
    title.textContent = value ? TITLE_GHOST : TITLE_NORMAL;
  }
  else if (key === 'ttsEngine') { settingsBox.dataset.engine = value; TTS.resetFail(); }
  else if (key === 'ttsLang') TTS.resetFail();
  else if (key === 'ttsEnabled') { if (!value) TTS.stop(); }
  else if (key === 'ttsVolume' || key === 'ttsRate') TTS.refresh(); // berlaku langsung ke suara yang sedang diputar
}

function syncControls() {
  for (const el of document.querySelectorAll('[data-k]')) {
    const v = cfg[el.dataset.k];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v ?? '';
  }
}

function bindControls() {
  for (const el of document.querySelectorAll('[data-k]')) {
    const key = el.dataset.k;
    const read = () => (el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value);

    if (el.type === 'range') el.addEventListener('input', () => applyLocal(key, read())); // pratinjau langsung
    el.addEventListener('change', () => {
      const v = read();
      applyLocal(key, v);
      window.api.set({ [key]: v });
      if (key === 'hardwareAcceleration' || key === 'lowPriority') $('restartNote').classList.add('on');
    });
  }

  for (const b of document.querySelectorAll('[data-preset]')) {
    b.addEventListener('click', () => window.api.preset(b.dataset.preset));
  }
}

$('bGear').addEventListener('click', () => settingsBox.classList.toggle('on'));
$('bPin').addEventListener('click', () => {
  const v = !cfg.alwaysOnTop;
  applyLocal('alwaysOnTop', v);
  window.api.set({ alwaysOnTop: v });
  syncControls();
});
$('bGhost').addEventListener('click', () => {
  applyLocal('clickThrough', true);
  window.api.set({ clickThrough: true });
  syncControls();
});
$('bMin').addEventListener('click', () => window.api.minimize());
$('bClose').addEventListener('click', () => window.api.close());
$('bRestart').addEventListener('click', () => window.api.relaunch());
$('bDemo').addEventListener('click', () => { settingsBox.classList.remove('on'); window.api.demo(); });

/* ---------- suara komentar (TTS) ---------- */

// Isi pilihan "Suara Windows" dari suara yang terpasang. Daftar bisa terlambat muncul, jadi isi ulang saat berubah.
function fillVoices() {
  const sel = $('ttsVoice');
  const frag = document.createDocumentFragment();
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = 'Otomatis (ikut bahasa)';
  frag.append(auto);
  for (const v of TTS.listVoices()) {
    const o = document.createElement('option');
    o.value = v.name;
    o.textContent = `${v.name} (${v.lang})`;
    frag.append(o);
  }
  sel.replaceChildren(frag);
  sel.value = cfg.ttsVoice || '';
  if (sel.value !== (cfg.ttsVoice || '')) sel.value = ''; // suara tersimpan sudah tidak ada
}

if (window.speechSynthesis) window.speechSynthesis.addEventListener('voiceschanged', fillVoices);

$('bTtsTest').addEventListener('click', () => TTS.test());
$('bTtsSkip').addEventListener('click', () => TTS.skip());
$('bTtsClear').addEventListener('click', () => TTS.stop());

/* ---------- ubah ukuran lewat pegangan pojok ---------- */

(() => {
  const grip = $('grip');
  let start = null;
  let next = null;
  let raf = 0;

  grip.addEventListener('pointerdown', (e) => {
    grip.setPointerCapture(e.pointerId);
    start = { x: e.screenX, y: e.screenY, w: window.innerWidth, h: window.innerHeight };
  });
  grip.addEventListener('pointermove', (e) => {
    if (!start) return;
    next = { w: start.w + e.screenX - start.x, h: start.h + e.screenY - start.y };
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (next) window.api.resizeTo(next.w, next.h);
      });
    }
  });
  const stop = () => { start = null; };
  grip.addEventListener('pointerup', stop);
  grip.addEventListener('pointercancel', stop);
})();

/* ---------- penerima pesan dari proses utama ---------- */

window.api.onBatch((b) => {
  if (b.s) applyStats(b.s);
  if (b.g) applyGifts(b.g);
  if (b.c || b.f) appendChat(b.c, b.f);
  if (b.c) TTS.enqueue(b.c);
  if (b.j) showJoin(b.j);
});
window.api.onStatus(applyStatus);
window.api.onReset(clearAll);
window.api.onState((s) => {
  if ('clickThrough' in s) {
    applyLocal('clickThrough', s.clickThrough);
    syncControls();
  }
});

bindControls();

window.api.init().then((res) => {
  if (!res) return;
  cfg = res.settings;
  for (const k of ['bgAlpha', 'fontSize', 'maxLines', 'alwaysOnTop', 'clickThrough', 'ttsEngine']) applyLocal(k, cfg[k]);
  userInput.value = cfg.username || '';
  fillVoices();
  syncControls();
  applyStatus(res.status);
});
