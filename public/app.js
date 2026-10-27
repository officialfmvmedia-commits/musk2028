(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LS = 'musk2028.sig';
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const STATES = [['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','District of Columbia'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],['PR','Puerto Rico'],['GU','Guam'],['VI','U.S. Virgin Islands'],['AS','American Samoa'],['MP','Northern Mariana Islands']];
  const ZIP3 = null; // no ZIP->state guessing; we only store what people enter.

  const toast = (msg) => { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600); };
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    let j = {}; try { j = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data: j };
  };
  const saved = () => { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch { return null; } };

  // ---------- nav ----------
  const nav = $('.nav:not(.solid)');
  if (nav) { const on = () => nav.classList.toggle('scrolled', scrollY > 40); addEventListener('scroll', on, { passive: true }); on(); }
  $$('#yr').forEach((e) => (e.textContent = new Date().getFullYear()));

  // ---------- share ----------
  const shareUrl = 'https://musk2028.vote/';
  // ---------- CA chips (driven by window.MUSK2028.CA in /site-config.js) ----------
  const CA = String((window.MUSK2028 && window.MUSK2028.CA) || '').trim();
  $$('[data-ca]').forEach((el) => {
    const t = $('.ca-text', el);
    if (!CA) { t.textContent = 'CA: awaiting'; el.classList.add('pending'); el.title = 'Contract address not yet published'; return; }
    el.classList.add('live'); t.textContent = 'CA: ' + (CA.length > 16 ? CA.slice(0, 6) + '…' + CA.slice(-6) : CA); el.title = 'Copy ' + CA;
    el.addEventListener('click', async () => { try { await navigator.clipboard.writeText(CA); toast('Contract address copied'); } catch { toast(CA); } });
  });

  const shareText = 'I just signed the petition to Congress for an amendment that would let Americans who have been citizens for 20+ years run for President, and asked Elon Musk to run in 2028. Add your name. #Musk2028 @vote4musk';
  $$('[data-share]').forEach((a) => (a.href = 'https://x.com/intent/tweet?' + new URLSearchParams({ text: shareText, url: shareUrl })));
  const copy = $('#copy-link');
  if (copy) copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(shareUrl); toast('Link copied'); } catch { toast(shareUrl); } });

  // ---------- star field (hero) ----------
  const cv = $('#stars');
  if (cv && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const ctx = cv.getContext('2d'); let W, H, stars = [];
    const size = () => { const d = Math.min(devicePixelRatio || 1, 2); W = cv.width = cv.offsetWidth * d; H = cv.height = cv.offsetHeight * d;
      stars = Array.from({ length: Math.round((cv.offsetWidth * cv.offsetHeight) / 9000) }, () => ({ x: Math.random() * W, y: Math.random() * H * 0.75, r: (Math.random() * 1.3 + 0.3) * d, p: Math.random() * 6.28, s: 0.5 + Math.random() * 1.5 })); };
    size(); addEventListener('resize', size);
    let run = true; new IntersectionObserver(([e]) => (run = e.isIntersecting)).observe(cv);
    const tick = (t) => { if (run) { ctx.clearRect(0, 0, W, H); for (const s of stars) { const a = 0.35 + 0.65 * Math.abs(Math.sin(s.p + t / 1000 * s.s)); ctx.globalAlpha = a * (1 - s.y / H); ctx.fillStyle = '#F4EFE4'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill(); } } requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  // ---------- counters ----------
  let shown = 0;
  const animateTo = (n) => {
    const els = $$('[data-count]'); if (!els.length) return;
    const from = shown, start = performance.now(), dur = 900; shown = n;
    const step = (t) => { const k = Math.min(1, (t - start) / dur), v = Math.round(from + (n - from) * (1 - Math.pow(1 - k, 3))); els.forEach((e) => (e.textContent = fmt(v))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  const milestone = (n) => { const steps = [100, 1000, 10000, 100000, 1000000, 10000000]; return steps.find((s) => s > n) || n * 2; };
  const renderStats = (s) => {
    animateTo(s.total);
    $$('[data-xverified]').forEach((e) => (e.textContent = fmt(s.xVerified)));
    $$('[data-states]').forEach((e) => (e.textContent = fmt(s.states)));
    const g = milestone(s.total); $$('[data-goal]').forEach((e) => (e.textContent = fmt(g)));
    $$('[data-bar]').forEach((e) => (e.style.width = Math.max(1.5, (s.total / g) * 100) + '%'));
  };
  const ago = (iso) => { const s = (Date.now() - new Date(iso).getTime()) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; };
  const renderRecent = (list) => {
    const ul = $('#recent-list'); if (!ul) return;
    ul.textContent = '';
    if (!list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Be the first name on the list.'; ul.append(li); return; }
    for (const r of list.slice(0, 8)) {
      const li = document.createElement('li');
      const n = document.createElement('span'); n.textContent = r.name + (r.state ? ', ' + r.state : ''); li.append(n);
      if (r.xVerified) { const b = document.createElement('span'); b.className = 'badge-x'; b.textContent = '𝕏 verified'; li.append(b); }
      else if (r.emailVerified) { const b = document.createElement('span'); b.className = 'badge-e'; b.textContent = 'Email verified'; li.append(b); }
      const t = document.createElement('span'); t.className = 'st'; t.textContent = ago(r.at); li.append(t);
      ul.append(li);
    }
  };
  const refresh = async () => { if (!$('[data-count]')) return; const r = await api('/api/stats'); if (r.ok) { renderStats(r.data); renderRecent(r.data.recent || []); } };
  refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 20000);

  // ---------- petition ----------
  const form = $('#sign-form');
  let cfg = { xEnabled: false, emailVerification: false, contactEmail: null };
  const loadCfg = api('/api/config').then((r) => { if (r.ok) cfg = r.data; return cfg; });

  // privacy page contact
  loadCfg.then((c) => { const el = $('#contact-email'); if (el && c.contactEmail) { el.textContent = ' at '; const a = document.createElement('a'); a.href = 'mailto:' + c.contactEmail; a.textContent = c.contactEmail; el.append(a); } });

  if (form) {
    const sel = form.state;
    for (const [v, l] of STATES) { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.append(o); }
    const xBtn = $('#x-btn'), xNote = $('#x-note'), msg = $('#form-msg');

    loadCfg.then((c) => {
      if (!c.xEnabled) { xBtn.disabled = true; xBtn.textContent = 'Verify with X · coming soon'; xNote.textContent = 'X verification is being set up and will be available soon. You can sign now without it.'; }
      if (!c.emailVerification) $('#email-hint').textContent = 'Never shown publicly. Used only for movement updates if you opt in.';
    });

    const clearErrs = () => { $$('.err', form).forEach((e) => (e.textContent = '')); $$('.field', form).forEach((f) => f.classList.remove('bad')); msg.textContent = ''; msg.className = 'form-msg'; };
    const showErrs = (fields) => { for (const [k, v] of Object.entries(fields || {})) { const e = $(`[data-err="${k}"]`, form); if (e) e.textContent = v; const inp = form[k]; if (inp && inp.closest) inp.closest('.field')?.classList.add('bad'); } };

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); clearErrs();
      const body = { name: form.name.value, zip: form.zip.value, state: form.state.value, email: form.email.value, optIn: form.optIn.checked, consent: form.consent.checked, website: form.website.value };
      const local = {};
      if (body.name.trim().length < 2) local.name = 'Please enter your full name.';
      if (!body.consent) local.consent = 'Please confirm the statement to sign.';
      if (body.zip && !/^\d{5}(-\d{4})?$/.test(body.zip.trim())) local.zip = 'ZIP should look like 12345.';
      if (Object.keys(local).length) { showErrs(local); msg.textContent = 'Please fix the highlighted fields.'; msg.classList.add('bad'); return; }
      const btn = $('#sign-btn'); btn.disabled = true; btn.textContent = 'Signing…';
      const r = await api('/api/sign', body);
      btn.disabled = false; btn.textContent = 'Sign the petition';
      if (!r.ok) { showErrs(r.data.fields); msg.textContent = r.data.error || 'Something went wrong. Please try again.'; msg.classList.add('bad'); return; }
      if (r.data.id) localStorage.setItem(LS, JSON.stringify({ id: r.data.id, token: r.data.manageToken, firstName: r.data.firstName, hasEmail: !!body.email, emailSent: r.data.emailSent }));
      if (r.data.stats) renderStats(r.data.stats);
      refresh();
      showThanks();
    });
    showThanks(true);
  }

  async function showThanks(initial) {
    const s = saved(); if (!s || !form) return;
    const me = await api('/api/me', { id: s.id, token: s.token });
    if (!me.ok) { if (me.status === 404) localStorage.removeItem(LS); return; }
    await loadCfg;
    form.hidden = true; const th = $('#thanks'); th.hidden = false;
    $('#th-name').textContent = me.data.firstName;
    const st = $('#th-status'); st.textContent = '';
    const add = (t) => { const li = document.createElement('li'); li.textContent = t; st.append(li); };
    add('✓ Your signature is counted.');
    if (me.data.xVerified) add('✓ X-verified' + (me.data.xHandle ? ' as @' + me.data.xHandle : '') + '.');
    if (me.data.hasEmail) add(me.data.emailVerified ? '✓ Email confirmed.' : (cfg.emailVerification ? '✉ Check your inbox to confirm your email.' : '• Email saved (not shown publicly). Email confirmation isn’t switched on yet.'));
    const tx = $('#th-x');
    if (me.data.xVerified) tx.hidden = true;
    else if (cfg.xEnabled) { tx.href = '/auth/x/start?' + new URLSearchParams({ id: s.id, token: s.token }); tx.textContent = 'Verify with X (optional)'; }
    else { tx.removeAttribute('href'); tx.setAttribute('aria-disabled', 'true'); tx.style.opacity = .5; tx.style.pointerEvents = 'none'; tx.textContent = 'Verify with X · coming soon'; }
    if (!initial) $('#sign').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const rm = $('#th-remove');
  if (rm) rm.addEventListener('click', async () => {
    const s = saved(); if (!s) return;
    if (!confirm('Remove your signature permanently?')) return;
    const r = await api('/api/remove', { id: s.id, token: s.token });
    if (r.ok) { localStorage.removeItem(LS); toast('Your signature was removed.'); $('#thanks').hidden = true; form.hidden = false; form.reset(); if (r.data.stats) renderStats(r.data.stats); refresh(); }
    else toast('Could not remove — please try again.');
  });

  // X OAuth return messages
  const q = new URLSearchParams(location.search);
  const x = q.get('x');
  if (x) {
    const m = { verified: `X account @${q.get('handle') || ''} verified. Thank you!`, cancelled: 'X verification was cancelled.', expired: 'That X sign-in expired. Please try again.', duplicate: 'That X account has already verified another signature.', error: 'X verification failed. Please try again later.', invalid: 'Please sign the petition first.', unavailable: 'X verification is coming soon.' }[x];
    if (m) setTimeout(() => toast(m), 400);
    history.replaceState(null, '', location.pathname + location.hash);
  }

  // remove page (email link)
  const rc = $('#remove-confirm');
  if (rc) rc.addEventListener('click', async () => {
    const id = q.get('id'), token = q.get('token');
    const r = await api('/api/remove', { id, token });
    const m = $('#remove-msg');
    if (r.ok) { m.textContent = 'Your signature has been removed.'; rc.hidden = true; const s = saved(); if (s && String(s.id) === String(id)) localStorage.removeItem(LS); }
    else { m.textContent = 'That signature was not found or was already removed.'; m.classList.add('bad'); }
  });

  // manifesto TOC highlight
  const toc = $$('.mf-toc a');
  if (toc.length) {
    const map = new Map(toc.map((a) => [a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { toc.forEach((a) => a.classList.remove('on')); map.get(e.target.id)?.classList.add('on'); } }), { rootMargin: '-40% 0px -55% 0px' });
    map.forEach((_, id) => { const el = document.getElementById(id); if (el) io.observe(el); });
  }
})();
