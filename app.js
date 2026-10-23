'use strict';
/* ===== Tiện ích ===== */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
};
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }
const wc = t => (t.trim().match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length;

/* ===== Dịch vụ phát âm (có thể thay bằng Cloud TTS) ===== */
const pron = {
  rate: 1, lang: 'en-US', playing: false,
  voice() {
    const v = speechSynthesis.getVoices();
    return v.find(x => x.lang === this.lang) || v.find(x => x.lang.startsWith('en')) || null;
  },
  speak(text, onEnd) {
    if (!('speechSynthesis' in window)) return toast('Trình duyệt không hỗ trợ phát âm.');
    this.stop();
    const u = new SpeechSynthesisUtterance(text), v = this.voice();
    if (!v) toast('Thiết bị chưa có giọng tiếng Anh phù hợp.');
    else u.voice = v;
    u.lang = this.lang; u.rate = this.rate;
    u.onend = u.onerror = () => { this.playing = false; onEnd && onEnd(); };
    this.playing = true; speechSynthesis.speak(u);
  },
  pause() { speechSynthesis.pause(); }, resume() { speechSynthesis.resume(); },
  stop() { speechSynthesis.cancel(); this.playing = false; }
};

/* ===== Tokenizer: từ, từ có ' hoặc -, số, khoảng trắng, dấu câu ===== */
const TOKEN_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*|\d+(?:[.,]\d+)*|\s+|[^\sA-Za-z\d]/g;
function tokenize(text) {
  const out = []; let m;
  while ((m = TOKEN_RE.exec(text))) {
    const s = m[0];
    out.push({ i: out.length, s, start: m.index, end: m.index + s.length, word: /^[A-Za-z]/.test(s) });
  }
  return out;
}

/* ===== Dữ liệu minh họa (KHÔNG phải kết quả Gemini) ===== */
const SAMPLE = {
  title: 'Protecting Our Planet', level: 'B1',
  text: 'Protecting our planet requires a sustainable approach to the way we live. Small changes in our daily habits can help preserve natural resources and reduce pollution.\n\nGovernments and communities must work together to tackle climate change. Renewable energy, such as solar power, can lower emissions and make cities cleaner.'
};
const DEMO_DICT = {
  sustainable: { term: 'sustainable', pos: 'adjective', ipa: '/səˈsteɪnəbəl/', vi: 'bền vững', ctx: 'Có thể duy trì lâu dài mà không làm cạn kiệt tài nguyên hay gây hại môi trường.', defEn: 'Able to continue for a long time without causing damage.', exEn: 'We need sustainable solutions to protect the environment.', exVi: 'Chúng ta cần các giải pháp bền vững để bảo vệ môi trường.', syn: ['viable', 'lasting'], forms: 'sustain, sustainability' },
  preserve: { term: 'preserve', pos: 'verb', ipa: '/prɪˈzɜːv/', vi: 'bảo tồn, gìn giữ', ctx: 'Giữ cho tài nguyên thiên nhiên không bị mất đi.', defEn: 'To keep something in its original or good condition.', exEn: 'We must preserve our forests.', exVi: 'Chúng ta phải bảo tồn các khu rừng.', syn: ['protect', 'conserve'], forms: 'preservation' },
  reduce: { term: 'reduce', pos: 'verb', ipa: '/rɪˈdjuːs/', vi: 'giảm', ctx: 'Làm cho mức ô nhiễm ít đi.', defEn: 'To make something smaller or less.', exEn: 'Cycling can reduce traffic.', exVi: 'Đi xe đạp có thể giảm giao thông.', syn: ['decrease', 'cut'], forms: 'reduction' },
  tackle: { term: 'tackle', pos: 'verb', ipa: '/ˈtækəl/', vi: 'giải quyết, xử lý', ctx: 'Bắt tay giải quyết một vấn đề khó.', defEn: 'To try to deal with a difficult problem.', exEn: 'The city plans to tackle air pollution.', exVi: 'Thành phố dự định giải quyết ô nhiễm không khí.', syn: ['address', 'handle'], forms: '' },
  renewable: { term: 'renewable', pos: 'adjective', ipa: '/rɪˈnjuːəbəl/', vi: 'có thể tái tạo', ctx: 'Nguồn năng lượng không bị cạn kiệt.', defEn: 'Able to be replaced naturally.', exEn: 'Wind is a renewable resource.', exVi: 'Gió là nguồn tài nguyên tái tạo.', syn: [], forms: 'renew' },
  emissions: { term: 'emissions', pos: 'noun', ipa: '/ɪˈmɪʃənz/', vi: 'khí thải', ctx: 'Lượng khí thải ra môi trường.', defEn: 'Gases sent into the air.', exEn: 'Cars produce emissions.', exVi: 'Xe hơi thải ra khí thải.', syn: ['discharge'], forms: 'emit' }
};

/* ===== Gọi backend (Gemini nằm ở server, không có API key ở đây) ===== */
async function api(path, body) {
  const r = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Lỗi máy chủ (' + r.status + ')');
  return d;
}

/* ===== Trạng thái ===== */
const S = {
  passages: store.get('lr_passages', []),
  saved: store.get('lr_saved', []),
  cur: null, tokens: [], sel: new Set(), mode: 'none', phrase: '', phraseRes: null, busy: false,
  inMode: 'paste', file: null, cache: {}, card: { list: [], i: 0, flip: false, done: 0, known: 0 }
};
const persist = () => { store.set('lr_passages', S.passages); store.set('lr_saved', S.saved); };
const isSaved = w => S.saved.some(x => x.term.toLowerCase() === w.toLowerCase());

/* ===== Router ===== */
const routes = { '': home, new: newView, read: readView, vocab: vocabView, review: reviewView, quiz: quizView };
function route() {
  pron.stop(); hideBar();
  const [, name = '', id] = location.hash.split('/');
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === (name || 'home') || (name === 'read' && a.dataset.nav === 'new')));
  (routes[name] || home)(id);
}
addEventListener('hashchange', route);

