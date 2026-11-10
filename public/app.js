'use strict';
let CFG, ME = null, timer = null, UN = { messages: 0, notifications: 0 };
const R = { house: ['house'], blood: ['request', 'donor'], lost: ['lost'], market: ['market'], skill: ['skill'], job: ['job'], tuition: ['tuition'] };
const RN = { house: 'বাসা ভাড়া', blood: 'ব্লাড ডোনেশন', lost: 'হারানো ও পাওয়া', market: 'কেনাবেচা', skill: 'দক্ষতা ও সেবা', job: 'জব', tuition: 'টিউশন' };
const IC = { house: ['🏠', '#E8F1FF', 'বাসা খুঁজুন বা ভাড়ার বিজ্ঞাপন দিন।'], blood: ['🩸', '#FDE8E6', 'রক্তদাতা খুঁজুন, জরুরি অনুরোধ করুন।'], lost: ['🔎', '#FFF4DB', 'হারানো জিনিসের খোঁজ দিন বা পাওয়া জিনিস জানান।'], market: ['🛍️', '#EAF5EF', 'ছবি ও ভিডিও দেখে পণ্য কিনুন ও বিক্রি করুন।'], skill: ['💼', '#F0E9FF', 'আপনার দক্ষতা দেখান বা সেবা নিন।'], job: ['📋', '#E6F6F7', 'পার্ট-টাইম, ইন্টার্নশিপ ও ফুল-টাইম জবের খোঁজ।'], tuition: ['📚', '#FFEFE3', 'টিউশন দিন অথবা শিক্ষক খুঁজুন।'] };
const S = { kind: null, q: '', f: '', max: '', page: 1, form: false };
const view = h => { $('#app').innerHTML = h; };
const go = r => { location.hash = '#/' + r; };
const need = () => { if (ME) return true; toast('এই কাজের জন্য লগইন করুন', 1); go('login'); return false; };
async function boot() {
  CFG = await api('/config'); await refreshMe(); route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { });
  setInterval(async () => { if (ME) { try { UN = await api('/unread'); head(); } catch { } } }, 15000);
}
async function refreshMe() { try { ME = (await api('/me')).user; if (ME) UN = await api('/unread'); } catch { ME = null; } head(); }
function head() {
  const l = [['home', 'হোম'], ['services', 'সকল সেবা'], ...Object.keys(RN).map(k => [k, RN[k]]), ['about', 'আমাদের সম্পর্কে']], cur = (location.hash.split('/')[1] || 'home');
  $('#nav').innerHTML = l.map(([k, n]) => `<a href="#/${k}" class="${cur === k ? 'on' : ''}">${n}</a>`).join('');
  $('#auth').innerHTML = ME ? `<a class="btn s o" href="#/messages">💬${UN.messages ? `<span class="badge">${bn(UN.messages)}</span>` : ''}</a><a class="btn s o" href="#/dashboard/notif">🔔${UN.notifications ? `<span class="badge">${bn(UN.notifications)}</span>` : ''}</a><a class="btn s" href="#/dashboard">${esc(ME.name.split(' ')[0])}${ME.verified ? ' ✔' : ''}</a>${ME.role === 'admin' ? '<a class="btn s o" href="/admin">অ্যাডমিন</a>' : ''}` : `<a class="btn s o" href="#/login">লগইন</a><a class="btn s" href="#/register">অ্যাকাউন্ট তৈরি করুন</a>`;
}
async function route() {
  clearInterval(timer); closeModal(); const p = (location.hash.slice(2) || 'home').split('/'); head(); scrollTo(0, 0); const [r, a] = p;
  try {
    if (r === 'home') await home(); else if (r === 'services') view('<h1>সকল সেবা</h1>' + svc()); else if (R[r]) await section(r); else if (r === 'login' || r === 'register') authPage(r);
    else if (r === 'dashboard') await dash(a || 'profile'); else if (r === 'messages') await messages(a); else if (r === 'about') view(about()); else await home();
  } catch (e) { view(`<div class="empty">${esc(e.message)}</div>`); }
}
addEventListener('hashchange', route);
function svc() { return `<div class="grid">${Object.keys(RN).map(r => `<a href="#/${r}" class="card sv"><div class="tile" style="background:${IC[r][1]}">${IC[r][0]}</div><h3>${RN[r]}</h3><p class="mu">${IC[r][2]}</p><b style="color:var(--g)">দেখুন →</b></a>`).join('')}<a href="#/dashboard" class="card sv"><div class="tile" style="background:#E6F6F7">👤</div><h3>আমার ড্যাশবোর্ড</h3><p class="mu">আপনার সব পোস্ট, আবেদন, বার্তা ও পছন্দ এক জায়গায়।</p><b style="color:var(--g)">যান →</b></a></div>`; }
// ---------- cards ----------
function card(p) {
  const K = CFG.kinds[p.kind], d = p.data, done = p.status === 'done', first = K.f[0][0];
  const meta = K.f.slice(1).filter(f => f[0] !== 'desc' && d[f[0]]).map(f => `<div class="mu">${esc(f[1].split(' (')[0])}: ${esc(f[2] === 'date' ? dt(d[f[0]]) : f[2] === 'number' && /৳/.test(f[1]) ? bn(d[f[0]]) + ' ৳' : d[f[0]])}</div>`).join('');
  return `<div class="card">${mediaHtml(p.media)}<span class="tag">${K.n}</span>${done ? `<span class="tag d">${K.done}</span>` : ''}${p.status === 'hidden' ? '<span class="tag d">অ্যাডমিন লুকিয়েছেন</span>' : ''}<h3>${esc(d[first])}</h3>${meta}${d.desc ? `<p class="mu">${esc(d.desc).slice(0, 220)}</p>` : ''}
<div class="mu">${av(p.author)}${esc(p.author.name)}${badge(p.author)} · ${dt(p.created)}</div>
<div class="row">${p.mine ? '' : `<button class="btn s" data-a="msg" data-u="${p.author.id}" data-id="${p.id}">💬 মেসেজ করুন</button>`}${K.apply && !p.mine && !done ? `<button class="btn s o" data-a="apply" data-id="${p.id}">${K.apply}</button>` : ''}<button class="btn s o" data-a="fav" data-id="${p.id}">${p.fav ? '♥ পছন্দের' : '♡ পছন্দ'}</button>${p.mine ? '' : `<button class="btn s r" data-a="report" data-id="${p.id}">রিপোর্ট</button>`}${p.mine ? `<button class="btn s o" data-a="done" data-id="${p.id}" data-v="${done ? 'active' : 'done'}">${done ? 'আবার চালু করুন' : K.done}</button><button class="btn s r" data-a="del" data-id="${p.id}">মুছুন</button>` : ''}</div></div>`;
}
function formHtml(k) {
  const K = CFG.kinds[k]; return `<div class="card" style="margin-bottom:14px"><h3>${K.n} — নতুন পোস্ট</h3><form id="pf" data-k="${k}">${K.f.map(f => field(f)).join('')}${K.media ? `<label>ছবি / ভিডিও (সর্বোচ্চ ৫টি; ছবি ৮ এমবি, ভিডিও ${bn(CFG.maxVideoMb)} এমবি পর্যন্ত)</label><input name="files" type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple>` : ''}<div class="row"><button class="btn" id="psub">প্রকাশ করুন</button><button type="button" class="btn o" data-a="cancel">বাতিল</button></div></form></div>`;
}
let pending;
async function section(r) {
  const ks = R[r]; if (!S.kind || !ks.includes(S.kind)) { S.kind = ks[0]; S.q = S.f = S.max = ''; S.page = 1; S.form = false; } const K = CFG.kinds[S.kind], fo = K.f.find(f => f[0] === K.flt);
  view(`<h1>${RN[r]}</h1><p class="mu">${IC[r][2]}</p>${ks.length > 1 ? `<div class="tabs">${ks.map(k => `<button class="btn s ${k === S.kind ? '' : 'o'}" data-a="tab" data-k="${k}">${CFG.kinds[k].n}</button>`).join('')}</div>` : ''}
${r === 'blood' ? '<div class="note warn">⚠️ চিকিৎসা সতর্কতা: রক্তদাতার যোগ্যতা ও রক্তসঞ্চালনের সিদ্ধান্ত অবশ্যই যোগ্য চিকিৎসকের মাধ্যমে নিশ্চিত করুন। ফোন নম্বর প্রকাশ করা হয় না—প্ল্যাটফর্মের মেসেজে কথা বলুন।</div>' : ''}${r === 'market' ? '<div class="note">ℹ️ লেনদেন ও পেমেন্ট সম্পূর্ণ ক্রেতা ও বিক্রেতার মধ্যে। পণ্য দেখে ও যাচাই করে কিনুন।</div>' : ''}${r === 'job' || r === 'tuition' ? '<div class="note">ℹ️ আবেদন ও আলোচনা প্ল্যাটফর্মের মেসেজের মাধ্যমে করুন। অগ্রিম টাকা দেওয়ার আগে যাচাই করুন।</div>' : ''}
<div class="tools"><input id="q" placeholder="খুঁজুন…" value="${esc(S.q)}">${fo ? `<select id="flt"><option value="">সব ${esc(fo[1].split(' (')[0])}</option>${fo[3].map(x => `<option ${x === S.f ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>` : ''}${K.num ? `<input id="max" type="number" min="0" placeholder="সর্বোচ্চ (৳)" value="${esc(S.max)}">` : ''}<button class="btn" data-a="add">+ নতুন পোস্ট</button></div><div id="form">${S.form ? formHtml(S.kind) : ''}</div><div id="list"><div class="empty">লোড হচ্ছে…</div></div>`);
  await loadList();
}
async function loadList() {
  const qs = new URLSearchParams({ kind: S.kind, page: S.page }); if (S.q) qs.set('q', S.q); if (S.f) qs.set('f', S.f); if (S.max) qs.set('max', S.max);
  try { const d = await api('/posts?' + qs); $('#list').innerHTML = d.items.length ? `<div class="grid">${d.items.map(card).join('')}</div>${d.pages > 1 ? `<div class="pager"><button class="btn s o" data-a="pg" data-v="${d.page - 1}" ${d.page <= 1 ? 'disabled' : ''}>← আগের</button><span class="mu">${bn(d.page)} / ${bn(d.pages)}</span><button class="btn s o" data-a="pg" data-v="${d.page + 1}" ${d.page >= d.pages ? 'disabled' : ''}>পরের →</button></div>` : ''}` : '<div class="empty">কিছু পাওয়া যায়নি।</div>'; } catch (e) { $('#list').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function recent(k, t) { const d = await api(`/posts?kind=${k}&ps=3`); return d.items.length ? `<h2>${t}</h2><div class="grid">${d.items.map(card).join('')}</div>` : ''; }
async function home() {
  const [st, an] = await Promise.all([api('/stats'), api('/announcements')]);
  view(`<div class="hero"><span class="pill">🎓 Green University of Bangladesh</span><h1>আপনার বিশ্ববিদ্যালয়, আপনার কমিউনিটি</h1><p>Green University of Bangladesh-এর শিক্ষার্থী ও সংশ্লিষ্ট সবার জন্য প্রয়োজনীয় সব সেবা এখন একটি প্ল্যাটফর্মে।</p><div class="row"><a class="btn w" href="#/services">সেবা দেখুন</a>${ME ? '<a class="btn ow" href="#/dashboard">আমার ড্যাশবোর্ড</a>' : '<a class="btn ow" href="#/register">অ্যাকাউন্ট তৈরি করুন</a>'}</div></div>

<section class="adda-gallery">
  <div class="adda-gallery-hero">
    <img src="/images/adda/adda-background.jpg" alt="GUB Campus Adda" loading="lazy">
    <div class="adda-gallery-overlay">
      <span>🎓 GREEN UNIVERSITY OF BANGLADESH</span>
      <h2>আমাদের ক্যাম্পাস, আমাদের গল্প</h2>
      <p>বন্ধুত্ব, আড্ডা আর সুন্দর ক্যাম্পাস জীবনের মুহূর্তগুলো।</p>
    </div>
  </div>
  <div class="adda-gallery-grid">
    <img src="/images/adda/gub-campus-1.jpg" alt="GUB Campus View" loading="lazy">
    <img src="/images/adda/gub-campus-2.jpg" alt="GUB Campus Life" loading="lazy">
  </div>
</section>
<div class="stats"><div><b>${bn(st.members)}</b>সদস্য</div><div><b>${bn(st.posts)}</b>পোস্ট</div><div><b>${bn(st.donors)}</b>রক্তদাতা</div><div><b>${bn(st.services)}</b>সেবা, জব ও টিউশন</div></div>
${an.length ? `<h2>📢 ঘোষণা</h2>${an.map(a => `<div class="note"><b>${esc(a.title)}</b><br>${esc(a.body)}<div class="mu">${dt(a.created)}</div></div>`).join('')}` : ''}
<h2>আমাদের সেবাসমূহ</h2>${svc()}
<h2>কীভাবে কাজ করে</h2><div class="grid"><div class="card step"><b>১</b><h3>অ্যাকাউন্ট তৈরি করুন</h3><p class="mu">নাম, স্টুডেন্ট আইডি ও পাসওয়ার্ড দিয়ে একবারই নিবন্ধন করুন।</p></div><div class="card step"><b>২</b><h3>যাচাই করান</h3><p class="mu">আইডি কার্ডের ছবি পাঠান; অনুমোদনের পর ✔ যাচাইকৃত ব্যাজ পাবেন।</p></div><div class="card step"><b>৩</b><h3>সব সেবা ব্যবহার করুন</h3><p class="mu">একই অ্যাকাউন্টে সব সেবা নিন বা দিন, আর মেসেজে সরাসরি কথা বলুন।</p></div></div>
${(await Promise.all([recent('request', '🩸 জরুরি রক্তের প্রয়োজন'), recent('market', '🛍️ নতুন পণ্য'), recent('house', '🏠 সাম্প্রতিক বাসা ভাড়ার বিজ্ঞাপন'), recent('job', '📋 নতুন জব'), recent('tuition', '📚 টিউশন'), recent('skill', '💼 নতুন সেবা প্রদানকারী'), recent('lost', '🔎 হারানো ও পাওয়া')])).join('')}
<div class="cta"><h2 style="margin-top:0">আজই GUB Connect-এর সদস্য হোন</h2><p class="mu">একটি অ্যাকাউন্টেই সব সেবা।</p><a class="btn" href="#/${ME ? 'dashboard' : 'register'}">${ME ? 'ড্যাশবোর্ডে যান' : 'অ্যাকাউন্ট তৈরি করুন'}</a></div>`);
}
function authPage(r) {
  if (ME) return go(ME.role === 'admin' ? 'dashboard' : 'dashboard');
  view(r === 'login' ? `<h1>লগইন</h1><div class="card" style="max-width:440px"><form id="lg"><label>ইমেইল বা স্টুডেন্ট আইডি</label><input name="id" required autocomplete="username"><label>পাসওয়ার্ড</label><input name="password" type="password" required autocomplete="current-password"><div class="row"><button class="btn">লগইন</button><a class="btn o" href="#/register">নতুন অ্যাকাউন্ট</a></div><p class="mu">পাসওয়ার্ড ভুলে গেলে সাহায্যের জন্য অ্যাডমিনের সাথে যোগাযোগ করুন।</p></form></div>`
    : `<h1>অ্যাকাউন্ট তৈরি করুন</h1><div class="card" style="max-width:520px"><form id="rg"><label>পূর্ণ নাম *</label><input name="name" required><label>স্টুডেন্ট আইডি *</label><input name="sid" required><label>বিশ্ববিদ্যালয়ের ইমেইল *</label><input name="email" type="email" required><label>অ্যাকাউন্টের ধরন *</label>${sel('type', ['শিক্ষার্থী', 'শিক্ষক', 'বিশ্ববিদ্যালয় কর্মী'])}<label>বিভাগ</label><input name="dept"><label>ব্যাচ</label><input name="batch"><label>বর্তমান সেমিস্টার</label><input name="sem"><label>ফোন নম্বর (প্রকাশ করা হয় না)</label><input name="phone" inputmode="tel"><label>পাসওয়ার্ড * (কমপক্ষে ৮ অক্ষর)</label><input name="password" type="password" minlength="8" required autocomplete="new-password"><div class="row"><button class="btn">অ্যাকাউন্ট তৈরি করুন</button><a class="btn o" href="#/login">লগইন</a></div></form></div>`);
}
// ---------- messages ----------
async function messages(id) {
  if (!need()) return; view(`<h1>বার্তাসমূহ</h1><div class="chat ${id ? 'open' : ''}"><div class="cl" id="cl"></div><div class="cw" id="cw"><div class="empty">কথোপকথন বেছে নিন</div></div></div>`);
  let last = 0; const list = async () => { const c = await api('/conversations'); $('#cl').innerHTML = c.length ? c.map(x => `<a class="ci ${String(x.id) === String(id) ? 'on' : ''}" href="#/messages/${x.id}"><b>${av(x.other)}${esc(x.other.name)}</b>${x.unread ? `<span class="badge">${bn(x.unread)}</span>` : ''}<div class="mu">${x.post ? '📌 ' + esc(x.post) + '<br>' : ''}${x.last ? esc(x.last.body).slice(0, 50) : 'নতুন কথোপকথন'}</div></a>`).join('') : '<div class="empty">কোনো কথোপকথন নেই। যেকোনো পোস্টে “মেসেজ করুন” চাপুন।</div>'; };
  await list(); if (!id) { timer = setInterval(list, 5000); return; }
  const d = await api(`/conversations/${id}/messages`); $('#cw').innerHTML = `<div style="padding:10px 14px;border-bottom:1px solid var(--bd)"><a href="#/messages" class="mu">← সব বার্তা</a> <b>${esc(d.other.name)}</b>${badge(d.other)}</div><div class="msgs" id="ms"></div><form id="mf" data-id="${id}"><input name="body" placeholder="বার্তা লিখুন…" maxlength="2000" autocomplete="off" required><button class="btn">পাঠান</button></form>`;
  const add = ms => { const b = $('#ms'); ms.forEach(m => { b.insertAdjacentHTML('beforeend', `<div class="m ${m.sender === ME.id ? 'me' : ''}">${esc(m.body)}<small>${dtt(m.created)}</small></div>`); last = m.id; }); if (ms.length) b.scrollTop = b.scrollHeight; };
  add(d.messages); pending = async () => { const x = await api(`/conversations/${id}/messages?after=${last}`); add(x.messages); };
  timer = setInterval(async () => { try { await pending(); await list(); } catch { } }, 4000);
}
// ---------- dashboard ----------
async function dash(t) {
  if (!need()) return; const T = [['profile', 'আমার প্রোফাইল'], ['mine', 'আমার পোস্টসমূহ'], ['fav', 'পছন্দের তালিকা'], ['sent', 'আমার আবেদনসমূহ'], ['recv', 'প্রাপ্ত অনুরোধ'], ['notif', 'নোটিফিকেশন'], ['settings', 'অ্যাকাউন্ট সেটিংস'], ['help', 'সাহায্য ও অভিযোগ']];
  let b = ''; const u = ME;
  if (t === 'profile') { const VN = { none: 'যাচাই করা হয়নি', pending: 'অনুমোদনের অপেক্ষায়', approved: 'যাচাইকৃত ✔', rejected: 'প্রত্যাখ্যাত' };
    b = `<div class="grid"><div class="card"><h3>${av(u)}${esc(u.name)}</h3><div class="mu">${esc(u.type)} · আইডি ${esc(u.sid)}<br>${esc(u.email)}</div><span class="tag">${VN[u.vstatus]}</span><form id="pe"><label>পূর্ণ নাম</label><input name="name" value="${esc(u.name)}" required><label>বিভাগ</label><input name="dept" value="${esc(u.dept)}"><label>ব্যাচ</label><input name="batch" value="${esc(u.batch)}"><label>সেমিস্টার</label><input name="sem" value="${esc(u.sem)}"><label>ফোন (প্রকাশ করা হয় না)</label><input name="phone" value="${esc(u.phone)}"><label>প্রোফাইল ছবি</label><input name="avatar" type="file" accept="image/*"><div class="row"><button class="btn">সংরক্ষণ</button></div></form></div>
<div class="card"><h3>অ্যাকাউন্ট যাচাই</h3><p class="mu">স্টুডেন্ট/স্টাফ আইডি কার্ডের স্পষ্ট ছবি দিন। ছবিটি শুধু সুপার অ্যাডমিন দেখতে পারবেন, অন্য কেউ নয়।</p>${u.vstatus === 'approved' ? '<div class="note">আপনার অ্যাকাউন্ট যাচাই হয়েছে ✔</div>' : u.vstatus === 'pending' ? '<div class="note">আপনার অনুরোধ পর্যালোচনায় আছে।</div>' : `<form id="vf"><input name="file" type="file" accept="image/*" required><label>অতিরিক্ত তথ্য (ঐচ্ছিক)</label><input name="note" maxlength="300"><div class="row"><button class="btn">যাচাইয়ের অনুরোধ পাঠান</button></div></form>`}</div></div>`; }
  if (t === 'mine' || t === 'fav') { const d = await api(`/posts?${t === 'mine' ? 'mine=1' : 'fav=1'}&ps=50`); b = d.items.length ? `<div class="grid">${d.items.map(card).join('')}</div>` : '<div class="empty">কিছু নেই।</div>'; }
  if (t === 'sent' || t === 'recv') { const l = await api('/requests?box=' + t), SN = { pending: 'অপেক্ষমাণ', accepted: 'গৃহীত', declined: 'প্রত্যাখ্যাত' }; b = l.length ? `<div class="grid">${l.map(h => `<div class="card"><span class="tag">${SN[h.status]}</span><h3>${esc(h.title || 'মুছে ফেলা পোস্ট')}</h3><p class="mu">${esc(h.message)}</p><div class="mu">${t === 'sent' ? 'পোস্টকারী' : 'অনুরোধকারী'}: ${esc(h.oname)} · ${dt(h.created)}</div><div class="row"><button class="btn s o" data-a="msg" data-u="${h.oid}">💬 মেসেজ</button>${t === 'recv' && h.status === 'pending' ? `<button class="btn s" data-a="rst" data-id="${h.id}" data-v="accepted">গ্রহণ</button><button class="btn s r" data-a="rst" data-id="${h.id}" data-v="declined">প্রত্যাখ্যান</button>` : ''}</div></div>`).join('')}</div>` : '<div class="empty">কিছু নেই।</div>'; }
  if (t === 'notif') { const l = await api('/notifications'); b = l.length ? l.map(n => `<a class="card" style="display:block;margin-bottom:8px;text-decoration:none;color:inherit;${n.read ? '' : 'border-color:var(--g)'}" href="${esc(n.link || '#/dashboard/notif')}"><b>${esc(n.title)}</b><div class="mu">${esc(n.body)} · ${dtt(n.created)}</div></a>`).join('') : '<div class="empty">কোনো নোটিফিকেশন নেই।</div>'; if (UN.notifications) { await api('/notifications/read', { method: 'POST', body: {} }); UN.notifications = 0; head(); } }
  if (t === 'settings') b = `<div class="card" style="max-width:440px"><h3>পাসওয়ার্ড পরিবর্তন</h3><form id="pw"><label>বর্তমান পাসওয়ার্ড</label><input name="old" type="password" required><label>নতুন পাসওয়ার্ড (কমপক্ষে ৮ অক্ষর)</label><input name="new" type="password" minlength="8" required><div class="row"><button class="btn">পরিবর্তন করুন</button><button type="button" class="btn r" data-a="logout">লগআউট</button></div></form></div>`;
  if (t === 'help') b = '<div class="note">যেকোনো পোস্টে “রিপোর্ট” বোতাম চেপে অভিযোগ জানান। অ্যাডমিন পর্যালোচনা করে ব্যবস্থা নেবেন এবং আপনাকে নোটিফিকেশন দেবেন।</div>';
  view(`<h1>আমার ড্যাশবোর্ড</h1><div class="tabs">${T.map(([k, n]) => `<a class="btn s ${k === t ? '' : 'o'}" href="#/dashboard/${k}">${n}</a>`).join('')}</div>${b}`);
}
function about() {
  const li = a => `<ul>${a.map(x => `<li>${x}</li>`).join('')}</ul>`;
  return `<div class="pg"><h1>আমাদের সম্পর্কে</h1><div class="note"><b>GUB Connect</b> হলো Green University of Bangladesh-এর শিক্ষার্থী, শিক্ষক ও কর্মীদের জন্য একটি ডিজিটাল কমিউনিটি প্ল্যাটফর্ম, যেখানে একটি অ্যাকাউন্টে প্রয়োজনীয় সব সেবা পাওয়া যায়।</div>
<h2>আমাদের উদ্দেশ্য</h2><p>ক্যাম্পাসজীবনের প্রতিদিনের প্রয়োজন—থাকার জায়গা খোঁজা, জরুরি রক্তের ব্যবস্থা, হারানো জিনিস ফিরে পাওয়া, পণ্য কেনাবেচা, দক্ষতা কাজে লাগানো, পার্ট-টাইম জব ও টিউশন খোঁজা—সবকিছু বিভিন্ন গ্রুপ ও মাধ্যমে ছড়িয়ে থাকে। আমরা এগুলো এক জায়গায় এনে নিরাপদ, সহজ ও বিশ্বাসযোগ্য করতে চাই।</p>
<h2>আমরা কী সেবা দিই</h2>${li(['<b>🏠 বাসা ভাড়া:</b> ব্যাচেলর, শেয়ার্ড, ফ্যামিলি, সাবলেট ও হোস্টেল—এলাকা, ভাড়া ও ধরন অনুযায়ী খুঁজুন; ছবি ও ভিডিওসহ বিজ্ঞাপন দিন।', '<b>🩸 ব্লাড ডোনেশন:</b> রক্তের গ্রুপ ও এলাকা অনুযায়ী দাতা খুঁজুন, জরুরি অনুরোধ প্রকাশ করুন।', '<b>🔎 হারানো ও পাওয়া:</b> ক্যাম্পাসে হারানো বা পাওয়া জিনিসের পোস্ট দিন; ফেরত পাওয়া গেলে চিহ্নিত করুন।', '<b>🛍️ কেনাবেচা:</b> বই, নোট, ইলেকট্রনিক্সসহ সব পণ্য—ছবি ও ভিডিও দেখে কিনুন।', '<b>💼 দক্ষতা ও সেবা:</b> ডিজাইন, প্রোগ্রামিং, ফটোগ্রাফিসহ নানা ক্যাটাগরিতে সেবা দিন বা নিয়োগের অনুরোধ পাঠান; সেবা বিনামূল্যেও হতে পারে।', '<b>📋 জব:</b> খণ্ডকালীন, ইন্টার্নশিপ, ফ্রিল্যান্সসহ জবের বিজ্ঞাপন দিন ও আবেদন করুন।', '<b>📚 টিউশন:</b> টিউশন দিতে চাইলে বা শিক্ষক খুঁজলে বিষয়, লেভেল ও এলাকা দিয়ে পোস্ট করুন।', '<b>💬 নিরাপদ মেসেজিং:</b> ফোন নম্বর না দিয়েই প্ল্যাটফর্মের ভেতরে সরাসরি কথা বলুন।', '<b>👤 ইউনিফাইড ড্যাশবোর্ড:</b> সব পোস্ট, আবেদন, পছন্দ ও নোটিফিকেশন এক জায়গায়।'])}
<h2>কীভাবে শুরু করবেন</h2>${li(['“অ্যাকাউন্ট তৈরি করুন” চেপে নাম, স্টুডেন্ট আইডি, ইমেইল ও পাসওয়ার্ড দিন।', 'প্রোফাইল থেকে আইডি কার্ডের ছবি দিয়ে যাচাইয়ের অনুরোধ পাঠান; অনুমোদনের পর ✔ যাচাইকৃত ব্যাজ পাবেন।', 'পছন্দের সেবায় গিয়ে পোস্ট করুন, খুঁজুন বা মেসেজ করুন।'])}
<h2>নিরাপত্তা ও কমিউনিটি নীতি</h2>${li(['প্রতিটি পোস্টে “রিপোর্ট” বোতাম আছে—ভুয়া, প্রতারণামূলক, অনুপযুক্ত বা স্প্যাম কনটেন্ট জানান।', 'সুপার অ্যাডমিন রিপোর্ট পর্যালোচনা করে পোস্ট লুকাতে বা মুছতে এবং অ্যাকাউন্ট স্থগিত বা নিষিদ্ধ করতে পারেন; সব প্রশাসনিক কাজের অডিট লগ রাখা হয়।', 'আপনার ফোন নম্বর ও ইমেইল অন্য সদস্যদের দেখানো হয় না।', 'আইডি কার্ডের ছবি শুধু অ্যাডমিন যাচাইয়ের জন্য দেখেন।', 'কেনাবেচা, সেবা, জব ও টিউশনের লেনদেন সংশ্লিষ্ট দুই পক্ষের দায়িত্ব; প্ল্যাটফর্মে পেমেন্ট গেটওয়ে নেই। অপরিচিতের সাথে অগ্রিম টাকা লেনদেনে সতর্ক থাকুন।'])}
<div class="note warn">⚠️ <b>চিকিৎসা সতর্কতা:</b> রক্তদাতার যোগ্যতা ও রক্তসঞ্চালনের সিদ্ধান্ত অবশ্যই যোগ্য চিকিৎসক নিশ্চিত করবেন। GUB Connect শুধু যোগাযোগের মাধ্যম।</div>
<h2>গোপনীয়তা নীতি</h2><p>আমরা শুধু সেবা চালাতে প্রয়োজনীয় তথ্য (নাম, আইডি, ইমেইল, বিভাগ, ফোন) সংরক্ষণ করি। পাসওয়ার্ড এনক্রিপ্টেড (scrypt হ্যাশ) অবস্থায় থাকে। আপনি প্রোফাইল ও পোস্ট যেকোনো সময় সম্পাদনা বা মুছতে পারেন। আপনার তথ্য বিজ্ঞাপনের জন্য বিক্রি করা হয় না।</p>
<h2>ব্যবহারের শর্তাবলি</h2>${li(['সঠিক তথ্য দিন এবং অন্য কারও পরিচয় ব্যবহার করবেন না।', 'আইনবিরুদ্ধ, প্রতারণামূলক বা হয়রানিমূলক কনটেন্ট নিষিদ্ধ।', 'নিয়ম ভঙ্গ করলে অ্যাকাউন্ট স্থগিত বা নিষিদ্ধ হতে পারে।'])}
<h2>সাধারণ প্রশ্ন</h2><details><summary>এটি কি বিনামূল্যে?</summary><p>হ্যাঁ, সদস্য হতে ও ব্যবহার করতে কোনো ফি নেই।</p></details><details><summary>কে অ্যাকাউন্ট খুলতে পারেন?</summary><p>শিক্ষার্থী, শিক্ষক ও বিশ্ববিদ্যালয়ের কর্মীরা।</p></details><details><summary>পাসওয়ার্ড ভুলে গেলে?</summary><p>অ্যাডমিনের সাথে যোগাযোগ করুন; তিনি অস্থায়ী পাসওয়ার্ড দেবেন, লগইনের পর আপনি তা পরিবর্তন করে নিন।</p></details><details><summary>ছবি ও ভিডিও কত বড় হতে পারে?</summary><p>প্রতিটি ছবি ৮ এমবি ও ভিডিও সর্বোচ্চ ${CFG.maxVideoMb} এমবি; প্রতি পোস্টে ৫টি পর্যন্ত।</p></details>
<div class="cta"><a class="btn" href="#/register">অ্যাকাউন্ট তৈরি করুন</a></div></div>`;
}
// ---------- events ----------
let deb; document.addEventListener('input', e => { const i = e.target.id; if (['q', 'max'].includes(i)) { S[i] = e.target.value; S.page = 1; clearTimeout(deb); deb = setTimeout(loadList, 300); } });
document.addEventListener('change', e => { if (e.target.id === 'flt') { S.f = e.target.value; S.page = 1; loadList(); } });
async function uploadFile(f) { const fd = new FormData(); fd.append('file', f); return api('/upload', { body: fd }); }
document.addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, id = f.id, btn = f.querySelector('button:not([type=button])'); if (btn) btn.disabled = true;
  try {
    if (id === 'lg') { const r = await api('/login', { body: fdata(f) }); if (r.role === 'admin') { location.href = '/admin'; return; } await refreshMe(); go('dashboard'); }
    else if (id === 'rg') { await api('/register', { body: fdata(f) }); await refreshMe(); toast('অ্যাকাউন্ট তৈরি হয়েছে। স্বাগতম!'); go('dashboard'); }
    else if (id === 'pf') {
      const k = f.dataset.k, files = [...f.files.files]; if (files.length > 5) throw new Error('সর্বোচ্চ ৫টি ফাইল'); const media = [];
      for (let i = 0; i < files.length; i++) { btn.textContent = `আপলোড হচ্ছে ${bn(i + 1)}/${bn(files.length)}…`; const r = await uploadFile(files[i]); media.push(r.url); }
      btn.textContent = 'প্রকাশ হচ্ছে…'; await api('/posts', { body: { kind: k, data: fdata(f), media } }); S.form = false; toast('পোস্ট প্রকাশিত হয়েছে'); await route();
    }
    else if (id === 'pe') { const d = fdata(f), file = f.avatar.files[0]; if (file) d.avatar = (await uploadFile(file)).url; await api('/me', { method: 'PATCH', body: d }); await refreshMe(); toast('সংরক্ষিত হয়েছে'); await route(); }
    else if (id === 'vf') { await api('/verify', { body: new FormData(f) }); await refreshMe(); toast('যাচাইয়ের অনুরোধ পাঠানো হয়েছে'); await route(); }
    else if (id === 'pw') { await api('/me/password', { body: fdata(f) }); f.reset(); toast('পাসওয়ার্ড পরিবর্তিত হয়েছে'); }
    else if (id === 'mf') { const i = f.body; const v = i.value; i.value = ''; await api(`/conversations/${f.dataset.id}/messages`, { body: { body: v } }); await pending(); }
    else if (id === 'rf') { const d = fdata(f); await api('/reports', { body: { postId: f.dataset.id, reason: d.reason, details: d.details } }); closeModal(); toast('রিপোর্ট জমা হয়েছে। ধন্যবাদ।'); }
    else if (id === 'af') { const d = fdata(f); await api('/requests', { body: { postId: f.dataset.id, message: d.message } }); closeModal(); toast('অনুরোধ পাঠানো হয়েছে'); }
  } catch (x) { toast(x.message, 1); if (btn) { btn.disabled = false; if (id === 'pf') btn.textContent = 'প্রকাশ করুন'; } return; }
  if (btn) btn.disabled = false;
});
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-a]'); if (!t) return; const a = t.dataset.a, id = t.dataset.id, v = t.dataset.v;
  try {
    if (a === 'close') closeModal();
    else if (a === 'tab') { S.kind = t.dataset.k; S.q = S.f = S.max = ''; S.page = 1; S.form = false; await route(); }
    else if (a === 'add') { if (!need()) return; S.form = true; $('#form').innerHTML = formHtml(S.kind); $('#form').scrollIntoView({ behavior: 'smooth' }); }
    else if (a === 'cancel') { S.form = false; $('#form').innerHTML = ''; }
    else if (a === 'pg') { S.page = +v; await loadList(); scrollTo(0, 0); }
    else if (a === 'logout') { await api('/logout', { method: 'POST', body: {} }); ME = null; UN = { messages: 0, notifications: 0 }; go('home'); head(); }
    else if (a === 'msg') { if (!need()) return; const r = await api('/conversations', { body: { to: +t.dataset.u, postId: id ? +id : undefined } }); go('messages/' + r.id); }
    else if (a === 'apply') { if (!need()) return; modal(`<h3>আপনার বার্তা</h3><form id="af" data-id="${id}"><label>নিজের সম্পর্কে ও কেন আগ্রহী লিখুন</label><textarea name="message" rows="4" minlength="5" maxlength="1000" required></textarea><div class="row"><button class="btn">পাঠান</button></div></form>`); }
    else if (a === 'report') { if (!need()) return; modal(`<h3>রিপোর্ট করুন</h3><form id="rf" data-id="${id}"><label>কারণ</label>${sel('reason', CFG.reasons)}<label>বিস্তারিত (ঐচ্ছিক)</label><textarea name="details" rows="3" maxlength="500"></textarea><div class="row"><button class="btn r">জমা দিন</button></div></form>`); }
    else if (a === 'fav') { if (!need()) return; const r = await api('/favorites/' + id, { body: {} }); t.textContent = r.fav ? '♥ পছন্দের' : '♡ পছন্দ'; }
    else if (a === 'done') { await api('/posts/' + id, { method: 'PATCH', body: { status: v } }); await route(); }
    else if (a === 'del') { if (confirm('মুছে ফেলবেন?')) { await api('/posts/' + id, { method: 'DELETE' }); toast('মুছে ফেলা হয়েছে'); await route(); } }
    else if (a === 'rst') { await api('/requests/' + id, { method: 'PATCH', body: { status: v } }); await route(); }
  } catch (x) { toast(x.message, 1); }
});
boot();
