/* Workout Progress — Telegram Mini App. Без сборки и зависимостей. */
(function () {
  'use strict';

  /* ================= константы ================= */
  const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const WD_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  const SUGGEST = ['Приседания', 'Жим лёжа', 'Становая тяга', 'Жим стоя', 'Подтягивания', 'Тяга штанги в наклоне', 'Отжимания на брусьях', 'Выпады с гантелями'];
  const MAX_EX = 12;      // упражнений в день (ограничение размера записи Telegram Cloud: 4096 символов)
  const THRESH = 2;       // порог «без изменений», %
  const KEY_RE = /^(settings|plan|pd_[1-7]|d_\d{4}-\d{2}-\d{2})$/;
  const COLORS = { light: '#f5f5f2', dark: '#0e0f11' };

  /* ================= Telegram ================= */
  const tg = (window.Telegram && window.Telegram.WebApp) || null;
  const inTg = !!(tg && tg.initData);
  const cloudOK = inTg && !!tg.CloudStorage && (typeof tg.isVersionAtLeast !== 'function' || tg.isVersionAtLeast('6.9'));
  const tgUser = inTg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user.id : 'local';
  if (tg) { try { tg.ready(); tg.expand(); if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) { /* старый клиент */ } }

  /* ================= утилиты ================= */
  const $ = (s) => document.querySelector(s);
  const PROPS = new Set(['checked', 'disabled', 'selected', 'readOnly']);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (PROPS.has(k)) el[k] = !!v;
        else if (k === 'value') el.value = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const uid = () => Math.random().toString(36).slice(2, 9);
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => ymd(new Date());
  const weekdayOf = (s) => ((parseYmd(s).getDay() + 6) % 7) + 1; // 1 = Пн … 7 = Вс
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const fmtLong = (s) => cap(new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(parseYmd(s)));
  const fmtShort = (s) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(parseYmd(s)).replace('.', '');
  const fmt = (x, dp = 1) => String(Math.round(x * 10 ** dp) / 10 ** dp).replace('.', ',');
  const fmtInt = (x) => Math.round(x).toLocaleString('ru-RU');
  const plural = (n, a, b, c) => { const m = n % 100; if (m > 10 && m < 20) return c; const k = n % 10; return k === 1 ? a : (k >= 2 && k <= 4) ? b : c; };
  const normName = (s) => String(s || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  const P = (s) => { const t = String(s == null ? '' : s).trim().replace(',', '.'); return t === '' ? NaN : Number(t); };
  const str = (v) => (v == null ? '' : String(v).replace('.', ','));
  const clean = (v, dec) => (dec ? v.replace(/[^\d.,]/g, '') : v.replace(/\D/g, ''));
  const newEx = (n) => ({ id: uid(), n: n || '', w: '', r: '', s: '' });
  const toDraft = (x) => ({ id: uid(), n: x.n || '', w: str(x.w), r: str(x.r), s: str(x.s) });

  function buzz(kind) {
    if (!inTg || !tg.HapticFeedback || !getSettings().haptic) return;
    try {
      if (kind === 'success' || kind === 'error') tg.HapticFeedback.notificationOccurred(kind);
      else tg.HapticFeedback.selectionChanged();
    } catch (e) { /* ignore */ }
  }
  let toastT;
  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'show ' + (kind || 'ok');
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.className = ''; }, kind === 'ok' || !kind ? 2400 : 5200);
  }
  function ask(msg) {
    return new Promise((res) => {
      try {
        if (inTg && tg.showConfirm && tg.isVersionAtLeast && tg.isVersionAtLeast('6.2')) { tg.showConfirm(msg, (ok) => res(!!ok)); return; }
      } catch (e) { /* fallback */ }
      res(window.confirm(msg));
    });
  }
  async function busy(btn, text, fn) {
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = text; btn.classList.add('loading');
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; btn.classList.remove('loading'); }
  }
  function modal(title, body, actions) {
    const close = () => ov.remove();
    const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) close(); } },
      h('div', { class: 'sheet', role: 'dialog', 'aria-label': title }, h('h3', {}, title), body,
        h('div', { class: 'sheet-actions' }, actions.map((a) => h('button', { class: 'btn ' + (a.cls || ''), onclick: () => a.fn(close) }, a.label)))));
    document.body.append(ov);
    return close;
  }

  /* ================= хранилище =================
     recs: { ключ → {u: время изменения, ...данные} }
     Ключи: settings, plan, pd_1…pd_7 (упражнения дня плана), d_YYYY-MM-DD (запись тренировки).
     Копия лежит в localStorage; если приложение открыто в Telegram — ещё и в Telegram Cloud.
     При конфликте побеждает запись с большим u. */
  const LS_KEY = 'wp.v1.' + tgUser;
  const LS_UN = 'wp.unsynced.' + tgUser;
  let recs = {};
  let unsynced = new Set();
  let lastU = 0;
  const nowU = () => (lastU = Math.max(Date.now(), lastU + 1));
  const isOurKey = (k) => KEY_RE.test(k);

  function lsRead() {
    try {
      const o = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      const out = {};
      for (const k in o) if (isOurKey(k) && o[k] && typeof o[k].u === 'number') out[k] = o[k];
      return out;
    } catch (e) { return {}; }
  }
  function lsWrite() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(recs)); localStorage.setItem(LS_UN, JSON.stringify([...unsynced])); return true; } catch (e) { return false; }
  }
  function readUnsynced() { try { return new Set(JSON.parse(localStorage.getItem(LS_UN) || '[]')); } catch (e) { return new Set(); } }

  function cloud(method, ...args) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Нет ответа от Telegram Cloud')), 10000);
      try {
        tg.CloudStorage[method](...args, (err, val) => { clearTimeout(t); if (err) reject(new Error(String(err))); else resolve(val); });
      } catch (e) { clearTimeout(t); reject(e); }
    });
  }
  async function loadCloud() {
    if (!cloudOK) return;
    const keys = (await cloud('getKeys')).filter(isOurKey);
    const remote = {};
    for (let i = 0; i < keys.length; i += 40) {
      const vals = await cloud('getItems', keys.slice(i, i + 40));
      for (const k in vals) { if (vals[k]) { try { remote[k] = JSON.parse(vals[k]); } catch (e) { /* битая запись */ } } }
    }
    const push = [];
    for (const k in remote) if (!recs[k] || recs[k].u < remote[k].u) recs[k] = remote[k];
    for (const k in recs) if (!remote[k] || remote[k].u < recs[k].u) push.push(k);
    lsWrite();
    if (push.length) pushKeys(push); // досылаем то, что было записано офлайн
  }
  /** Записывает в облако. Возвращает 'ok' | 'fail' | 'none' (облака нет — браузер). */
  async function pushKeys(keys) {
    if (!cloudOK) return 'none';
    let failed = 0;
    for (const k of keys) {
      try {
        const s = JSON.stringify(recs[k]);
        if (s.length > 4000) throw new Error('Слишком большая запись');
        await cloud('setItem', k, s);
        unsynced.delete(k);
      } catch (e) { unsynced.add(k); failed++; }
    }
    lsWrite();
    return failed ? 'fail' : 'ok';
  }
  /** Сохраняет набор записей локально и в облако. */
  async function commit(pairs) {
    const keys = [];
    let local = true;
    for (const [k, data] of pairs) { data.u = nowU(); recs[k] = data; keys.push(k); if (cloudOK) unsynced.add(k); }
    local = lsWrite();
    const cl = await pushKeys(keys);
    return { local, cloud: cl };
  }
  function report(res, okMsg) {
    if (!res.local && res.cloud !== 'ok') { toast('Не удалось сохранить. Попробуйте ещё раз.', 'err'); buzz('error'); return false; }
    if (res.cloud === 'fail') { toast('Сохранено на устройстве, но записать в Telegram Cloud не удалось. Повторю при следующем запуске.', 'warn'); buzz('error'); return true; }
    toast(okMsg + (res.cloud === 'none' ? ' (на этом устройстве)' : ''), 'ok'); buzz('success'); return true;
  }

  /* ================= данные ================= */
  const getSettings = () => Object.assign({ theme: 'auto', haptic: true }, recs.settings || {});
  function getPlan() {
    const p = recs.plan;
    if (!p || !Array.isArray(p.d) || !p.d.length) return null;
    const days = p.d.filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
    const ex = {};
    days.forEach((d) => { ex[d] = ((recs['pd_' + d] || {}).e || []).map((x) => ({ n: x.n, w: x.w, r: x.r, s: x.s })); });
    return { days, ex };
  }
  function checkNum(x, bad) {
    let ok = true;
    const w = P(x.w), r = P(x.r), s = P(x.s);
    if (x.w.trim() !== '' && !(w >= 0 && w <= 1000)) { bad.add(x.id + 'w'); ok = false; }
    if (x.r.trim() !== '' && !(Number.isInteger(r) && r >= 1 && r <= 100)) { bad.add(x.id + 'r'); ok = false; }
    if (x.s.trim() !== '' && !(Number.isInteger(s) && s >= 1 && s <= 50)) { bad.add(x.id + 's'); ok = false; }
    return ok;
  }
  function validateDraft(days, exMap, bad) {
    let msg = '';
    for (const d of days) {
      const list = exMap[d] || [];
      const named = list.filter((x) => x.n.trim());
      list.forEach((x) => { if (!x.n.trim() && (x.w || x.r || x.s)) { bad.add(x.id + 'n'); msg = msg || 'Укажите название упражнения'; } });
      if (!named.length) { msg = msg || 'Добавьте хотя бы одно упражнение: ' + WD_FULL[d - 1]; if (list[0]) bad.add(list[0].id + 'n'); }
      named.forEach((x) => { if (!checkNum(x, bad)) msg = msg || 'Проверьте числа: вес до 1000 кг, повторы до 100, подходы до 50'; });
    }
    return { ok: !msg, msg };
  }
  const numOrNull = (v) => { const x = P(v); return Number.isNaN(x) ? null : x; };
  const draftToRec = (x) => ({ n: x.n.trim().slice(0, 40), w: numOrNull(x.w), r: numOrNull(x.r), s: numOrNull(x.s) });
  function savePlan(days, exMap) {
    const sorted = days.slice().sort((a, b) => a - b);
    const pairs = [['plan', { d: sorted }]];
    for (let d = 1; d <= 7; d++) {
      const list = sorted.includes(d) ? (exMap[d] || []).filter((x) => x.n.trim()).map(draftToRec) : [];
      if (!list.length && !recs['pd_' + d]) continue;
      pairs.push(['pd_' + d, { e: list }]);
    }
    return commit(pairs);
  }

  /* ================= аналитика =================
     Показатель упражнения:
       • вес > 0  → объём = вес × повторы × подходы (кг)
       • вес = 0  → «свой вес», показатель = повторы × подходы
     Показатели разных типов не сравниваются. Изменение < 2 % считается «без изменений».
     Сравнение «с прошлым разом» — с последней более ранней записью того же упражнения (по названию).
     Сравнение «с планом» — со значениями плана, зафиксированными в момент сохранения тренировки. */
  const metricOf = (w, r, s) => (w > 0 ? { w, r, s, type: 'kg', v: w * r * s } : { w: 0, r, s, type: 'reps', v: r * s });
  function curOf(o) {
    const w = P(o.w), r = P(o.r), s = P(o.s);
    if (!(w >= 0) || !(r >= 1) || !(s >= 1)) return null;
    return metricOf(w, r, s);
  }
  function planOf(it) {
    if (it.pw == null || !(it.pr >= 1) || !(it.ps >= 1)) return null;
    return metricOf(it.pw, it.pr, it.ps);
  }
  function compare(cur, ref) {
    if (!ref) return { st: 'none' };
    if (cur.type !== ref.type) return { st: 'mixed' };
    const d = ((cur.v - ref.v) / ref.v) * 100;
    if (Math.abs(d) < THRESH) return { st: 'same', d };
    return { st: d > 0 ? 'up' : 'down', d };
  }
  const descOf = (m) => (m.w > 0 ? fmt(m.w) + ' кг × ' : '') + m.r + ' × ' + m.s + (m.w > 0 ? '' : ' (свой вес)');
  const pct = (d) => (d > 0 ? '+' : '−') + fmt(Math.abs(d)) + '%';
  function historyIndex(beforeDate) {
    const idx = {};
    for (const k in recs) {
      if (k.slice(0, 2) !== 'd_') continue;
      const date = k.slice(2);
      if (date >= beforeDate) continue;
      for (const x of (recs[k].e || [])) {
        if (!x.k) continue;
        const c = curOf(x);
        if (!c) continue;
        (idx[normName(x.n)] = idx[normName(x.n)] || []).push(Object.assign({ date }, c));
      }
    }
    for (const n in idx) idx[n].sort((a, b) => (a.date < b.date ? -1 : 1));
    return idx;
  }
  function spark(vals) {
    const NS = 'http://www.w3.org/2000/svg';
    const W = 120, H = 34, p = 4;
    const min = Math.min(...vals), max = Math.max(...vals);
    const pts = vals.map((v, i) => [p + (i * (W - 2 * p)) / (vals.length - 1), max === min ? H / 2 : H - p - ((v - min) / (max - min)) * (H - 2 * p)]);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('aria-hidden', 'true');
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', pts.map((q) => q.join(',')).join(' '));
    line.setAttribute('fill', 'none'); line.setAttribute('stroke', 'var(--accent)'); line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round'); line.setAttribute('stroke-linejoin', 'round');
    const last = pts[pts.length - 1];
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', last[0]); dot.setAttribute('cy', last[1]); dot.setAttribute('r', '3.2'); dot.setAttribute('fill', 'var(--accent)');
    svg.append(line, dot);
    return svg;
  }

  /* ================= состояние интерфейса ================= */
  let view = 'loading';   // loading | error | wizard | main
  let tab = 'dash';       // dash | plan | settings
  let errMsg = '';
  let dash = null;        // форма дашборда
  let refs = {};          // элементы карточек упражнений дашборда
  let planDraft = null, planDirty = false, planBad = new Set();
  let wiz = null;

  function updateClosing() {
    if (!inTg) return;
    try {
      const need = (dash && dash.dirty) || planDirty || view === 'wizard';
      if (need) tg.enableClosingConfirmation(); else tg.disableClosingConfirmation();
    } catch (e) { /* ignore */ }
  }
  function resolvedTheme() {
    const t = getSettings().theme;
    if (t === 'light' || t === 'dark') return t;
    if (inTg && tg.colorScheme) return tg.colorScheme;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme() {
    const r = resolvedTheme();
    document.documentElement.dataset.theme = r;
    if (inTg) { try { tg.setHeaderColor(COLORS[r]); tg.setBackgroundColor(COLORS[r]); if (tg.setBottomBarColor) tg.setBottomBarColor(COLORS[r]); } catch (e) { /* ignore */ } }
  }
  function render(keepScroll) {
    const y = window.scrollY;
    const app = $('#app');
    app.replaceChildren();
    if (view === 'loading') app.append(loadingView());
    else if (view === 'error') app.append(errorView());
    else if (view === 'wizard') app.append(wizardView());
    else app.append(mainView());
    window.scrollTo(0, keepScroll ? y : 0);
    updateClosing();
  }

  /* ================= экраны: загрузка / ошибка ================= */
  const loadingView = () => h('div', { class: 'center' }, h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Загрузка' }), h('p', { class: 'sub' }, 'Загружаю ваши данные…'));
  const errorView = () => h('div', { class: 'center' },
    h('div', { class: 'emoji' }, '⚠️'),
    h('h1', { class: 'title' }, 'Не удалось загрузить данные'),
    h('p', { class: 'sub' }, 'Telegram Cloud не ответил: ' + errMsg + '. Проверьте соединение и повторите попытку.'),
    h('button', { class: 'btn', onclick: boot }, 'Повторить'),
    h('button', { class: 'btn ghost', onclick: () => { proceed(); } }, 'Продолжить с данными устройства'),
    h('p', { class: 'hint' }, 'В этом режиме изменения сохранятся на устройстве и отправятся в облако при следующем успешном запуске.'));

  /* ================= редактор упражнений (визард + план) ================= */
  function addEx(ctx, list, name) {
    const blank = name ? list.find((y) => !y.n.trim() && !y.w && !y.r && !y.s) : null; // пустую строку заполняем, а не плодим новую
    const x = blank || newEx(name);
    if (blank) blank.n = name; else list.push(x);
    if (ctx.bad) ctx.bad.delete(x.id + 'n');
    if (ctx.touch) ctx.touch();
    ctx.rerender();
    if (!name) setTimeout(() => { const el = document.querySelector('[data-id="' + x.id + '"] .name'); if (el) el.focus(); }, 0);
  }
  function dayCard(ctx, d) {
    const list = ctx.ex[d];
    const filled = list.filter((x) => x.n.trim()).length;
    const card = h('section', { class: 'card' },
      h('div', { class: 'card-h' }, h('h3', {}, WD_FULL[d - 1]), h('span', { class: 'muted' }, filled + ' ' + plural(filled, 'упражнение', 'упражнения', 'упражнений'))));
    list.forEach((x, i) => {
      const f = (key, label, mode) => h('label', { class: 'fld' }, h('span', {}, label),
        h('input', { type: 'text', inputmode: mode, placeholder: '—', value: x[key], class: ctx.bad.has(x.id + key) ? 'bad' : '', 'data-f': key,
          oninput: (e) => { e.target.value = clean(e.target.value, mode === 'decimal'); x[key] = e.target.value; e.target.classList.remove('bad'); if (ctx.touch) ctx.touch(); } }));
      card.append(h('div', { class: 'ex', 'data-id': x.id },
        h('div', { class: 'ex-top' },
          h('input', { type: 'text', class: 'name' + (ctx.bad.has(x.id + 'n') ? ' bad' : ''), placeholder: 'Название упражнения', maxlength: 40, value: x.n, 'aria-label': 'Название упражнения',
            oninput: (e) => { x.n = e.target.value; e.target.classList.remove('bad'); if (ctx.touch) ctx.touch(); } }),
          h('button', { class: 'icon-btn sm danger', 'aria-label': 'Удалить упражнение', onclick: () => { list.splice(i, 1); if (ctx.touch) ctx.touch(); ctx.rerender(); } }, '×')),
        h('div', { class: 'row3' }, f('w', 'Вес, кг', 'decimal'), f('r', 'Повторы', 'numeric'), f('s', 'Подходы', 'numeric'))));
    });
    if (!list.length) card.append(h('p', { class: 'hint' }, 'Пока нет упражнений.'));
    if (list.length < MAX_EX) {
      const used = new Set(list.map((x) => normName(x.n)));
      const sugg = SUGGEST.filter((s) => !used.has(normName(s))).slice(0, 5);
      card.append(
        h('div', { class: 'chips' }, sugg.map((s) => h('button', { class: 'chip', onclick: () => addEx(ctx, list, s) }, '+ ' + s))),
        h('button', { class: 'btn ghost', onclick: () => addEx(ctx, list, '') }, '+ Своё упражнение'));
    } else card.append(h('p', { class: 'hint' }, 'Максимум ' + MAX_EX + ' упражнений в день.'));
    return card;
  }

  /* ================= первый запуск (визард) ================= */
  function startWizard() { wiz = { step: 1, perWeek: 0, days: [], ex: {}, bad: new Set() }; view = 'wizard'; render(); }
  function wizardView() {
    const w = wiz;
    const dots = h('div', { class: 'dots', 'aria-label': 'Шаг ' + w.step + ' из 3' }, [1, 2, 3].map((i) => h('span', { class: 'dot' + (i === w.step ? ' on' : i < w.step ? ' past' : '') })));
    const body = h('div', { class: 'wizard' }, dots);
    if (w.step === 1) {
      body.append(
        h('div', { class: 'stack' }, h('h1', { class: 'title' }, 'Давайте настроим план'), h('p', { class: 'sub' }, 'Это займёт минуту. Сколько силовых тренировок в неделю вы проводите?')),
        h('div', { class: 'grid7' }, [1, 2, 3, 4, 5, 6, 7].map((n) => h('button', { class: 'chip big' + (w.perWeek === n ? ' on' : ''), 'aria-pressed': String(w.perWeek === n),
          onclick: () => { w.perWeek = n; if (w.days.length > n) w.days = w.days.slice(0, n); buzz('select'); render(true); } }, n))),
        h('button', { class: 'btn', disabled: !w.perWeek, onclick: () => { w.step = 2; render(); } }, 'Далее'));
    } else if (w.step === 2) {
      const left = w.perWeek - w.days.length;
      body.append(
        h('div', { class: 'stack' }, h('h1', { class: 'title' }, 'В какие дни?'),
          h('p', { class: 'sub' }, 'Выберите ' + w.perWeek + ' ' + plural(w.perWeek, 'день', 'дня', 'дней') + ' недели.')),
        h('div', { class: 'grid7 days' }, WD.map((l, i) => { const d = i + 1; const on = w.days.includes(d);
          return h('button', { class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on), 'aria-label': WD_FULL[i],
            onclick: () => {
              if (on) w.days = w.days.filter((v) => v !== d);
              else if (w.days.length < w.perWeek) w.days = w.days.concat(d).sort((a, b) => a - b);
              else { toast('Уже выбрано ' + w.perWeek + '. Снимите один из дней.', 'warn'); return; }
              buzz('select'); render(true);
            } }, l); })),
        h('p', { class: 'note' }, left > 0 ? 'Осталось выбрать: ' + left : 'Выбрано: ' + w.days.map((d) => WD[d - 1]).join(', ')),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn ghost narrow', onclick: () => { w.step = 1; render(); } }, 'Назад'),
          h('button', { class: 'btn', disabled: left !== 0, onclick: () => { w.days.forEach((d) => { if (!w.ex[d] || !w.ex[d].length) w.ex[d] = [newEx()]; }); w.step = 3; render(); } }, 'Далее')));
    } else {
      const ctx = { ex: w.ex, bad: w.bad, rerender: () => render(true) };
      const fin = h('button', { class: 'btn' }, 'Сохранить план');
      fin.addEventListener('click', async () => {
        const bad = new Set();
        const v = validateDraft(w.days, w.ex, bad);
        w.bad = bad;
        if (!v.ok) { toast(v.msg, 'err'); buzz('error'); render(true); return; }
        const res = await busy(fin, 'Сохраняю…', () => savePlan(w.days, w.ex));
        if (report(res, 'План сохранён')) { wiz = null; planDraft = null; dash = null; view = 'main'; tab = 'dash'; render(); }
      });
      body.append(
        h('div', { class: 'stack' }, h('h1', { class: 'title' }, 'Упражнения'),
          h('p', { class: 'sub' }, 'Добавьте упражнения на каждый день. Вес, повторы и подходы — это ваша точка отсчёта: по ним приложение будет сравнивать результаты. Если оставить пустыми, сравнение с планом для упражнения работать не будет.')),
        ...w.days.map((d) => dayCard(ctx, d)),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost narrow', onclick: () => { w.step = 2; render(); } }, 'Назад'), fin));
    }
    return h('main', { class: 'content full' }, body);
  }

  /* ================= главный каркас ================= */
  const ICONS = {
    dash: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    plan: '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 12h6M9 16h4"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>'
  };
  function navView() {
    const item = (id, label) => { const b = h('button', { class: 'tab' + (tab === id ? ' on' : ''), 'aria-current': tab === id ? 'page' : null, onclick: () => { if (tab !== id) { tab = id; buzz('select'); render(); } } }, h('span'), label);
      b.firstChild.innerHTML = ICONS[id]; return b; };
    return h('nav', { class: 'tabs', 'aria-label': 'Разделы' }, item('dash', 'Дашборд'), item('plan', 'План'), item('settings', 'Настройки'));
  }
  function mainView() {
    const content = tab === 'dash' ? dashView() : tab === 'plan' ? planView() : settingsView();
    return h('div', { class: 'shell' }, h('main', { class: 'content' }, content), navView());
  }

  /* ================= Дашборд ================= */
  function fromPlan(x) {
    return { id: uid(), n: x.n, k: false, w: str(x.w), r: str(x.r), s: str(x.s), pw: x.w, pr: x.r, ps: x.s };
  }
  function buildForm(date) {
    const rec = recs['d_' + date];
    const plan = getPlan();
    const wd = weekdayOf(date);
    if (rec && rec.e && rec.e.length) {
      return { date, saved: true, dirty: false, planDay: plan && plan.days.includes(wd) ? wd : null,
        items: rec.e.map((x) => ({ id: uid(), n: x.n, k: !!x.k, w: str(x.w), r: str(x.r), s: str(x.s), pw: x.pw == null ? null : x.pw, pr: x.pr == null ? null : x.pr, ps: x.ps == null ? null : x.ps })) };
    }
    if (plan && plan.ex[wd] && plan.ex[wd].length) return { date, saved: false, dirty: false, planDay: wd, items: plan.ex[wd].map(fromPlan) };
    return { date, saved: false, dirty: false, planDay: null, items: [] };
  }
  async function changeDate(d) {
    const max = today();
    if (d > max) d = max;
    if (d === dash.date) return;
    if (dash.dirty && !(await ask('Изменения не сохранены. Перейти на другую дату?'))) { render(true); return; }
    dash = buildForm(d); buzz('select'); render();
  }
  function markDirty() { if (dash) { dash.dirty = true; updateClosing(); } }

  function itemCard(it) {
    const ana = h('div', { class: 'ana' });
    const fld = (key, label, mode) => h('label', { class: 'fld' }, h('span', {}, label),
      h('input', { type: 'text', inputmode: mode, placeholder: '0', value: it[key], 'data-f': key,
        oninput: (e) => { e.target.value = clean(e.target.value, mode === 'decimal'); it[key] = e.target.value; e.target.classList.remove('bad'); markDirty(); updateAnalytics(); } }));
    const cb = h('input', { type: 'checkbox', checked: it.k, 'aria-label': 'Выполнено: ' + it.n,
      onchange: (e) => { it.k = e.target.checked; buzz('select'); markDirty(); updateAnalytics(); } });
    const pl = planOf(it);
    const planTxt = pl ? 'План: ' + descOf(pl) : it.pr >= 1 && it.ps >= 1 ? 'План: ' + it.pr + ' × ' + it.ps + ', вес не указан' : 'В плане нет значений для сравнения';
    const card = h('section', { class: 'card ex-card' + (it.k ? ' done' : '') },
      h('label', { class: 'check' }, cb, h('span', { class: 'box' }), h('span', { class: 'ex-name' }, it.n)),
      h('div', { class: 'row3' }, fld('w', 'Вес, кг', 'decimal'), fld('r', 'Повторы', 'numeric'), fld('s', 'Подходы', 'numeric')),
      h('p', { class: 'plan-line' }, planTxt), ana);
    refs[it.id] = { card, ana };
    return card;
  }
  const badge = (res, label, noText) => {
    if (res.st === 'up') return h('span', { class: 'badge up' }, '▲ ' + pct(res.d) + ' ' + label);
    if (res.st === 'down') return h('span', { class: 'badge down' }, '▼ ' + pct(res.d) + ' ' + label);
    if (res.st === 'same') return h('span', { class: 'badge' }, '● ' + label + ': без изменений');
    if (res.st === 'mixed') return h('span', { class: 'badge' }, label + ': разный тип нагрузки (с весом / без)');
    return h('span', { class: 'badge' }, noText);
  };
  function updateAnalytics() {
    const f = dash;
    const box = $('#summary');
    if (!f || !box) return;
    const idx = historyIndex(f.date);
    let nDone = 0, nInvalid = 0, up = 0, same = 0, down = 0, noHist = 0, pUp = 0, pSame = 0, pDown = 0, pCount = 0;
    f.items.forEach((it) => {
      const ref = refs[it.id];
      if (!ref) return;
      ref.card.classList.toggle('done', it.k);
      ref.ana.replaceChildren();
      if (!it.k) return;
      nDone++;
      const cur = curOf(it);
      if (!cur) { nInvalid++; ref.ana.append(h('p', { class: 'hint' }, 'Укажите вес (0 — свой вес), повторы и подходы — тогда появится сравнение.')); return; }
      const hist = idx[normName(it.n)] || [];
      const prev = hist.length ? hist[hist.length - 1] : null;
      const rp = compare(cur, prev);
      const rl = compare(cur, planOf(it));
      if (rp.st === 'up') up++; else if (rp.st === 'down') down++; else if (rp.st === 'same') same++; else if (rp.st === 'none') noHist++;
      if (rl.st === 'up' || rl.st === 'down' || rl.st === 'same') { pCount++; if (rl.st === 'up') pUp++; else if (rl.st === 'down') pDown++; else pSame++; }
      ref.ana.append(h('div', { class: 'badges' }, badge(rp, 'к прошлому разу', 'Нет прошлых записей для сравнения'), badge(rl, 'к плану', 'В плане нет данных для сравнения')));
      if (prev) ref.ana.append(h('p', { class: 'detail' }, 'Сейчас: ' + descOf(cur) + ' · ' + fmtShort(prev.date) + ': ' + descOf(prev)));
      const series = hist.filter((x) => x.type === cur.type).slice(-7).map((x) => x.v).concat(cur.v);
      if (series.length >= 2) ref.ana.append(h('div', { class: 'spark' }, spark(series), h('span', {}, cur.type === 'kg' ? 'Динамика объёма, кг' : 'Динамика повторов')));
    });
    const compared = up + same + down;
    const kids = [h('h2', { class: 'card-title' }, 'Аналитика')];
    if (!nDone) kids.push(h('p', { class: 'note' }, 'Отметьте выполненные упражнения и укажите вес, повторы и подходы — здесь появится сравнение с прошлыми тренировками и планом.'));
    else if (nInvalid === nDone) kids.push(h('p', { class: 'note' }, 'Для анализа заполните вес, повторы и подходы у отмеченных упражнений.'));
    else if (!compared) kids.push(h('p', { class: 'note' }, 'Для сравнения нужна хотя бы одна прошлая запись того же упражнения. Сохраните эту тренировку — со следующей аналитика заработает.'));
    else {
      kids.push(h('div', { class: 'tiles' },
        h('div', { class: 'tile up' }, h('b', {}, up), h('span', {}, 'Лучше')),
        h('div', { class: 'tile' }, h('b', {}, same), h('span', {}, 'Без изменений')),
        h('div', { class: 'tile down' }, h('b', {}, down), h('span', {}, 'Хуже'))));
      kids.push(h('p', { class: 'note' }, 'Сравнение с прошлой тренировкой по ' + compared + ' ' + plural(compared, 'упражнению', 'упражнениям', 'упражнениям') + '.' + (noHist ? ' Без истории: ' + noHist + ' (не учтены).' : '')));
    }
    if (nDone - nInvalid > 0) {
      kids.push(h('p', { class: 'note' }, pCount ? 'С планом: выше — ' + pUp + ', по плану — ' + pSame + ', ниже — ' + pDown + '.' : 'Сравнение с планом недоступно: в плане нет веса, повторов и подходов для этих упражнений.'));
    }
    kids.push(h('details', {}, h('summary', {}, 'Как считается аналитика'), h('ul', {},
      h('li', {}, 'Объём упражнения = вес × повторы × подходы. Если вес 0 (свой вес) — считаются повторы × подходы.'),
      h('li', {}, 'Сравниваем с последней более ранней записью того же упражнения (по названию) и со значениями плана, которые были на момент сохранения тренировки.'),
      h('li', {}, 'Изменение меньше ' + THRESH + '% — «без изменений». Разные типы нагрузки (с весом и без) не сравниваются.'),
      h('li', {}, 'В расчёт идут только отмеченные выполненными упражнения. Нет данных — нет вывода.'))));
    box.replaceChildren(...kids);
  }
  async function saveDay(btn) {
    const f = dash;
    let n = 0, badAny = false;
    f.items.forEach((it) => {
      if (!it.k) return;
      n++;
      const w = P(it.w), r = P(it.r), s = P(it.s);
      const oks = { w: w >= 0 && w <= 1000, r: Number.isInteger(r) && r >= 1 && r <= 100, s: Number.isInteger(s) && s >= 1 && s <= 50 };
      for (const k in oks) { refs[it.id].card.querySelector('[data-f="' + k + '"]').classList.toggle('bad', !oks[k]); if (!oks[k]) badAny = true; }
    });
    if (!n) { toast('Отметьте хотя бы одно выполненное упражнение', 'warn'); buzz('error'); return; }
    if (badAny) { toast('Заполните вес (0 — свой вес), повторы (1–100) и подходы (1–50) у отмеченных упражнений', 'err'); buzz('error'); return; }
    const e = f.items.map((it) => ({ n: it.n, k: it.k ? 1 : 0, w: numOrNull(it.w), r: numOrNull(it.r), s: numOrNull(it.s), pw: it.pw, pr: it.pr, ps: it.ps }));
    const res = await busy(btn, 'Сохраняю…', () => commit([['d_' + f.date, { e }]]));
    if (report(res, 'Тренировка сохранена')) { f.saved = true; f.dirty = false; render(true); }
  }
  function dashView() {
    if (!dash) dash = buildForm(today());
    const f = dash, plan = getPlan(), max = today();
    refs = {};
    const wrap = h('div', { class: 'stack' });
    wrap.append(h('h1', { class: 'title' }, 'Дашборд'));
    wrap.append(h('div', { class: 'datebar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Предыдущий день', onclick: () => changeDate(addDays(f.date, -1)) }, '‹'),
      h('label', { class: 'datepick' }, h('span', {}, fmtLong(f.date)),
        h('input', { type: 'date', value: f.date, max, 'aria-label': 'Выбрать дату', onchange: (e) => { if (e.target.value) changeDate(e.target.value); } })),
      h('button', { class: 'icon-btn', 'aria-label': 'Следующий день', disabled: f.date >= max, onclick: () => changeDate(addDays(f.date, 1)) }, '›')));
    wrap.append(h('div', { class: 'pills' },
      f.saved ? h('span', { class: 'pill ok' }, '✓ Запись сохранена') : null,
      f.planDay ? h('span', { class: 'pill' }, 'По плану: ' + WD_FULL[f.planDay - 1]) : h('span', { class: 'pill' }, 'В плане этот день свободный'),
      f.date !== max ? h('button', { class: 'link', onclick: () => changeDate(max) }, 'Сегодня') : null));

    if (!f.items.length) {
      wrap.append(h('section', { class: 'card empty' },
        h('div', { class: 'emoji' }, '🗓️'),
        h('h3', {}, 'На этот день нет упражнений'),
        h('p', { class: 'sub' }, 'Выберите день плана, по которому вы тренировались:'),
        h('div', { class: 'chips', style: 'justify-content:center' }, plan.days.map((d) => h('button', { class: 'chip',
          onclick: () => { f.items = plan.ex[d].map(fromPlan); f.planDay = d; f.dirty = false; render(true); } }, WD[d - 1] + ' · ' + plan.ex[d].length)))));
      return wrap;
    }
    wrap.append(h('section', { class: 'card', id: 'summary' }));
    f.items.forEach((it) => wrap.append(itemCard(it)));
    if (!f.saved && plan && plan.days.length > 1) {
      wrap.append(h('button', { class: 'link', onclick: () => { f.items = []; f.dirty = false; render(true); } }, 'Тренировался по другому дню плана'));
    }
    const btn = h('button', { class: 'btn' }, f.saved ? 'Обновить запись' : 'Сохранить тренировку');
    btn.addEventListener('click', () => saveDay(btn));
    wrap.append(h('div', { class: 'savebar' }, btn));
    setTimeout(updateAnalytics, 0);
    return wrap;
  }

  /* ================= План ================= */
  function planView() {
    const plan = getPlan();
    if (!planDraft) {
      planDraft = { days: plan.days.slice(), ex: {} };
      plan.days.forEach((d) => { planDraft.ex[d] = plan.ex[d].map(toDraft); });
      planDirty = false; planBad = new Set();
    }
    const dr = planDraft;
    const ctx = { ex: dr.ex, bad: planBad, rerender: () => render(true), touch: () => { planDirty = true; updateClosing(); } };
    const toggle = (d) => {
      if (dr.days.includes(d)) {
        if (dr.days.length === 1) { toast('Нужен хотя бы один день тренировок', 'warn'); return; }
        const go = () => { dr.days = dr.days.filter((v) => v !== d); planDirty = true; render(true); };
        if ((dr.ex[d] || []).some((x) => x.n.trim())) ask('Убрать «' + WD_FULL[d - 1] + '» из плана? Упражнения этого дня удалятся после сохранения.').then((ok) => { if (ok) go(); });
        else go();
      } else {
        dr.days = dr.days.concat(d).sort((a, b) => a - b);
        if (!dr.ex[d] || !dr.ex[d].length) dr.ex[d] = [newEx()];
        planDirty = true; render(true);
      }
      buzz('select');
    };
    const save = h('button', { class: 'btn' }, 'Сохранить план');
    save.addEventListener('click', async () => {
      const bad = new Set();
      const v = validateDraft(dr.days, dr.ex, bad);
      planBad = bad;
      if (!v.ok) { toast(v.msg, 'err'); buzz('error'); render(true); return; }
      const res = await busy(save, 'Сохраняю…', () => savePlan(dr.days, dr.ex));
      if (report(res, 'План сохранён')) { planDraft = null; planDirty = false; if (!(dash && dash.dirty)) dash = null; render(true); }
    });
    const n = dr.days.length;
    return h('div', { class: 'stack' },
      h('h1', { class: 'title' }, 'План тренировок'),
      h('section', { class: 'card' },
        h('div', { class: 'card-h' }, h('h3', {}, 'Дни занятий'), h('span', { class: 'muted' }, n + ' ' + plural(n, 'тренировка', 'тренировки', 'тренировок') + ' в неделю')),
        h('div', { class: 'plan-days' }, WD.map((l, i) => h('button', { class: 'chip' + (dr.days.includes(i + 1) ? ' on' : ''), 'aria-pressed': String(dr.days.includes(i + 1)), 'aria-label': WD_FULL[i], onclick: () => toggle(i + 1) }, l)))),
      dr.days.map((d) => dayCard(ctx, d)),
      h('p', { class: 'hint' }, 'План — точка отсчёта для аналитики. Уже сохранённые тренировки не меняются: в них остаются значения плана на момент записи.'),
      h('div', { class: 'savebar' },
        planDirty ? h('button', { class: 'link', onclick: () => { planDraft = null; planDirty = false; render(true); } }, 'Отменить изменения') : null, save));
  }

  /* ================= Настройки ================= */
  const seg = (opts, cur, pick) => h('div', { class: 'seg', role: 'group' }, opts.map(([v, l]) => h('button', { class: v === cur ? 'on' : '', 'aria-pressed': String(v === cur), onclick: () => pick(v) }, l)));
  async function setSetting(patch) {
    const res = await commit([['settings', Object.assign({}, getSettings(), patch)]]);
    applyTheme();
    if (res.cloud === 'fail') toast('Настройка сохранена на устройстве, в облако не записалась', 'warn');
    render(true);
  }
  function exportJson() {
    const out = {};
    for (const k in recs) out[k] = recs[k];
    return JSON.stringify({ app: 'workout-progress', v: 1, at: new Date().toISOString(), recs: out }, null, 1);
  }
  function openExport() {
    const json = exportJson();
    const ta = h('textarea', { readonly: true, 'aria-label': 'Данные в формате JSON' });
    ta.value = json;
    modal('Экспорт данных', h('div', { class: 'stack' }, h('p', { class: 'note' }, 'Скопируйте текст и сохраните его в заметках или файле — это полная копия плана и тренировок.'), ta), [
      { label: 'Копировать', fn: async () => {
        try { await navigator.clipboard.writeText(json); toast('Скопировано'); } catch (e) { ta.select(); try { document.execCommand('copy'); toast('Скопировано'); } catch (e2) { toast('Выделите текст и скопируйте вручную', 'warn'); } }
      } },
      { label: 'Скачать файл', cls: 'ghost', fn: () => {
        const a = h('a', { href: URL.createObjectURL(new Blob([json], { type: 'application/json' })), download: 'workout-progress-' + today() + '.json' });
        document.body.append(a); a.click(); a.remove();
      } },
      { label: 'Закрыть', cls: 'ghost', fn: (close) => close() }]);
  }
  function openImport() {
    const ta = h('textarea', { placeholder: 'Вставьте сюда данные, скопированные через «Экспорт»', 'aria-label': 'JSON для импорта' });
    modal('Импорт данных', h('div', { class: 'stack' }, h('p', { class: 'note' }, 'Данные объединятся с текущими: при совпадении побеждает более свежая запись.'), ta), [
      { label: 'Импортировать', fn: async (close) => {
        let data;
        try { data = JSON.parse(ta.value); } catch (e) { toast('Не получилось прочитать текст: это не JSON', 'err'); return; }
        if (!data || data.app !== 'workout-progress' || typeof data.recs !== 'object') { toast('Это не экспорт Workout Progress', 'err'); return; }
        const keys = [];
        for (const k in data.recs) {
          const r = data.recs[k];
          if (isOurKey(k) && r && typeof r.u === 'number' && (!recs[k] || recs[k].u < r.u)) { recs[k] = r; keys.push(k); if (cloudOK) unsynced.add(k); }
        }
        if (!keys.length) { toast('Новых данных в импорте нет', 'warn'); return; }
        const local = lsWrite();
        const cl = await pushKeys(keys);
        close();
        report({ local, cloud: cl }, 'Импортировано записей: ' + keys.length);
        dash = null; planDraft = null; planDirty = false; applyTheme();
        if (getPlan()) { view = 'main'; render(); } else startWizard();
      } },
      { label: 'Отмена', cls: 'ghost', fn: (close) => close() }]);
  }
  async function wipeAll() {
    if (!(await ask('Удалить весь план и все записи тренировок? Это нельзя отменить.'))) return;
    if (cloudOK) {
      try {
        const all = (await cloud('getKeys')).filter(isOurKey);
        for (let i = 0; i < all.length; i += 100) await cloud('removeItems', all.slice(i, i + 100));
      } catch (e) { toast('Не удалось удалить данные из Telegram Cloud. Ничего не удалено — попробуйте ещё раз.', 'err'); buzz('error'); return; }
    }
    recs = {}; unsynced = new Set(); dash = null; planDraft = null; planDirty = false;
    try { localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_UN); } catch (e) { /* ignore */ }
    applyTheme(); toast('Все данные удалены'); startWizard();
  }
  function settingsView() {
    const s = getSettings();
    const sessions = Object.keys(recs).filter((k) => k.slice(0, 2) === 'd_' && (recs[k].e || []).some((x) => x.k)).length;
    const plan = getPlan();
    const exCount = plan ? plan.days.reduce((a, d) => a + plan.ex[d].length, 0) : 0;
    const syncBtn = h('button', { class: 'btn ghost' }, 'Синхронизировать сейчас');
    syncBtn.addEventListener('click', async () => {
      const r = await busy(syncBtn, 'Синхронизация…', async () => { try { await loadCloud(); } catch (e) { return 'fail'; } return pushKeys(Object.keys(recs)); });
      if (r === 'fail') toast('Не удалось связаться с Telegram Cloud', 'err'); else toast('Синхронизировано');
      dash = null; render(true);
    });
    return h('div', { class: 'stack' },
      h('h1', { class: 'title' }, 'Настройки'),
      h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Тема'),
        seg([['auto', 'Авто'], ['light', 'Светлая'], ['dark', 'Тёмная']], s.theme, (v) => setSetting({ theme: v })),
        h('p', { class: 'hint', style: 'margin-top:8px' }, '«Авто» — как в вашем Telegram.')),
      inTg ? h('section', { class: 'card' }, h('div', { class: 'setting' }, h('div', {}, h('b', {}, 'Тактильный отклик'), h('p', { class: 'hint' }, 'Лёгкая вибрация при действиях')),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: s.haptic, 'aria-label': 'Тактильный отклик', onchange: (e) => setSetting({ haptic: e.target.checked }) }), h('span')))) : null,
      h('section', { class: 'card stack' }, h('h2', { class: 'card-title' }, 'Данные'),
        h('p', { class: 'note' }, 'Тренировок записано: ' + sessions + ' · упражнений в плане: ' + exCount),
        cloudOK
          ? h('p', { class: 'note' }, '☁️ Данные хранятся в Telegram Cloud вашего аккаунта и доступны на других устройствах, где вы откроете этого бота. ' + (unsynced.size ? 'Не отправлено в облако записей: ' + unsynced.size + '.' : 'Всё синхронизировано.'))
          : h('p', { class: 'note' }, '📱 Данные хранятся только в этом браузере/устройстве. Откройте приложение внутри Telegram, чтобы включить синхронизацию между устройствами.'),
        cloudOK ? syncBtn : null,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: openExport }, 'Экспорт'), h('button', { class: 'btn ghost', onclick: openImport }, 'Импорт')),
        h('button', { class: 'btn danger', onclick: wipeAll }, 'Удалить все данные')),
      h('p', { class: 'hint', style: 'text-align:center' }, 'Workout Progress · версия 1.0'));
  }

  /* ================= запуск ================= */
  function proceed() {
    dash = null; planDraft = null; planDirty = false;
    if (getPlan()) { view = 'main'; tab = 'dash'; render(); } else startWizard();
  }
  async function boot() {
    view = 'loading'; render();
    recs = lsRead(); unsynced = readUnsynced(); applyTheme();
    try { await loadCloud(); } catch (e) { errMsg = e && e.message ? e.message : 'неизвестная ошибка'; view = 'error'; render(); return; }
    applyTheme();
    proceed();
  }
  if (inTg) { try { tg.onEvent('themeChanged', applyTheme); } catch (e) { /* ignore */ } }
  if (window.matchMedia) { try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); } catch (e) { /* ignore */ } }
  boot();
})();