/* ===== Trang chủ ===== */
function home() {
  const n = S.passages.length, learned = S.saved.filter(x => x.status === 'known').length;
  const pct = S.saved.length ? Math.round(learned / S.saved.length * 100) : 0;
  $('#view').innerHTML = `
  <h1>Học tiếng Anh qua bài đọc</h1><p class="sub">Dán bài đọc, nhấp vào từ để xem nghĩa, IPA và nghe phát âm.</p>
  <div class="row"><a class="btn p" href="#/new">+ Tạo bài đọc mới</a></div>
  <div class="grid g3">
    <div class="card stat"><b>${n}</b><span>Bài đọc</span></div>
    <div class="card stat"><b>${S.saved.length}</b><span>Từ đã lưu</span></div>
    <div class="card stat"><b>${pct}%</b><span>Từ đã nhớ</span></div>
  </div>
  <h2 style="margin-top:28px">Bài đọc gần đây</h2>
  <div class="card">${n ? `<div class="list">${S.passages.slice(0, 5).map(p => `
    <div class="item"><a href="#/read/${p.id}"><b>${esc(p.title)}</b> <span class="badge">${esc(p.level)}</span><div class="sub" style="margin:0">${p.wordCount} từ</div></a>
    <button class="btn sm d" data-del="${p.id}">Xóa</button></div>`).join('')}</div>`
    : `<p>Chưa có bài đọc nào.</p><a class="btn p" href="#/new">Bắt đầu với bài đọc đầu tiên</a>`}</div>
  <h2 style="margin-top:28px">Cách dùng nhanh</h2>
  <div class="card"><p style="margin:0">Dán hoặc tải bài đọc, phân tích, nhấp vào từ để tra. Giữ Ctrl/Cmd để chọn nhiều từ, bôi đen câu để dịch, rồi lưu từ và ôn bằng flashcard.</p></div>`;
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { S.passages = S.passages.filter(p => p.id !== b.dataset.del); persist(); home(); });
}

/* ===== Nhập bài đọc ===== */
function newView() {
  $('#view').innerHTML = `
  <h1>Bài đọc mới</h1><p class="sub">Chọn cách nhập nội dung.</p>
  <div class="tabs">
    <button class="tab" data-m="paste"><b>Dán văn bản</b><small>Nhập nội dung bài đọc</small></button>
    <button class="tab" data-m="file"><b>Tải tệp lên</b><small>PDF, DOCX, DOC, TXT</small></button>
  </div>
  <div class="card">
    <div class="row"><input id="title" class="grow" placeholder="Tiêu đề bài đọc" aria-label="Tiêu đề">
      <select id="level" aria-label="Trình độ"><option>A2</option><option selected>B1</option><option>B2</option><option>C1</option></select>
      <select disabled aria-label="Ngôn ngữ dịch"><option>Dịch sang tiếng Việt</option></select></div>
    <div id="in"></div>
    <div id="status"></div>
    <div class="row"><button id="go" class="btn p">✨ Phân tích bài đọc bằng AI</button><button id="demo" class="btn">Dùng bài mẫu</button><button id="clr" class="btn">Xóa nội dung</button>
    <span id="cnt" style="color:var(--mut);margin-left:auto"></span></div>
  </div>`;
  const setMode = m => {
    S.inMode = m;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.m === m));
    $('#in').innerHTML = m === 'paste'
      ? '<textarea id="txt" placeholder="Dán bài đọc tiếng Anh của bạn tại đây..." aria-label="Nội dung"></textarea>'
      : `<div class="drop" id="drop" tabindex="0">Kéo thả tệp vào đây hoặc bấm để chọn (tối đa 10 MB)<input id="f" type="file" hidden accept=".pdf,.docx,.doc,.txt"></div><div id="fi"></div>`;
    if (m === 'paste') $('#txt').oninput = count; else bindDrop();
    count();
  };
  const count = () => { const t = $('#txt'); $('#cnt').textContent = t ? `${wc(t.value)} từ · ${t.value.length} ký tự` : ''; };
  function bindDrop() {
    const d = $('#drop'), f = $('#f');
    d.onclick = () => f.click(); d.onkeydown = e => e.key === 'Enter' && f.click();
    d.ondragover = e => { e.preventDefault(); d.classList.add('over'); };
    d.ondragleave = () => d.classList.remove('over');
    d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); pick(e.dataTransfer.files[0]); };
    f.onchange = () => pick(f.files[0]);
    showFile();
  }
  function pick(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'doc', 'txt'].includes(ext)) return msg('Chỉ hỗ trợ PDF, DOCX, DOC và TXT.', 'err');
    if (file.size > 10 * 1024 * 1024) return msg('Tệp vượt quá 10 MB.', 'err');
    S.file = file; msg(''); showFile();
  }
  function showFile() {
    const el = $('#fi'); if (!el) return;
    el.innerHTML = S.file ? `<div class="item"><span>${esc(S.file.name)} · ${(S.file.size / 1024).toFixed(0)} KB · ${esc(S.file.name.split('.').pop().toUpperCase())}</span><button class="btn sm d" id="rm">Xóa tệp</button></div>` : '';
    if (S.file) $('#rm').onclick = () => { S.file = null; showFile(); };
  }
  const msg = (t, k) => $('#status').innerHTML = t ? `<div class="msg ${k}" role="alert">${esc(t)}</div>` : '';
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => setMode(t.dataset.m));
  $('#clr').onclick = () => { S.file = null; const t = $('#txt'); if (t) t.value = ''; msg(''); showFile(); count(); };
  $('#demo').onclick = () => { setMode('paste'); $('#txt').value = SAMPLE.text; $('#title').value = SAMPLE.title; count(); };
  $('#go').onclick = analyze;
  setMode(S.inMode);

  async function analyze() {
    const level = $('#level').value, btn = $('#go'); let title = $('#title').value.trim(), text = '', fileB64 = null;
    if (S.inMode === 'paste') { text = $('#txt').value.trim(); if (!text) return msg('Hãy dán nội dung bài đọc.', 'err'); if (text.length > 20000) return msg('Bài đọc quá dài (tối đa 20.000 ký tự).', 'err'); }
    else {
      if (!S.file) return msg('Hãy chọn một tệp.', 'err');
      if (S.file.name.toLowerCase().endsWith('.txt')) text = (await S.file.text()).trim();
      else fileB64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(S.file); });
      title = title || S.file.name.replace(/\.[^.]+$/, '');
    }
    btn.disabled = true; btn.textContent = 'Đang phân tích...'; msg('Đang gửi đến máy chủ...', 'ok');
    let p;
    try {
      const d = await api('analyze', { text, level, title, file: fileB64, fileName: S.file?.name });
      p = { id: uid(), title: d.title || title || 'Bài đọc mới', level, text: d.originalText || text, vocab: d.vocabulary || [], demo: false };
    } catch (e) {
      if (fileB64) { btn.disabled = false; btn.textContent = '✨ Phân tích bài đọc bằng AI'; return msg(e.message + ' — cần chạy backend để xử lý PDF/DOCX/DOC.', 'err'); }
      p = { id: uid(), title: title || 'Bài đọc mới', level, text, vocab: Object.values(DEMO_DICT), demo: true };
      toast('Chưa kết nối Gemini: đang ở chế độ demo.');
    }
    p.wordCount = wc(p.text); S.passages.unshift(p); persist(); location.hash = '#/read/' + p.id;
  }
}

