'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bn = n => Number(n || 0).toLocaleString('bn-BD'), dt = t => new Date(t).toLocaleDateString('bn-BD'), dtt = t => new Date(t).toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' });
async function api(u, o = {}) {
  const fd = o.body instanceof FormData;
  const r = await fetch('/api' + u, { method: o.method || (o.body ? 'POST' : 'GET'), headers: o.body && !fd ? { 'Content-Type': 'application/json' } : {}, body: o.body ? (fd ? o.body : JSON.stringify(o.body)) : undefined, credentials: 'same-origin' });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'সমস্যা হয়েছে, আবার চেষ্টা করুন'); return j;
}
function toast(m, bad) { const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3500); }
function modal(html) { closeModal(); const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = '<div>' + html + '<div class="row"><button class="btn s o" data-a="close">বন্ধ করুন</button></div></div>'; m.addEventListener('click', e => { if (e.target === m) closeModal(); }); document.body.appendChild(m); return m; }
function closeModal() { document.querySelectorAll('.modal').forEach(m => m.remove()); }
const sel = (n, opts, v) => `<select name="${n}">${opts.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
function field(f, d = {}) { const [n, l, t, o, req] = f; return `<label>${esc(l)}${req ? ' *' : ''}</label>` + (t === 'select' ? sel(n, o, d[n]) : t === 'area' ? `<textarea name="${n}" rows="3" maxlength="2000">${esc(d[n])}</textarea>` : `<input name="${n}" type="${t}" ${t === 'number' ? 'min="0" inputmode="numeric"' : ''} value="${esc(d[n])}" ${req ? 'required' : ''} maxlength="200">`); }
const fdata = f => Object.fromEntries([...new FormData(f)].filter(([, v]) => typeof v === 'string'));
const badge = u => u && u.verified ? ' <span class="tag">✔ যাচাইকৃত</span>' : '';
const av = u => u && u.avatar ? `<img class="av" src="${esc(u.avatar)}" alt="">` : `<span class="av">${esc((u && u.name || '?')[0])}</span>`;
function mediaHtml(m) { return m && m.length ? `<div class="media">${m.map(x => x.t === 'video' ? `<video src="${esc(x.u)}" controls preload="metadata" playsinline></video>` : `<img src="${esc(x.u)}" alt="" loading="lazy">`).join('')}</div>` : ''; }
