'use strict';
// Suara komentar LIVE (TTS).
// Alur: komentar masuk -> dibersihkan & disaring -> antrean pendek -> dibacakan satu per satu.
//
// Hemat resource:
//  - tanpa library tambahan, tanpa timer saat idle (hanya event);
//  - antrean dibatasi, komentar terlama dibuang supaya suara tetap dekat dengan LIVE;
//  - audio berikutnya diunduh lebih awal (jeda antar komentar kecil), lalu dibuang setelah selesai.
//
// Dua sumber suara:
//  - "google": satu suara per bahasa/negara (Indonesia, Malaysia, dst.). Diunduh lewat proses utama.
//  - "system": suara yang terpasang di Windows (offline). Kalau Google gagal, otomatis pindah ke sini.

const TTS = (() => {
  // Kata sambung "NAMA ... KOMENTAR" per bahasa. Bahasa lain memakai koma.
  const SAYS = { id: 'bilang', ms: 'kata', jw: 'ngomong', su: 'nyarios', en: 'says' };

  // Kode bahasa Google -> tag bahasa untuk suara Windows.
  const BCP47 = {
    id: 'id-ID', ms: 'ms-MY', jw: 'jv-ID', su: 'su-ID', tl: 'fil-PH', en: 'en-US', th: 'th-TH',
    vi: 'vi-VN', ja: 'ja-JP', ko: 'ko-KR', 'zh-CN': 'zh-CN', ar: 'ar-SA', hi: 'hi-IN', es: 'es-ES',
    pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE', ru: 'ru-RU', tr: 'tr-TR', nl: 'nl-NL', it: 'it-IT',
  };

  const SAMPLE = {
    id: 'Halo, ini tes suara komentar.',
    ms: 'Helo, ini ujian suara komen.',
    en: 'Hello, this is a comment voice test.',
  };

  const MAX_LINE = 200; // batas panjang teks untuk Google TTS
  const MAX_NAME = 20;
  const DUP_WINDOW_MS = 15000; // komentar yang sama dalam rentang ini hanya dibaca sekali
  const FAIL_LIMIT = 3; // gagal beruntun sebelum Google dijeda
  const FAIL_PAUSE_MS = 60000; // lama Google dijeda (selama itu pakai suara Windows)
  const AUDIO_GUARD_MS = 25000; // pengaman supaya antrean tidak macet

  const URL_RE = /(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|id|my|co|io|me|tv|xyz|link|gg|app)\b\S*/giu;
  const TAG_RE = /\[[^\]]{1,24}\]/g; // emote TikTok seperti [rose]
  const EMOJI_RE = /[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]/gu;
  const SYMBOL_RE = /[_@#*~^|<>{}\\/=+]/g;
  const REPEAT_RE = /([^\s\d]{1,3}?)\1{3,}/gu; // "hahahahaha", "aaaaaa" -> dipersingkat (angka tidak disentuh)
  const LETTER_RE = /[\p{L}\p{N}]/u;

  let getCfg = () => ({});
  const queue = []; // { name, text, pre, lang }
  const recent = []; // { k, t } untuk membuang komentar kembar
  let busy = false;
  let current = null; // { stop(), refresh() } milik suara yang sedang diputar
  let epoch = 0; // naik tiap stop(): pekerjaan lama berhenti sendiri
  let failStreak = 0;
  let googleOffUntil = 0;
  let blockSrc = null;
  let blockList = [];

  const cfg = () => getCfg() || {};
  const clamp = (v, lo, hi, d) => {
    v = Number(v);
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  };
  const baseLang = (code) => String(code || 'id').split(/[-_]/)[0].toLowerCase();

  /* ---------- pembersihan teks ---------- */

  function clean(s) {
    return String(s ?? '')
      .replace(URL_RE, ' ')
      .replace(TAG_RE, ' ')
      .replace(EMOJI_RE, ' ')
      .replace(SYMBOL_RE, ' ')
      .replace(REPEAT_RE, '$1$1$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cut(text, max) {
    if (text.length <= max) return text;
    const head = text.slice(0, max);
    const i = head.lastIndexOf(' ');
    return (i > max * 0.5 ? head.slice(0, i) : head).trim();
  }

  function blocked(lower) {
    const src = String(cfg().ttsBlock || '');
    if (src !== blockSrc) {
      blockSrc = src;
      blockList = src.toLowerCase().split(/[,;\n]/).map((w) => w.trim()).filter(Boolean);
    }
    return blockList.some((w) => lower.includes(w));
  }

  function seenRecently(key, now) {
    while (recent.length && now - recent[0].t > DUP_WINDOW_MS) recent.shift();
    if (recent.some((r) => r.k === key)) return true;
    recent.push({ k: key, t: now });
    if (recent.length > 12) recent.shift();
    return false;
  }

  // Teks lengkap yang diucapkan, mis. "Budi bilang halo kak".
  function lineOf(item, lang) {
    const says = SAYS[baseLang(lang)];
    const line = item.name
      ? (says ? `${item.name} ${says} ${item.text}` : `${item.name}, ${item.text}`)
      : item.text;
    return line.slice(0, MAX_LINE);
  }

  /* ---------- audio Google ---------- */

  const googleReady = (c) => c.ttsEngine === 'google' && Date.now() >= googleOffUntil;

  async function download(line, lang) {
    try {
      const res = await window.api.ttsFetch(line, lang);
      if (!res || !res.ok || !res.data) return null;
      return URL.createObjectURL(new Blob([res.data], { type: 'audio/mpeg' }));
    } catch {
      return null;
    }
  }

  function dispose(item) {
    if (item && item.pre) item.pre.then((u) => { if (u) URL.revokeObjectURL(u); });
    if (item) item.pre = null;
  }

  // Mulai unduh audio untuk item berikutnya selagi item sekarang masih diputar.
  function prepare(item) {
    if (!item || item.pre) return;
    const c = cfg();
    if (!googleReady(c)) return;
    item.lang = c.ttsLang || 'id';
    item.pre = download(lineOf(item, item.lang), item.lang);
  }

  function noteFail() {
    if (++failStreak >= FAIL_LIMIT) {
      failStreak = 0;
      googleOffUntil = Date.now() + FAIL_PAUSE_MS;
    }
  }

  /* ---------- pemutar ---------- */

  function playAudio(url) {
    return new Promise((resolve) => {
      const a = new Audio(url);
      const c = cfg();
      a.preservesPitch = true;
      a.volume = clamp(c.ttsVolume, 0, 1, 1);
      a.playbackRate = clamp(c.ttsRate, 0.5, 2, 1);

      let guard = 0;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        a.pause();
        a.removeAttribute('src');
        a.load(); // lepas decoder & memori
        URL.revokeObjectURL(url);
        current = null;
        resolve();
      };
      const refresh = () => {
        const n = cfg();
        a.volume = clamp(n.ttsVolume, 0, 1, 1);
        a.playbackRate = clamp(n.ttsRate, 0.5, 2, 1);
      };

      guard = setTimeout(finish, AUDIO_GUARD_MS);
      a.addEventListener('ended', finish, { once: true });
      a.addEventListener('error', finish, { once: true });
      current = { stop: finish, refresh };
      a.play().catch(finish);
    });
  }

  function playSystem(item) {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
        resolve();
        return;
      }
      const c = cfg();
      const voice = c.ttsVoice ? synth.getVoices().find((v) => v.name === c.ttsVoice) : null;
      const lang = voice ? voice.lang : (BCP47[c.ttsLang] || 'id-ID');
      const u = new SpeechSynthesisUtterance(lineOf(item, lang));
      if (voice) u.voice = voice;
      u.lang = lang;
      u.volume = clamp(c.ttsVolume, 0, 1, 1);
      u.rate = clamp(c.ttsRate, 0.5, 2, 1);

      let guard = 0;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        current = null;
        resolve();
      };
      u.onend = finish;
      u.onerror = finish;
      guard = setTimeout(() => { synth.cancel(); finish(); }, 8000 + u.text.length * 150);
      current = { stop: () => { synth.cancel(); finish(); }, refresh() { /* tidak bisa diubah di tengah kalimat */ } };

      if (synth.paused) synth.resume(); // Chromium kadang macet di status "paused"
      synth.speak(u);
    });
  }

  async function speak(item, my) {
    const c = cfg();
    if (googleReady(c)) {
      const lang = c.ttsLang || 'id';
      if (!item.pre || item.lang !== lang) {
        dispose(item);
        item.lang = lang;
        item.pre = download(lineOf(item, lang), lang);
      }
      const pre = item.pre;
      item.pre = null;
      const url = await pre;
      if (my !== epoch) { // stop() ditekan saat menunggu unduhan
        if (url) URL.revokeObjectURL(url);
        return;
      }
      if (url) {
        failStreak = 0;
        prepare(queue[0]); // audio berikutnya diunduh selagi yang ini diputar
        await playAudio(url);
        return;
      }
      noteFail(); // Google gagal: komentar ini tetap dibacakan dengan suara Windows
    }
    if (my === epoch) await playSystem(item);
  }

  async function pump() {
    if (busy) return;
    busy = true;
    const my = epoch;
    try {
      while (queue.length && my === epoch) {
        const item = queue.shift();
        try { await speak(item, my); } catch { /* satu komentar gagal: lanjut ke berikutnya */ }
      }
    } finally {
      busy = false;
    }
    if (queue.length) pump(); // ada komentar masuk saat loop lama baru berakhir
  }

  function push(item) {
    const limit = clamp(cfg().ttsMaxQueue, 1, 20, 5);
    queue.push(item);
    while (queue.length > limit) dispose(queue.shift()); // buang yang paling lama
    if (current && queue.length === 1) prepare(queue[0]); // sedang memutar & ini giliran berikutnya
    pump();
  }

  /* ---------- antarmuka untuk renderer.js ---------- */

  return {
    init(fn) { getCfg = fn; },

    // list: [{ n: nama, m: komentar }] dari proses utama.
    enqueue(list) {
      const c = cfg();
      if (!c.ttsEnabled || !Array.isArray(list)) return;
      const max = clamp(c.ttsMaxChars, 30, 160, 100);
      const now = Date.now();
      for (const m of list) {
        const text = cut(clean(m && m.m), max);
        if (!LETTER_RE.test(text)) continue; // kosong / hanya emoji / hanya simbol
        let name = c.ttsReadName ? cut(clean(m && m.n), MAX_NAME) : '';
        if (name && !LETTER_RE.test(name)) name = '';
        if (blocked(`${name} ${text}`.toLowerCase())) continue;
        if (seenRecently(text.toLowerCase(), now)) continue;
        push({ name, text, pre: null, lang: '' });
      }
    },

    test() {
      push({ name: '', text: SAMPLE[baseLang(cfg().ttsLang)] || SAMPLE.en, pre: null, lang: '' });
    },

    skip() { if (current) current.stop(); },

    stop() {
      epoch++;
      for (const item of queue) dispose(item);
      queue.length = 0;
      recent.length = 0;
      if (current) current.stop();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    },

    refresh() { if (current) current.refresh(); },

    // Dipanggil saat sumber/bahasa diganti: coba Google lagi tanpa menunggu jeda.
    resetFail() {
      failStreak = 0;
      googleOffUntil = 0;
    },

    // Daftar suara Windows; Indonesia & Melayu ditaruh paling atas.
    listVoices() {
      const synth = window.speechSynthesis;
      if (!synth) return [];
      const rank = (l) => (/^id(?![a-z])/i.test(l) ? 0 : /^ms(?![a-z])/i.test(l) ? 1 : 2);
      return synth.getVoices()
        .map((v) => ({ name: v.name, lang: v.lang }))
        .sort((a, b) => rank(a.lang) - rank(b.lang) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
    },
  };
})();