/* ===== Trang đọc ===== */
function findEntry(w) {
  const k = w.toLowerCase();
  return S.cur.vocab.find(v => v.term?.toLowerCase() === k || v.lemma?.toLowerCase() === k) || S.cache[k] || (DEMO_DICT[k] && S.cur.demo ? DEMO_DICT[k] : null);
}
function readView(id) {
  const p = S.passages.find(x => x.id === id);
  if (!p) return (location.hash = '#/new');
  S.cur = p; S.tokens = tokenize(p.text); S.sel.clear(); S.mode = 'none';
  const mins = Math.max(1, Math.round(p.wordCount / 180));
  $('#view').innerHTML = `
  <div class="read"><article class="card">
    <h1>${esc(p.title)}</h1>
    <div class="meta"><span class="badge">${esc(p.level)}</span><span>${p.wordCount} từ</span><span>~${mins} phút đọc</span>
      <a class="btn sm p" href="#/quiz/${p.id}">📝 Tạo đề đọc hiểu</a><button class="btn sm" id="play">🎧 Nghe bài đọc</button><button class="btn sm" id="pz">⏸</button><button class="btn sm" id="st">⏹</button>
      <select id="rate" aria-label="Tốc độ"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option></select>
      <select id="lang" aria-label="Giọng"><option>en-US</option><option>en-GB</option></select></div>
    ${p.demo ? '<div class="msg ok">Chế độ demo: dữ liệu từ vựng là dữ liệu minh họa, chưa phải kết quả từ Gemini.</div>' : ''}
    <div class="text" id="text"></div></article>
    <aside class="card panel" id="panel" aria-live="polite"></aside></div>`;
  renderText(); renderPanel();
  $('#play').onclick = () => pron.speak(p.text);
  $('#pz').onclick = () => { speechSynthesis.paused ? pron.resume() : pron.pause(); };
  $('#st').onclick = () => pron.stop();
  $('#rate').onchange = e => pron.rate = +e.target.value;
  $('#lang').onchange = e => pron.lang = e.target.value;
  const t = $('#text');
  t.onclick = e => {
    const el = e.target.closest('.w'); if (!el || !getSelection().isCollapsed) return;
    const i = +el.dataset.i;
    if (e.ctrlKey || e.metaKey) S.sel.has(i) ? S.sel.delete(i) : S.sel.add(i);
    else if (S.sel.has(i) && S.sel.size === 1) S.sel.delete(i); else { S.sel.clear(); S.sel.add(i); }
    S.mode = S.sel.size === 0 ? 'none' : S.sel.size === 1 ? 'word' : 'multi'; S.phrase = '';
    refresh(); if (S.mode === 'word') lookup(S.tokens[[...S.sel][0]]);
  };
  t.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.click(); } };
  t.onmouseup = t.ontouchend = () => setTimeout(() => {
    const s = getSelection(), txt = s.toString().trim();
    if (!txt || s.isCollapsed || !t.contains(s.anchorNode)) return;
    S.sel.clear(); S.mode = 'phrase'; S.phrase = txt.replace(/\s+/g, ' '); S.phraseRes = null; refresh();
  }, 0);
}
function renderText() {
  const paras = S.cur.text.split(/\n{2,}/); let pos = 0, html = '';
  for (const para of paras) {
    const idx = S.cur.text.indexOf(para, pos); pos = idx + para.length;
    html += '<p>';
    for (const t of S.tokens.filter(t => t.start >= idx && t.end <= idx + para.length)) {
      if (!t.word) { html += esc(t.s); continue; }
      const e = findEntry(t.s), c = ['w', e && 'v', S.sel.has(t.i) && 'sel', isSaved(t.s) && 'sv'].filter(Boolean).join(' ');
      html += `<span class="${c}" data-i="${t.i}" tabindex="0" role="button">${esc(t.s)}</span>`;
    }
    html += '</p>';
  }
  $('#text').innerHTML = html;
}
function sentenceOf(t) {
  const txt = S.cur.text, a = Math.max(txt.lastIndexOf('.', t.start - 1), txt.lastIndexOf('\n', t.start - 1)) + 1;
  let b = txt.slice(t.end).search(/[.!?\n]/); b = b < 0 ? txt.length : t.end + b + 1;
  return txt.slice(a, b).trim();
}
async function lookup(t) {
  if (!t) return; // Đã thêm kiểm tra guard clause
  if (findEntry(t.s)) return renderPanel();
  S.busy = true; renderPanel();
  try { S.cache[t.s.toLowerCase()] = await api('lookup', { word: t.s, sentence: sentenceOf(t) }); }
  catch (e) { S.cache[t.s.toLowerCase()] = { error: 'Chưa có dữ liệu cho từ này. ' + (S.cur.demo ? 'Hãy chạy backend và đặt GEMINI_API_KEY để tra mọi từ.' : e.message) }; }
  S.busy = false; renderPanel(); renderText();
}
function refresh() { renderText(); renderPanel(); bar(); }
const selWords = () => [...S.sel].sort((a, b) => a - b).map(i => S.tokens[i].s);
function card(e, word) {
  if (!e) return `<p>Không có dữ liệu.</p>`;
  if (e.error) return `<h3>${esc(word)}</h3><p>${esc(e.error)}</p>`;
  return `<div class="row" style="justify-content:space-between;margin-top:0"><h3>${esc(e.term || word)}</h3><button class="btn sm" data-say="${esc(e.term || word)}" aria-label="Phát âm">🔊</button></div>
  <div class="ipa">${esc(e.ipa || '')} · ${esc(e.pos || '')}</div><div class="vi">${esc(e.vi)}</div><p style="color:var(--mut);margin:0">${esc(e.ctx || '')}</p>
  ${e.defEn ? `<p><small>${esc(e.defEn)}</small></p>` : ''}
  ${e.exEn ? `<div class="ex"><small>VÍ DỤ</small><div>${esc(e.exEn)}</div><small>${esc(e.exVi || '')}</small></div>` : ''}
  ${e.syn?.length ? `<div class="chips ex"><small>Đồng nghĩa:</small> ${e.syn.map(s => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
  ${e.forms ? `<div class="ex"><small>Dạng liên quan: ${esc(e.forms)}</small></div>` : ''}
  <div class="row"><button class="btn p grow" data-save="${esc(e.term || word)}">${isSaved(e.term || word) ? '✓ Đã lưu' : '🔖 Lưu từ vựng'}</button></div>`;
}
function renderPanel() {
  const el = $('#panel'); if (!el) return;
  if (S.mode === 'word') {
    const w = selWords()[0];
    el.innerHTML = S.busy ? '<p>Đang tra từ...</p>' : card(findEntry(w), w);
  } else if (S.mode === 'multi') {
    el.innerHTML = `<h2>${S.sel.size} từ đã chọn</h2><div class="list">${selWords().map(w => { const e = findEntry(w);
      return `<div class="item"><div><b>${esc(w)}</b> <small>${esc(e?.ipa || '')}</small><div>${esc(e?.vi || 'Chưa có dữ liệu')}</div></div><button class="btn sm" data-say="${esc(w)}">🔊</button></div>`; }).join('')}</div>
      <p style="color:var(--mut);font-size:14px">Các từ được xử lý riêng, không ghép thành cụm.</p>`;
  } else if (S.mode === 'phrase') {
    const r = S.phraseRes;
    el.innerHTML = `<h2>Dịch và giải thích</h2><p><i>“${esc(S.phrase)}”</i></p><button class="btn sm" data-say="${esc(S.phrase)}">🔊 Nghe</button>
      ${r === 'loading' ? '<p>Đang dịch...</p>' : r?.error ? `<div class="msg err">${esc(r.error)}</div>` : r ? `<div class="vi">${esc(r.translation)}</div><p style="color:var(--mut)">${esc(r.explanation || '')}</p>` : '<p style="color:var(--mut)">Bấm “Dịch cụm từ” trên thanh công cụ.</p>'}`;
  } else el.innerHTML = '<p style="color:var(--mut)">Nhấp vào một từ để xem nghĩa. Giữ Ctrl/Cmd để chọn nhiều từ. Bôi đen cụm từ hoặc câu để dịch.</p>';
  el.querySelectorAll('[data-say]').forEach(b => b.onclick = () => pron.speak(b.dataset.say));
  el.querySelectorAll('[data-save]').forEach(b => b.onclick = () => { saveWords([b.dataset.save]); renderPanel(); renderText(); });
}
function saveWords(words) {
  let n = 0;
  for (const w of words) {
    const e = findEntry(w); if (!e || e.error || isSaved(w)) continue;
    S.saved.push({ id: uid(), term: e.term || w, ipa: e.ipa, vi: e.vi, pos: e.pos, exEn: e.exEn, exVi: e.exVi, source: S.cur.title, level: S.cur.level, date: new Date().toISOString().slice(0, 10), status: 'new', note: '' }); n++;
  }
  persist(); toast(n ? `Đã lưu ${n} từ.` : 'Không có từ mới để lưu (chưa có dữ liệu hoặc đã lưu).');
}
/* Thanh công cụ nổi */
function bar() {
  const b = $('#bar');
  if (S.mode === 'none') return hideBar();
  b.hidden = false;
  b.innerHTML = (S.mode === 'phrase' ? '<button class="btn sm" data-a="tr">Dịch cụm từ</button>' : '<button class="btn sm" data-a="look">Tra nghĩa</button>') +
    '<button class="btn sm" data-a="say">🔊 Nghe</button>' + (S.mode !== 'phrase' ? '<button class="btn sm" data-a="save">Lưu các từ đã chọn</button>' : '') + '<button class="btn sm" data-a="clr">Bỏ chọn</button>';
  b.onclick = async e => {
    const a = e.target.dataset.a; if (!a) return;
    if (a === 'clr') { S.sel.clear(); S.mode = 'none'; getSelection().removeAllRanges(); refresh(); }
    if (a === 'say') pron.speak(S.mode === 'phrase' ? S.phrase : selWords().join(', '));
    if (a === 'save') { saveWords(selWords()); refresh(); }
    if (a === 'look') { for (const i of S.sel) await lookup(S.tokens[i]); renderPanel(); }
    if (a === 'tr') {
      S.phraseRes = 'loading'; renderPanel();
      try { S.phraseRes = await api('translate', { text: S.phrase }); }
      catch (err) { S.phraseRes = { error: 'Không dịch được: ' + err.message + (S.cur.demo ? ' (cần backend Gemini)' : '') }; }
      renderPanel();
    }
  };
}
const hideBar = () => { const b = $('#bar'); if (b) b.hidden = true; };

/* ===== Từ vựng của tôi ===== */
function vocabView() {
  $('#view').innerHTML = `<h1>Từ vựng của tôi</h1><p class="sub">${S.saved.length} từ đã lưu.</p>
  <div class="row"><input id="q" class="grow" placeholder="Tìm từ..." aria-label="Tìm từ"><select id="fs" aria-label="Trạng thái"><option value="">Mọi trạng thái</option><option value="new">Chưa nhớ</option><option value="known">Đã nhớ</option></select>
  <select id="so" aria-label="Sắp xếp"><option value="date">Mới nhất</option><option value="az">A–Z</option></select><button class="btn" id="csv">Xuất CSV</button><a class="btn p" href="#/review">Ôn tập</a></div>
  <div class="card table-wrap"><table><thead><tr><th>Từ</th><th>IPA</th><th>Nghĩa</th><th>Loại</th><th>Bài đọc</th><th>Ngày</th><th>Trạng thái</th><th>Ghi chú</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase(), fs = $('#fs').value;
    let l = S.saved.filter(x => x.term.toLowerCase().includes(q) && (!fs || x.status === fs));
    l = $('#so').value === 'az' ? l.sort((a, b) => a.term.localeCompare(b.term)) : l.slice().reverse();
    $('#tb').innerHTML = l.length ? l.map(x => `<tr><td><b>${esc(x.term)}</b></td><td>${esc(x.ipa)}</td><td>${esc(x.vi)}</td><td>${esc(x.pos)}</td><td>${esc(x.source)}</td><td>${esc(x.date)}</td><td>${x.status === 'known' ? 'Đã nhớ' : 'Chưa nhớ'}</td><td>${esc(x.note)}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-s="${x.id}">🔊</button> <button class="btn sm" data-n="${x.id}">Ghi chú</button> <button class="btn sm d" data-d="${x.id}">Xóa</button></td></tr>`).join('') : '<tr><td colspan="9">Chưa có từ nào. Hãy mở một bài đọc và lưu từ.</td></tr>';
    $('#tb').querySelectorAll('[data-s]').forEach(b => b.onclick = () => pron.speak(S.saved.find(x => x.id === b.dataset.s).term));
    $('#tb').querySelectorAll('[data-d]').forEach(b => b.onclick = () => { S.saved = S.saved.filter(x => x.id !== b.dataset.d); persist(); vocabView(); });
    $('#tb').querySelectorAll('[data-n]').forEach(b => b.onclick = () => { const x = S.saved.find(x => x.id === b.dataset.n), n = prompt('Ghi chú cá nhân:', x.note); if (n !== null) { x.note = n; persist(); draw(); } });
  };
  ['q', 'fs', 'so'].forEach(i => $('#' + i).oninput = draw); draw();
  $('#csv').onclick = () => {
    const rows = [['term', 'ipa', 'meaning', 'pos', 'source', 'date', 'status', 'note'], ...S.saved.map(x => [x.term, x.ipa, x.vi, x.pos, x.source, x.date, x.status, x.note])];
    const csv = '\ufeff' + rows.map(r => r.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'vocabulary.csv'; a.click();
  };
}

/* ===== Ôn tập flashcard ===== */
function reviewView() {
  const c = S.card;
  if (!c.list.length) { c.list = S.saved.slice(); c.i = 0; c.flip = false; c.done = 0; c.known = 0; }
  const v = $('#view');
  if (!S.saved.length) return v.innerHTML = '<h1>Ôn tập</h1><div class="card"><p>Bạn chưa lưu từ nào.</p><a class="btn p" href="#/new">Tạo bài đọc</a></div>';
  if (c.i >= c.list.length) {
    v.innerHTML = `<h1>Hoàn thành</h1><div class="card"><p>Đã ôn ${c.done} từ, nhớ ${c.known} từ.</p><button class="btn p" id="again">Ôn lại</button></div>`;
    return $('#again').onclick = () => { c.list = []; reviewView(); };
  }
  const x = c.list[c.i];
  v.innerHTML = `<h1>Ôn tập</h1><p class="sub">Thẻ ${c.i + 1}/${c.list.length}</p>
  <div class="card flash" id="fc" tabindex="0" role="button" aria-label="Lật thẻ">${c.flip
    ? `<div class="ipa">${esc(x.ipa)} · ${esc(x.pos)}</div><div class="big" style="font-size:26px">${esc(x.vi)}</div><div>${esc(x.exEn || '')}</div><small>${esc(x.exVi || '')}</small>`
    : `<div class="big">${esc(x.term)}</div><small>Bấm để lật thẻ</small>`}</div>
  <div class="row" style="justify-content:center"><button class="btn" id="hr">🔊 Nghe</button><button class="btn d" id="no">Chưa nhớ</button><button class="btn p" id="yes">Đã nhớ</button></div>`;
  $('#fc').onclick = () => { c.flip = !c.flip; reviewView(); };
  $('#hr').onclick = () => pron.speak(x.term);
  const mark = k => { x.status = k ? 'known' : 'new'; c.done++; c.known += k; c.i++; c.flip = false; persist(); reviewView(); };
  $('#no').onclick = () => mark(0); $('#yes').onclick = () => mark(1);
}


/* ===== Đề đọc hiểu trắc nghiệm ===== */
const QZ = store.get('lr_quiz', {});
const qsave = () => store.set('lr_quiz', QZ);
const wrapWords = str => tokenize(str).map(t => t.word ? `<span class="qw" tabindex="0">${esc(t.s)}</span>` : esc(t.s)).join('');
// Dữ liệu minh họa: chỉ dùng khi chưa có backend, chỉ cho bài mẫu
const DEMO_QUIZ = [
  { id: 'q1', question: 'What is the main idea of the passage?', options: ['People and governments can act in different ways to protect the environment.', 'Solar power is the single most effective solution to every environmental problem.', 'Daily habits have no real effect on pollution or natural resources.', 'Climate change is a problem that only governments are able to solve.'], correct: 'A', explanation: 'The passage mentions both small personal changes and government and community action.', evidence: 'Small changes in our daily habits can help preserve natural resources and reduce pollution.', explanationVi: 'Bài nói đến cả thay đổi nhỏ của cá nhân lẫn hành động của chính phủ và cộng đồng.', why: ['Supported by both paragraphs.', 'Solar power is only one example.', 'The passage says habits can help.', 'Governments and communities must work together.'] },
  { id: 'q2', question: 'According to the passage, what can small changes in daily habits help do?', options: ['Preserve natural resources and reduce pollution.', 'Increase emissions from large cities.', 'Replace the need for renewable energy.', 'Make governments work less on climate change.'], correct: 'A', explanation: 'The first paragraph states this directly.', evidence: 'Small changes in our daily habits can help preserve natural resources and reduce pollution.', explanationVi: 'Đoạn đầu nêu trực tiếp điều này.', why: ['Stated directly.', 'Not mentioned.', 'Not mentioned.', 'Not mentioned.'] },
  { id: 'q3', question: 'In the passage, the word “tackle” is closest in meaning to:', options: ['deal with', 'ignore', 'avoid', 'postpone'], correct: 'A', explanation: 'To tackle a problem means to try to deal with it.', evidence: 'Governments and communities must work together to tackle climate change.', explanationVi: '“Tackle” nghĩa là giải quyết một vấn đề.', why: ['Correct meaning.', 'Opposite meaning.', 'Opposite meaning.', 'Not suggested.'] }
];
const demoPublic = () => ({ quizId: 'demo', title: 'Reading Comprehension Quiz (demo)', level: 'B1', questionCount: 3, questions: DEMO_QUIZ.map(q => ({ id: q.id, type: 'single_choice', question: q.question, options: q.options.map((t, i) => ({ id: 'ABCD'[i], text: t })) })) });
function demoGrade(ans) {
  let correct = 0, wrong = 0, blank = 0;
  const details = DEMO_QUIZ.map(q => { const c = ans[q.id], ok = c === q.correct; if (!c) blank++; else ok ? correct++ : wrong++;
    return { id: q.id, chosen: c || null, correct: q.correct, isCorrect: ok, explanation: q.explanation, evidence: q.evidence, explanationVi: q.explanationVi, optionExplanations: Object.fromEntries(q.why.map((w, i) => ['ABCD'[i], w])) }; });
  const total = DEMO_QUIZ.length;
  return { total, correct, wrong, blank, percent: Math.round(correct / total * 100), score: Math.round(correct / total * 1000) / 100, details };
}
function quizView(id) {
  const p = S.passages.find(x => x.id === id); if (!p) return (location.hash = '#/new');
  S.cur = p; S.tokens = tokenize(p.text); S.mode = 'none';
  const z = QZ[id];
  if (!z?.quiz) return quizConfig(p);
  z.result ? quizResult(p, z) : quizTake(p, z);
}
function quizConfig(p) {
  const paras = p.text.split(/\n{2,}/).filter(x => x.trim());
  let count = 5;
  $('#view').innerHTML = `<h1>Tạo đề đọc hiểu</h1><p class="sub">${esc(p.title)} · câu hỏi chỉ dựa trên nội dung bài đọc.</p>
  <div class="card"><b>Số câu hỏi</b><div class="row" id="cnt" role="radiogroup" aria-label="Số câu hỏi">${[1,2,3,4,5,6,7,8,9,10].map(n => `<button class="btn sm ${n === 5 ? 'p' : ''}" data-n="${n}" role="radio">${n}</button>`).join('')}</div>
  <div class="row"><label>Trình độ <select id="ql">${['A2','B1','B2','C1'].map(l => `<option ${l === p.level ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  <label>Ngôn ngữ câu hỏi <select id="qg"><option value="en">Tiếng Anh</option><option value="vi">Tiếng Việt</option></select></label>
  <label>Độ khó <select id="qd"><option value="easy">Dễ</option><option value="medium" selected>Trung bình</option><option value="hard">Khó</option></select></label>
  <label>Phạm vi <select id="qs"><option value="-1">Toàn bộ bài đọc</option>${paras.map((t, i) => `<option value="${i}">Đoạn ${i + 1}: ${esc(t.slice(0, 40))}…</option>`).join('')}</select></label></div>
  <div id="qst"></div><div class="row"><button class="btn p" id="gen">✨ Tạo đề đọc hiểu bằng AI</button><a class="btn" href="#/read/${p.id}">Quay lại bài đọc</a></div></div>`;
  $('#cnt').onclick = e => { const b = e.target.closest('[data-n]'); if (!b) return; count = +b.dataset.n; document.querySelectorAll('#cnt .btn').forEach(x => x.classList.toggle('p', x === b)); };
  const msg = (t, k) => $('#qst').innerHTML = t ? `<div class="msg ${k}" role="alert">${esc(t)}</div>` : '';
  $('#gen').onclick = async () => {
    const btn = $('#gen'), si = +$('#qs').value, text = si < 0 ? p.text : paras[si];
    btn.disabled = true; btn.textContent = 'Đang tạo và kiểm tra đề...'; msg('');
    try {
      let quiz;
      if (p.demo) {
        if (p.text !== SAMPLE.text) throw new Error('Chế độ demo chỉ có đề mẫu cho bài mẫu. Hãy chạy backend Gemini để tạo đề cho bài của bạn.');
        if (count > 3) throw new Error('Đề demo chỉ có 3 câu. Hãy chọn tối đa 3 câu hoặc chạy backend.');
        quiz = demoPublic(); quiz.questions = quiz.questions.slice(0, count); quiz.questionCount = count;
      } else quiz = await api('quiz', { text, count, level: $('#ql').value, lang: $('#qg').value, difficulty: $('#qd').value, title: p.title });
      QZ[p.id] = { quiz, answers: {}, start: Date.now(), result: null }; qsave(); quizView(p.id);
    } catch (e) { msg(e.message, 'err'); btn.disabled = false; btn.textContent = '✨ Tạo đề đọc hiểu bằng AI'; }
  };
}
function bindLookup(root) {
  const pop = $('#qpop');
  root.addEventListener('click', async e => {
    const el = e.target.closest('.qw'); if (!el) return;
    e.preventDefault(); const w = el.textContent;
    pop.hidden = false; pop.innerHTML = '<p>Đang tra từ...</p>';
    if (!findEntry(w)) { try { S.cache[w.toLowerCase()] = await api('lookup', { word: w, sentence: el.closest('[data-ctx]')?.dataset.ctx || w }); } catch (er) { S.cache[w.toLowerCase()] = { error: 'Chưa có dữ liệu cho từ này.' }; } }
    pop.innerHTML = `<button class="btn sm" id="xp" style="float:right" aria-label="Đóng">✕</button>` + card(findEntry(w), w);
    $('#xp').onclick = () => pop.hidden = true;
    pop.querySelectorAll('[data-say]').forEach(b => b.onclick = () => pron.speak(b.dataset.say));
    pop.querySelectorAll('[data-save]').forEach(b => b.onclick = () => { saveWords([b.dataset.save]); b.textContent = '✓ Đã lưu'; });
  });
}
function quizTake(p, z) {
  const Q = z.quiz.questions, n = Q.length;
  const passage = p.text.split(/\n{2,}/).map(t => `<p data-ctx="${esc(t.slice(0, 300))}">${wrapWords(t)}</p>`).join('');
  $('#view').innerHTML = `<h1>${esc(z.quiz.title || 'Reading Comprehension Quiz')}</h1>
  <div class="meta"><span class="badge">${esc(z.quiz.level)}</span><span>${n} câu</span><span id="pg"></span><a href="#/read/${p.id}">← Về trang đọc</a></div>
  <progress id="pb" max="${n}" value="0" style="width:100%" aria-label="Tiến độ"></progress>
  <div class="row" id="qn">${Q.map((q, i) => `<button class="btn sm" data-go="${q.id}">${i + 1}</button>`).join('')}</div>
  <div class="read quiz"><aside class="card qpass"><h2>Bài đọc</h2><div class="text">${passage}</div></aside>
  <div class="grid">${Q.map((q, i) => `<section class="card" id="${q.id}" data-ctx="${esc(q.question)}"><b>${i + 1}.</b> ${wrapWords(q.question)}
    <div class="list" role="radiogroup">${q.options.map(o => `<label class="opt"><input type="radio" name="${q.id}" value="${o.id}" ${z.answers[q.id] === o.id ? 'checked' : ''}><b>${o.id}.</b><span>${wrapWords(o.text)}</span></label>`).join('')}</div></section>`).join('')}
  <div class="row"><button class="btn p" id="sub">Nộp bài</button></div><div id="qe"></div></div></div><div class="card pop" id="qpop" hidden></div>`;
  const upd = () => { const a = Object.keys(z.answers).length; $('#pb').value = a; $('#pg').textContent = `Đã trả lời ${a} · Chưa trả lời ${n - a}`;
    document.querySelectorAll('#qn .btn').forEach(b => b.classList.toggle('p', !!z.answers[b.dataset.go])); };
  upd(); bindLookup($('#view'));
  $('#qn').onclick = e => { const g = e.target.dataset.go; if (g) $('#' + g).scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  $('#view').addEventListener('change', e => { if (e.target.type === 'radio') { z.answers[e.target.name] = e.target.value; qsave(); upd(); } });
  $('#sub').onclick = async () => {
    const blank = n - Object.keys(z.answers).length;
    if (blank && !confirm(`Còn ${blank} câu chưa trả lời. Bạn vẫn muốn nộp bài?`)) return;
    $('#sub').disabled = true; $('#sub').textContent = 'Đang chấm...';
    try {
      const r = z.quiz.quizId === 'demo' ? demoGrade(z.answers) : await api('quiz/grade', { quizId: z.quiz.quizId, answers: z.answers });
      r.elapsed = Math.round((Date.now() - z.start) / 1000); z.result = r; z.showExp = false; qsave(); quizView(p.id);
    } catch (e) { $('#qe').innerHTML = `<div class="msg err" role="alert">${esc(e.message)}</div>`; $('#sub').disabled = false; $('#sub').textContent = 'Nộp bài'; }
  };
}
function quizResult(p, z) {
  const r = z.result, Q = Object.fromEntries(z.quiz.questions.map(q => [q.id, q]));
  const fmt = x => x.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const remark = r.score >= 9 ? 'Xuất sắc! Bạn nắm rất chắc nội dung bài đọc.' : r.score >= 7 ? 'Tốt. Hãy xem lại các câu sai để hoàn thiện.' : r.score >= 5 ? 'Khá. Đọc lại bài và xem phần bằng chứng của các câu sai.' : 'Cần ôn lại bài đọc và từ vựng trước khi làm lại.';
  const opt = (q, id) => { const o = q.options.find(x => x.id === id); return o ? `${id}. ${o.text}` : 'Bỏ trống'; };
  const wrong = r.details.filter(d => !d.isCorrect);
  const words = [...new Set(wrong.flatMap(d => { const q = Q[d.id]; return tokenize([q.question, ...q.options.map(o => o.text), d.evidence].join(' ')).filter(t => t.word).map(t => t.s.toLowerCase()); }))].filter(w => findEntry(w));
  $('#view').innerHTML = `<h1>Kết quả</h1>
  <div class="card"><div class="grid g3"><div class="stat"><b>${fmt(r.score)}/10</b><span>Điểm</span></div><div class="stat"><b>${r.correct}</b><span>Đúng</span></div><div class="stat"><b>${r.wrong}</b><span>Sai</span></div><div class="stat"><b>${r.blank}</b><span>Bỏ trống</span></div><div class="stat"><b>${r.percent}%</b><span>Tỷ lệ đúng</span></div><div class="stat"><b>${Math.floor(r.elapsed / 60)}:${String(r.elapsed % 60).padStart(2, '0')}</b><span>Thời gian</span></div></div>
  <p>${remark}</p><div class="row"><button class="btn p" id="ex">Xem lời giải</button><button class="btn" id="re">Làm lại bài</button><button class="btn" id="nw">Tạo đề mới</button><a class="btn" href="#/read/${p.id}">Về trang đọc</a></div></div>
  ${words.length ? `<div class="card" style="margin-top:16px"><h2>Từ vựng liên quan đến câu sai</h2><div class="chips">${words.map(w => `<span class="qw">${esc(w)}</span>`).join('')}</div><div class="row"><button class="btn p" id="rv">Ôn tập từ vựng liên quan</button></div></div>` : ''}
  <div id="exp" ${z.showExp ? '' : 'hidden'} class="grid" style="margin-top:16px">${r.details.map((d, i) => { const q = Q[d.id]; return `<section class="card" data-ctx="${esc(q.question)}"><b>${i + 1}.</b> ${wrapWords(q.question)}
    <p>Bạn chọn: <b>${esc(opt(q, d.chosen))}</b> — ${d.isCorrect ? '<span style="color:#0F766E">Đúng</span>' : `<span style="color:var(--err)">${d.chosen ? 'Sai' : 'Bỏ trống'}</span>`}<br>Đáp án đúng: <b>${esc(opt(q, d.correct))}</b></p>
    <p>${wrapWords(d.explanation)}</p><blockquote style="margin:8px 0;padding-left:12px;border-left:3px solid var(--acc)">${esc(d.evidence)}</blockquote><p style="color:var(--mut)">${esc(d.explanationVi)}</p>
    <details><summary>Vì sao các phương án khác không phù hợp</summary>${q.options.filter(o => o.id !== d.correct).map(o => `<p><b>${o.id}.</b> ${esc(d.optionExplanations?.[o.id] || '')}</p>`).join('')}</details></section>`; }).join('')}</div><div class="card pop" id="qpop" hidden></div>`;
  bindLookup($('#view'));
  $('#ex').onclick = () => { z.showExp = !z.showExp; $('#exp').hidden = !z.showExp; qsave(); };
  $('#re').onclick = () => { z.answers = {}; z.result = null; z.start = Date.now(); qsave(); quizView(p.id); };
  $('#nw').onclick = () => { delete QZ[p.id]; qsave(); quizView(p.id); };
  const rv = $('#rv'); if (rv) rv.onclick = () => {
    saveWords(words); S.card = { list: S.saved.filter(x => words.includes(x.term.toLowerCase())), i: 0, flip: false, done: 0, known: 0 };
    location.hash = '#/review';
  };
}

// Đã thêm hàm ép nạp lại danh sách giọng đọc cho thiết bị di động
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => { pron.voice(); };
}
route();