'use strict';
// GUB Connect — zero-dependency server (Node.js 22.5+ built-in SQLite). No npm install needed.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const PORT = +process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUB = path.join(__dirname, 'public'), UP = path.join(DATA, 'uploads'), PRIV = path.join(DATA, 'private');
const SECURE = process.env.COOKIE_SECURE === '1', PROXY = process.env.TRUST_PROXY === '1';
const MAX_IMG = 8 << 20, MAX_VID = (+process.env.MAX_VIDEO_MB || 40) << 20;
for (const d of [DATA, UP, PRIV]) fs.mkdirSync(d, { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'gub.db'));
db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,sid TEXT UNIQUE NOT NULL,name TEXT NOT NULL,type TEXT,dept TEXT,batch TEXT,sem TEXT,phone TEXT,avatar TEXT,pass TEXT NOT NULL,role TEXT DEFAULT 'user',status TEXT DEFAULT 'active',vstatus TEXT DEFAULT 'none',vfile TEXT,vnote TEXT,created INTEGER,last_login INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,expires INTEGER);
CREATE TABLE IF NOT EXISTS uploads(name TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,type TEXT,created INTEGER);
CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,title TEXT,data TEXT,media TEXT DEFAULT '[]',status TEXT DEFAULT 'active',created INTEGER,updated INTEGER);
CREATE INDEX IF NOT EXISTS ix_posts ON posts(kind,status,created);CREATE INDEX IF NOT EXISTS ix_posts_u ON posts(user_id);
CREATE TABLE IF NOT EXISTS favorites(user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,PRIMARY KEY(user_id,post_id));
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY,post_id INTEGER,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,reason TEXT,details TEXT,status TEXT DEFAULT 'open',note TEXT,created INTEGER);
CREATE TABLE IF NOT EXISTS conversations(id INTEGER PRIMARY KEY,a INTEGER REFERENCES users(id) ON DELETE CASCADE,b INTEGER REFERENCES users(id) ON DELETE CASCADE,post_id INTEGER,updated INTEGER,UNIQUE(a,b));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,conv_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,sender INTEGER REFERENCES users(id) ON DELETE CASCADE,body TEXT,created INTEGER);
CREATE INDEX IF NOT EXISTS ix_msg ON messages(conv_id,id);
CREATE TABLE IF NOT EXISTS conv_reads(conv_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,user_id INTEGER,last_id INTEGER,PRIMARY KEY(conv_id,user_id));
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,type TEXT,title TEXT,body TEXT,link TEXT,read INTEGER DEFAULT 0,created INTEGER);
CREATE INDEX IF NOT EXISTS ix_notif ON notifications(user_id,read);
CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY,post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,from_id INTEGER REFERENCES users(id) ON DELETE CASCADE,to_id INTEGER REFERENCES users(id) ON DELETE CASCADE,message TEXT,status TEXT DEFAULT 'pending',created INTEGER);
CREATE TABLE IF NOT EXISTS announcements(id INTEGER PRIMARY KEY,title TEXT,body TEXT,created INTEGER);
CREATE TABLE IF NOT EXISTS adda_profiles(
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 visible INTEGER NOT NULL DEFAULT 0,
 availability TEXT NOT NULL DEFAULT 'busy',
 interests TEXT NOT NULL DEFAULT '[]',
 bio TEXT DEFAULT '',
 updated INTEGER
);
CREATE INDEX IF NOT EXISTS ix_adda_visible ON adda_profiles(visible,availability);
CREATE TABLE IF NOT EXISTS adda_reports(
 id INTEGER PRIMARY KEY,
 reporter_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 target_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 reason TEXT NOT NULL,
 details TEXT DEFAULT '',
 status TEXT DEFAULT 'open',
 created INTEGER
);
CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY,user_id INTEGER,action TEXT,meta TEXT,ip TEXT,created INTEGER);`);

// ---------- content schema (single source of truth, also sent to the browser) ----------
const SEL8 = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const KINDS = {
  house: { n: 'বাসা ভাড়া', done: 'ভাড়া হয়ে গেছে', flt: 'roomType', num: 'rent', media: 1, f: [['title', 'শিরোনাম', 'text', 0, 1], ['location', 'এলাকা', 'text', 0, 1], ['rent', 'মাসিক ভাড়া (৳)', 'number', 0, 1], ['roomType', 'ধরন', 'select', ['ব্যাচেলর রুম', 'শেয়ার্ড রুম', 'ফ্যামিলি অ্যাপার্টমেন্ট', 'সিঙ্গেল রুম', 'সাবলেট', 'হোস্টেল'], 1], ['rooms', 'রুম সংখ্যা', 'number'], ['facilities', 'সুবিধাসমূহ', 'text'], ['avail', 'খালি হওয়ার তারিখ', 'date'], ['desc', 'বিবরণ', 'area']] },
  request: { n: 'জরুরি রক্তের প্রয়োজন', done: 'প্রয়োজন মিটেছে', flt: 'group', f: [['patient', 'রোগীর নাম', 'text', 0, 1], ['group', 'রক্তের গ্রুপ', 'select', SEL8, 1], ['hospital', 'হাসপাতাল', 'text', 0, 1], ['location', 'এলাকা', 'text', 0, 1], ['date', 'প্রয়োজনের তারিখ', 'date', 0, 1], ['bags', 'ব্যাগ সংখ্যা', 'number', 0, 1], ['desc', 'অতিরিক্ত তথ্য', 'area']] },
  donor: { n: 'রক্তদাতা', done: 'এখন দিতে পারব না', flt: 'group', f: [['name', 'নাম', 'text', 0, 1], ['group', 'রক্তের গ্রুপ', 'select', SEL8, 1], ['location', 'বর্তমান এলাকা', 'text', 0, 1], ['last', 'সর্বশেষ রক্তদান', 'date']] },
  lost: { n: 'হারানো ও পাওয়া', done: 'ফেরত পাওয়া গেছে', flt: 'type', media: 1, f: [['item', 'জিনিসের নাম', 'text', 0, 1], ['type', 'ধরন', 'select', ['হারিয়েছি', 'পেয়েছি'], 1], ['cat', 'ক্যাটাগরি', 'select', ['স্টুডেন্ট আইডি কার্ড', 'মোবাইল ফোন', 'মানিব্যাগ', 'কাগজপত্র', 'বই', 'চাবি', 'অন্যান্য'], 1], ['location', 'স্থান', 'text', 0, 1], ['date', 'তারিখ', 'date', 0, 1], ['desc', 'বিবরণ (সব শনাক্তকারী তথ্য প্রকাশ করবেন না)', 'area']] },
  market: { n: 'কেনাবেচা', done: 'বিক্রি হয়ে গেছে', flt: 'cat', num: 'price', media: 1, f: [['title', 'পণ্যের নাম', 'text', 0, 1], ['cat', 'ক্যাটাগরি', 'select', ['বই', 'একাডেমিক নোট', 'ইলেকট্রনিক্স', 'মোবাইল ফোন', 'ল্যাপটপ', 'পোশাক', 'অ্যাক্সেসরিজ', 'খাবার', 'হস্তশিল্প', 'অন্যান্য'], 1], ['price', 'দাম (৳)', 'number', 0, 1], ['desc', 'বিবরণ', 'area']] },
  skill: { n: 'দক্ষতা ও সেবা', done: 'এখন ব্যস্ত', flt: 'cat', num: 'price', media: 1, apply: 'নিয়োগের অনুরোধ', f: [['title', 'সেবার শিরোনাম', 'text', 0, 1], ['cat', 'ক্যাটাগরি', 'select', ['ওয়েবসাইট ডেভেলপমেন্ট', 'গ্রাফিক ডিজাইন', 'লোগো ডিজাইন', 'ভিডিও এডিটিং', 'ফটোগ্রাফি', 'কনটেন্ট রাইটিং', 'ডিজিটাল মার্কেটিং', 'প্রোগ্রামিং', 'গান ও সংগীত', 'ইভেন্ট ফটোগ্রাফি', 'অনুবাদ', 'প্রেজেন্টেশন ডিজাইন', 'ডেটা এন্ট্রি', 'অন্যান্য'], 1], ['price', 'মূল্য (৳, বিনামূল্যে হলে ০)', 'number', 0, 1], ['exp', 'অভিজ্ঞতা', 'text'], ['link', 'পোর্টফোলিও লিংক', 'text'], ['desc', 'বিবরণ', 'area']] },
  job: { n: 'জব', done: 'পদ পূরণ হয়েছে', flt: 'jtype', apply: 'আবেদন করুন', f: [['title', 'পদের নাম', 'text', 0, 1], ['company', 'প্রতিষ্ঠান', 'text', 0, 1], ['jtype', 'জবের ধরন', 'select', ['পূর্ণকালীন', 'খণ্ডকালীন', 'ইন্টার্নশিপ', 'ফ্রিল্যান্স', 'রিমোট'], 1], ['location', 'কর্মস্থল', 'text'], ['salary', 'বেতন (৳, মাসিক)', 'number'], ['deadline', 'আবেদনের শেষ তারিখ', 'date'], ['desc', 'দায়িত্ব ও যোগ্যতা', 'area', 0, 1]] },
  tuition: { n: 'টিউশন', done: 'টিউশন নিশ্চিত হয়েছে', flt: 'role', num: 'fee', media: 1, apply: 'আগ্রহ জানান', f: [['title', 'শিরোনাম', 'text', 0, 1], ['role', 'আপনি কী চান', 'select', ['টিউশন দিতে চাই (শিক্ষক)', 'টিউশন খুঁজছি (শিক্ষার্থী/অভিভাবক)'], 1], ['subject', 'বিষয়', 'text', 0, 1], ['level', 'ক্লাস / লেভেল', 'select', ['প্রাথমিক', 'ষষ্ঠ–অষ্টম', 'নবম–দশম (SSC)', 'একাদশ–দ্বাদশ (HSC)', 'ও-লেভেল / এ-লেভেল', 'বিশ্ববিদ্যালয়', 'ভর্তি প্রস্তুতি'], 1], ['mode', 'মাধ্যম', 'select', ['বাসায় গিয়ে', 'শিক্ষকের কাছে', 'অনলাইন'], 1], ['location', 'এলাকা', 'text'], ['days', 'সপ্তাহে কত দিন', 'number'], ['fee', 'মাসিক ফি (৳)', 'number'], ['desc', 'বিবরণ', 'area']] }
};
const REASONS = ['ভুয়া অ্যাকাউন্ট', 'প্রতারণামূলক বিজ্ঞাপন', 'অনুপযুক্ত কনটেন্ট', 'বিভ্রান্তিকর মূল্য', 'সন্দেহজনক কার্যকলাপ', 'হয়রানি', 'স্প্যাম'];

// ---------- helpers ----------
const now = () => Date.now(), E = (m, c = 400) => Object.assign(new Error(m), { code: c });
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
const check = (pw, h) => { const [s, x] = h.split(':'); const y = crypto.scryptSync(pw, s, 64).toString('hex'); return crypto.timingSafeEqual(Buffer.from(x), Buffer.from(y)); };
const ip = req => (PROXY && req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
const log = (uid, action, meta, req) => db.prepare('INSERT INTO logs(user_id,action,meta,ip,created) VALUES(?,?,?,?,?)').run(uid || null, action, meta ? String(meta).slice(0, 300) : null, req ? ip(req) : null, now());
const notify = (uid, type, title, body, link) => db.prepare('INSERT INTO notifications(user_id,type,title,body,link,created) VALUES(?,?,?,?,?,?)').run(uid, type, title, body || '', link || '', now());
const buckets = new Map();
function rl(key, max, ms) { const t = now(), b = buckets.get(key); if (!b || b.r < t) { buckets.set(key, { c: 1, r: t + ms }); return; } if (++b.c > max) throw E('অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।', 429); }
setInterval(() => { const t = now(); for (const [k, b] of buckets) if (b.r < t) buckets.delete(k); db.prepare('DELETE FROM sessions WHERE expires<?').run(t); }, 600000).unref();
const pub = r => ({ id: r.id, name: r.name, dept: r.dept, avatar: r.avatar, verified: r.vstatus === 'approved' });
const me = u => ({ id: u.id, email: u.email, sid: u.sid, name: u.name, type: u.type, dept: u.dept, batch: u.batch, sem: u.sem, phone: u.phone, avatar: u.avatar, role: u.role, status: u.status, vstatus: u.vstatus, verified: u.vstatus === 'approved' });
function readRaw(req, limit) { return new Promise((ok, no) => { const c = []; let n = 0; req.on('data', d => { n += d.length; if (n > limit) { no(E('ফাইল বা অনুরোধ অনেক বড়', 413)); req.pause(); } else c.push(d); }); req.on('end', () => ok(Buffer.concat(c))); req.on('error', no); }); }
async function readJson(req) { const b = await readRaw(req, 1 << 20); try { return b.length ? JSON.parse(b) : {}; } catch { throw E('ভুল অনুরোধ'); } }
function multipart(buf, ct) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ct || ''); if (!m) throw E('ভুল অনুরোধ');
  const b = Buffer.from('--' + (m[1] || m[2])), parts = []; let pos = buf.indexOf(b);
  while (pos >= 0) { const nx = buf.indexOf(b, pos + b.length); if (nx < 0) break; const part = buf.subarray(pos + b.length + 2, nx - 2), he = part.indexOf('\r\n\r\n'); if (he > 0) { const head = part.subarray(0, he).toString('utf8'); const nm = /name="([^"]*)"/.exec(head), fn = /filename="([^"]*)"/.exec(head); parts.push({ name: nm && nm[1], filename: fn && fn[1], data: part.subarray(he + 4) }); } pos = nx; }
  return parts;
}
function sniff(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { ext: 'jpg', img: 1 };
  if (b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47]))) return { ext: 'png', img: 1 };
  if (b.subarray(0, 3).toString() === 'GIF') return { ext: 'gif', img: 1 };
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return { ext: 'webp', img: 1 };
  if (b.subarray(4, 8).toString() === 'ftyp') return { ext: 'mp4' };
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return { ext: 'webm' };
  return null;
}
function validate(kind, d) {
  const K = KINDS[kind]; if (!K) throw E('অজানা ক্যাটাগরি'); const o = {};
  for (const [k, l, t, opt, req] of K.f) {
    let v = d && d[k]; if (v == null || String(v).trim() === '') { if (req) throw E(l.split(' (')[0] + ' দিতে হবে'); continue; }
    v = String(v).trim();
    if (t === 'number' && !/^\d{1,9}$/.test(v)) throw E(l.split(' (')[0] + ' সংখ্যায় দিন');
    if (t === 'select' && !opt.includes(v)) throw E(l.split(' (')[0] + ' সঠিক নয়');
    if (t === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw E(l.split(' (')[0] + ' সঠিক তারিখ দিন');
    if (v.length > (t === 'area' ? 2000 : 200)) throw E(l.split(' (')[0] + ' অনেক বড়');
    o[k] = v;
  }
  return o;
}
function checkMedia(u, media) {
  if (!Array.isArray(media)) return []; if (media.length > 5) throw E('সর্বোচ্চ ৫টি ছবি/ভিডিও');
  return media.map(m => { const name = String(m || '').replace('/uploads/', ''); const r = db.prepare('SELECT name,type FROM uploads WHERE name=? AND user_id=?').get(name, u.id); if (!r) throw E('অবৈধ মিডিয়া ফাইল'); return { u: '/uploads/' + r.name, t: r.type }; });
}
function saveUpload(u, part, onlyImage) {
  if (!part || !part.data.length) throw E('ফাইল পাওয়া যায়নি'); const s = sniff(part.data); if (!s) throw E('শুধু JPG, PNG, WEBP, GIF ছবি এবং MP4, WEBM ভিডিও দেওয়া যাবে');
  if (onlyImage && !s.img) throw E('শুধু ছবি দেওয়া যাবে');
  if (part.data.length > (s.img ? MAX_IMG : MAX_VID)) throw E(s.img ? 'ছবি ৮ এমবির বেশি হতে পারবে না' : `ভিডিও ${MAX_VID >> 20} এমবির বেশি হতে পারবে না`, 413);
  return s;
}

// ---------- auth ----------
function getUser(req) {
  const m = /(?:^|;\s*)gub_sid=([a-f0-9]{64})/.exec(req.headers.cookie || ''); if (!m) return null;
  const s = db.prepare('SELECT user_id FROM sessions WHERE token=? AND expires>?').get(sha(m[1]), now()); if (!s) return null;
  return db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id) || null;
}
function startSession(res, uid) {
  const t = crypto.randomBytes(32).toString('hex'); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(t), uid, now() + 30 * 864e5);
  res.setHeader('Set-Cookie', `gub_sid=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${SECURE ? '; Secure' : ''}`);
}
function seedAdmin() {
  if (db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@gubconnect.local').toLowerCase(); let pw = process.env.ADMIN_PASSWORD, gen = false;
  if (!pw || pw.length < 8) { pw = crypto.randomBytes(9).toString('base64url'); gen = true; }
  db.prepare("INSERT INTO users(email,sid,name,type,pass,role,vstatus,created) VALUES(?,?,?,?,?,'admin','approved',?)").run(email, 'ADMIN', 'সুপার অ্যাডমিন', 'অ্যাডমিন', hash(pw), now());
  console.log('\n=== সুপার অ্যাডমিন তৈরি হয়েছে ===\nইমেইল: ' + email + (gen ? '\nপাসওয়ার্ড: ' + pw + '\n(এটি এখনই লিখে রাখুন এবং লগইনের পর পরিবর্তন করুন)' : '\nপাসওয়ার্ড: ADMIN_PASSWORD থেকে') + '\n');
  if (gen) fs.writeFileSync(path.join(DATA, 'first-admin.txt'), `email: ${email}\npassword: ${pw}\n`, { mode: 0o600 });
}
seedAdmin();

// ---------- routes ----------
const routes = []; const R = (m, re, fn, opt) => routes.push({ m, re: new RegExp('^' + re + '$'), fn, opt });
const page = (qs, d = 12) => { const p = Math.max(1, +qs.get('page') || 1), ps = Math.min(50, +qs.get('ps') || d); return { p, ps, off: (p - 1) * ps }; };
const like = s => '%' + s.replace(/[%_\\]/g, '\\$&') + '%';

R('GET', '/api/config', async () => ({ kinds: KINDS, reasons: REASONS, maxVideoMb: MAX_VID >> 20 }));
R('GET', '/api/stats', async () => { const c = (sql, ...a) => db.prepare(sql).get(...a).n; return { members: c("SELECT COUNT(*) n FROM users WHERE role='user' AND status='active'"), posts: c("SELECT COUNT(*) n FROM posts WHERE status IN('active','done')"), donors: c("SELECT COUNT(*) n FROM posts WHERE kind='donor' AND status='active'"), services: c("SELECT COUNT(*) n FROM posts WHERE kind IN('skill','job','tuition') AND status='active'") }; });
R('GET', '/api/announcements', async () => db.prepare('SELECT * FROM announcements ORDER BY id DESC LIMIT 5').all());
R('POST', '/api/register', async ({ req, res }) => {
  rl('reg' + ip(req), 10, 36e5); const d = await readJson(req), t = x => String(d[x] || '').trim();
  const name = t('name'), email = t('email').toLowerCase(), sid = t('sid');
  if (name.length < 2 || name.length > 80) throw E('পূর্ণ নাম দিন'); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw E('সঠিক ইমেইল দিন');
  if (!/^[A-Za-z0-9-]{3,30}$/.test(sid) || sid.toUpperCase() === 'ADMIN') throw E('সঠিক স্টুডেন্ট আইডি দিন'); if (String(d.password || '').length < 8) throw E('পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে');
  if (!['শিক্ষার্থী', 'শিক্ষক', 'বিশ্ববিদ্যালয় কর্মী'].includes(t('type'))) throw E('অ্যাকাউন্টের ধরন বেছে নিন');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw E('এই ইমেইলে আগে থেকেই অ্যাকাউন্ট আছে'); if (db.prepare('SELECT 1 FROM users WHERE sid=?').get(sid)) throw E('এই স্টুডেন্ট আইডি আগে ব্যবহৃত হয়েছে');
  const r = db.prepare('INSERT INTO users(email,sid,name,type,dept,batch,sem,phone,pass,created,last_login) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(email, sid, name, t('type'), t('dept').slice(0, 80), t('batch').slice(0, 30), t('sem').slice(0, 30), t('phone').slice(0, 20), hash(d.password), now(), now());
  startSession(res, r.lastInsertRowid); log(r.lastInsertRowid, 'নিবন্ধন', null, req); return { ok: 1 };
});
R('POST', '/api/login', async ({ req, res }) => {
  rl('login' + ip(req), 15, 6e5); const d = await readJson(req), id = String(d.id || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE lower(email)=? OR lower(sid)=?').get(id, id);
  if (!u || !check(String(d.password || ''), u.pass)) throw E('ইমেইল/আইডি বা পাসওয়ার্ড সঠিক নয়', 401);
  if (u.status === 'banned') throw E('আপনার অ্যাকাউন্ট নিষিদ্ধ করা হয়েছে', 403);
  startSession(res, u.id); db.prepare('UPDATE users SET last_login=? WHERE id=?').run(now(), u.id); log(u.id, 'লগইন', null, req); return { ok: 1, role: u.role };
});
R('POST', '/api/logout', async ({ req, res, u }) => { const m = /gub_sid=([a-f0-9]{64})/.exec(req.headers.cookie || ''); if (m) db.prepare('DELETE FROM sessions WHERE token=?').run(sha(m[1])); if (u) log(u.id, 'লগআউট', null, req); res.setHeader('Set-Cookie', 'gub_sid=; HttpOnly; Path=/; Max-Age=0'); return { ok: 1 }; });
R('GET', '/api/me', async ({ u }) => u ? { user: me(u) } : { user: null });
R('PATCH', '/api/me', async ({ req, u }) => {
  const d = await readJson(req), f = {}; for (const k of ['name', 'dept', 'batch', 'sem', 'phone']) if (d[k] !== undefined) f[k] = String(d[k]).trim().slice(0, k === 'name' ? 80 : 80);
  if (f.name !== undefined && f.name.length < 2) throw E('নাম দিন');
  if (d.avatar) { const r = db.prepare("SELECT name FROM uploads WHERE name=? AND user_id=? AND type='image'").get(String(d.avatar).replace('/uploads/', ''), u.id); if (!r) throw E('অবৈধ ছবি'); f.avatar = '/uploads/' + r.name; }
  const ks = Object.keys(f); if (ks.length) db.prepare(`UPDATE users SET ${ks.map(k => k + '=?').join(',')} WHERE id=?`).run(...ks.map(k => f[k]), u.id); log(u.id, 'প্রোফাইল হালনাগাদ'); return { ok: 1 };
}, 'auth');
R('POST', '/api/me/password', async ({ req, u }) => {
  rl('pw' + u.id, 8, 6e5); const d = await readJson(req); if (!check(String(d.old || ''), u.pass)) throw E('বর্তমান পাসওয়ার্ড সঠিক নয়'); if (String(d.new || '').length < 8) throw E('নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে');
  db.prepare('UPDATE users SET pass=? WHERE id=?').run(hash(d.new), u.id); log(u.id, 'পাসওয়ার্ড পরিবর্তন', null, req); return { ok: 1 };
}, 'auth');
R('POST', '/api/upload', async ({ req, u }) => {
  rl('up' + u.id, 60, 36e5); if (u.status !== 'active') throw E('অ্যাকাউন্ট সীমাবদ্ধ', 403);
  const parts = multipart(await readRaw(req, MAX_VID + (1 << 20)), req.headers['content-type']), p = parts.find(x => x.name === 'file' && x.filename), s = saveUpload(u, p);
  const name = crypto.randomBytes(16).toString('hex') + '.' + s.ext; fs.writeFileSync(path.join(UP, name), p.data);
  db.prepare('INSERT INTO uploads VALUES(?,?,?,?)').run(name, u.id, s.img ? 'image' : 'video', now()); return { url: '/uploads/' + name, type: s.img ? 'image' : 'video' };
}, 'auth');
R('POST', '/api/verify', async ({ req, u }) => {
  rl('vf' + u.id, 5, 36e5); const parts = multipart(await readRaw(req, MAX_IMG + (1 << 20)), req.headers['content-type']), p = parts.find(x => x.name === 'file' && x.filename), s = saveUpload(u, p, true);
  const name = `${u.id}-${crypto.randomBytes(8).toString('hex')}.${s.ext}`; fs.writeFileSync(path.join(PRIV, name), p.data);
  const note = (parts.find(x => x.name === 'note') || { data: '' }).data.toString().slice(0, 300);
  if (u.vfile) fs.rm(path.join(PRIV, u.vfile), () => { }); db.prepare("UPDATE users SET vfile=?,vstatus='pending',vnote=? WHERE id=?").run(name, note, u.id); log(u.id, 'যাচাইয়ের অনুরোধ'); return { ok: 1 };
}, 'auth');

function postRow(r, uid) { const K = KINDS[r.kind]; return { id: r.id, kind: r.kind, data: JSON.parse(r.data || '{}'), media: JSON.parse(r.media || '[]'), status: r.status, created: r.created, fav: !!r.fav, mine: r.user_id === uid, author: { id: r.user_id, name: r.aname, dept: r.adept, verified: r.avs === 'approved', avatar: r.aav } }; }
const SELP = 'SELECT p.*,us.name aname,us.dept adept,us.vstatus avs,us.avatar aav,(f.post_id IS NOT NULL) fav FROM posts p JOIN users us ON us.id=p.user_id LEFT JOIN favorites f ON f.post_id=p.id AND f.user_id=? ';
R('GET', '/api/posts', async ({ qs, u }) => {
  const uid = u ? u.id : 0, { p, ps, off } = page(qs), kind = qs.get('kind'), K = KINDS[kind], w = [], a = [uid];
  let join = '';
  if (qs.get('fav') && u) w.push('f.post_id IS NOT NULL'); else if (qs.get('mine') && u) { w.push('p.user_id=?'); a.push(uid); } else { w.push("p.status IN('active','done')"); w.push("us.status='active'"); }
  if (K) { w.push('p.kind=?'); a.push(kind); if (qs.get('f') && K.flt) { w.push(`json_extract(p.data,'$.${K.flt}')=?`); a.push(qs.get('f')); } if (qs.get('max') && K.num && /^\d+$/.test(qs.get('max'))) { w.push(`CAST(json_extract(p.data,'$.${K.num}') AS INTEGER)<=?`); a.push(+qs.get('max')); } }
  else if (!qs.get('fav') && !qs.get('mine')) w.push("p.kind IN('" + Object.keys(KINDS).join("','") + "')");
  const q = (qs.get('q') || '').trim().slice(0, 60); if (q) { w.push("(p.title LIKE ? ESCAPE '\\' OR p.data LIKE ? ESCAPE '\\')"); a.push(like(q), like(q)); }
  const where = ' WHERE ' + w.join(' AND '), total = db.prepare('SELECT COUNT(*) n FROM posts p JOIN users us ON us.id=p.user_id LEFT JOIN favorites f ON f.post_id=p.id AND f.user_id=?' + where).get(...a).n;
  const items = db.prepare(SELP + where + ' ORDER BY (p.status=\'active\') DESC,p.created DESC LIMIT ? OFFSET ?').all(...a, ps, off).map(r => postRow(r, uid)); return { items, total, pages: Math.max(1, Math.ceil(total / ps)), page: p };
});
R('POST', '/api/posts', async ({ req, u }) => {
  rl('post' + u.id, 30, 36e5); if (u.status !== 'active') throw E('আপনার অ্যাকাউন্ট সীমাবদ্ধ, পোস্ট করা যাবে না', 403);
  const d = await readJson(req), data = validate(d.kind, d.data), media = KINDS[d.kind].media ? checkMedia(u, d.media) : [];
  const r = db.prepare('INSERT INTO posts(user_id,kind,title,data,media,created,updated) VALUES(?,?,?,?,?,?,?)').run(u.id, d.kind, data.title || data.item || data.patient || data.name || '', JSON.stringify(data), JSON.stringify(media), now(), now());
  log(u.id, 'নতুন পোস্ট', d.kind + '#' + r.lastInsertRowid); return { id: r.lastInsertRowid };
}, 'auth');
const own = (id, u) => { const p = db.prepare('SELECT * FROM posts WHERE id=?').get(id); if (!p) throw E('পোস্ট পাওয়া যায়নি', 404); if (p.user_id !== u.id && u.role !== 'admin') throw E('অনুমতি নেই', 403); return p; };
R('PATCH', '/api/posts/(\\d+)', async ({ req, u, m }) => { const p = own(m[1], u), d = await readJson(req); if (!['active', 'done'].includes(d.status)) throw E('ভুল অনুরোধ'); if (p.status === 'hidden') throw E('পোস্টটি অ্যাডমিন লুকিয়েছেন', 403); db.prepare('UPDATE posts SET status=?,updated=? WHERE id=?').run(d.status, now(), p.id); return { ok: 1 }; }, 'auth');
R('DELETE', '/api/posts/(\\d+)', async ({ req, u, m }) => { const p = own(m[1], u); db.prepare('DELETE FROM posts WHERE id=?').run(p.id); log(u.id, 'পোস্ট মুছেছে', p.id, req); return { ok: 1 }; }, 'auth');
R('POST', '/api/favorites/(\\d+)', async ({ u, m }) => { const x = db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND post_id=?').get(u.id, m[1]); if (x) db.prepare('DELETE FROM favorites WHERE user_id=? AND post_id=?').run(u.id, m[1]); else { if (!db.prepare('SELECT 1 FROM posts WHERE id=?').get(m[1])) throw E('পোস্ট নেই', 404); db.prepare('INSERT INTO favorites VALUES(?,?)').run(u.id, m[1]); } return { fav: !x }; }, 'auth');
R('POST', '/api/reports', async ({ req, u }) => { rl('rep' + u.id, 20, 36e5); const d = await readJson(req); if (!REASONS.includes(d.reason) || !db.prepare('SELECT 1 FROM posts WHERE id=?').get(+d.postId)) throw E('ভুল অনুরোধ'); db.prepare('INSERT INTO reports(post_id,user_id,reason,details,created) VALUES(?,?,?,?,?)').run(+d.postId, u.id, d.reason, String(d.details || '').slice(0, 500), now()); log(u.id, 'রিপোর্ট', d.postId); return { ok: 1 }; }, 'auth');

// requests (hire / apply / interest)
R('POST', '/api/requests', async ({ req, u }) => {
  rl('rq' + u.id, 20, 36e5); const d = await readJson(req), p = db.prepare('SELECT * FROM posts WHERE id=?').get(+d.postId);
  if (!p || !KINDS[p.kind].apply || p.status !== 'active') throw E('এই পোস্টে অনুরোধ পাঠানো যাবে না'); if (p.user_id === u.id) throw E('নিজের পোস্টে অনুরোধ পাঠানো যায় না'); const msg = String(d.message || '').trim().slice(0, 1000); if (msg.length < 5) throw E('বার্তা লিখুন');
  if (db.prepare("SELECT 1 FROM requests WHERE post_id=? AND from_id=? AND status='pending'").get(p.id, u.id)) throw E('আপনার একটি অনুরোধ আগে থেকেই অপেক্ষমাণ');
  db.prepare('INSERT INTO requests(post_id,from_id,to_id,message,created) VALUES(?,?,?,?,?)').run(p.id, u.id, p.user_id, msg, now()); notify(p.user_id, 'request', `${u.name} আপনার “${p.title}” পোস্টে ${KINDS[p.kind].apply} পাঠিয়েছেন`, msg.slice(0, 120), '#/dashboard/recv'); return { ok: 1 };
}, 'auth');
R('GET', '/api/requests', async ({ qs, u }) => { const box = qs.get('box') === 'recv' ? 'to_id' : 'from_id', o = box === 'to_id' ? 'from_id' : 'to_id'; return db.prepare(`SELECT r.*,p.title,p.kind,us.name oname,us.id oid FROM requests r LEFT JOIN posts p ON p.id=r.post_id JOIN users us ON us.id=r.${o} WHERE r.${box}=? ORDER BY r.id DESC LIMIT 100`).all(u.id); }, 'auth');
R('PATCH', '/api/requests/(\\d+)', async ({ req, u, m }) => { const d = await readJson(req), r = db.prepare('SELECT r.*,p.title FROM requests r LEFT JOIN posts p ON p.id=r.post_id WHERE r.id=? AND r.to_id=?').get(m[1], u.id); if (!r || !['accepted', 'declined'].includes(d.status)) throw E('ভুল অনুরোধ'); db.prepare('UPDATE requests SET status=? WHERE id=?').run(d.status, r.id); notify(r.from_id, 'request', `আপনার অনুরোধ ${d.status === 'accepted' ? 'গৃহীত' : 'প্রত্যাখ্যাত'} হয়েছে: ${r.title || ''}`, '', '#/dashboard/sent'); return { ok: 1 }; }, 'auth');

// ---------- Campus Adda ----------
const ADDA_INTERESTS = ['Programming','Study Partner','Gaming','Movies & Series','Sports','Travelling','Books','Music','Career','Photography','Language Practice','Entrepreneurship'];
const ADDA_REASONS = ['অনুপযুক্ত আচরণ','হয়রানি','ভুয়া প্রোফাইল','স্প্যাম','অন্যান্য'];
const addaStudent = u => { if (!u || u.role !== 'user' || u.type !== 'শিক্ষার্থী' || u.status !== 'active') throw E('শুধু সক্রিয় শিক্ষার্থী অ্যাকাউন্ট Campus Adda ব্যবহার করতে পারবে',403); };
const addaProfile = row => ({ visible: !!row.visible, availability: row.availability, interests: JSON.parse(row.interests || '[]'), bio: row.bio || '' });

R('GET', '/api/adda/me', async ({ u }) => {
  addaStudent(u);
  const row = db.prepare('SELECT * FROM adda_profiles WHERE user_id=?').get(u.id);
  return { profile: row ? addaProfile(row) : { visible:false, availability:'busy', interests:[], bio:'' }, interests:ADDA_INTERESTS };
}, 'auth');

R('PATCH', '/api/adda/me', async ({ req, u }) => {
  addaStudent(u);
  const d = await readJson(req);
  const visible = d.visible === true ? 1 : d.visible === false ? 0 : null;
  if (visible === null) throw E('প্রোফাইল visibility নির্বাচন করুন');
  const availability = String(d.availability || 'busy');
  if (!['free','later','busy'].includes(availability)) throw E('সঠিক availability নির্বাচন করুন');
  if (!Array.isArray(d.interests)) throw E('আগ্রহের বিষয় নির্বাচন করুন');
  const interests = [...new Set(d.interests.map(String))];
  if (interests.length > 8 || interests.some(x => !ADDA_INTERESTS.includes(x))) throw E('সর্বোচ্চ ৮টি বৈধ আগ্রহ নির্বাচন করুন');
  const bio = String(d.bio || '').trim().slice(0,240);
  db.prepare('INSERT INTO adda_profiles(user_id,visible,availability,interests,bio,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET visible=excluded.visible,availability=excluded.availability,interests=excluded.interests,bio=excluded.bio,updated=excluded.updated').run(u.id,visible,availability,JSON.stringify(interests),bio,now());
  log(u.id, 'Campus Adda profile update');
  return { ok:1 };
}, 'auth');

R('GET', '/api/adda', async ({ qs, u }) => {
  addaStudent(u);
  const where = ["us.role='user'", "us.type='শিক্ষার্থী'", "us.status='active'", 'ap.visible=1', 'us.id<>?'];
  const args = [u.id];
  const q = String(qs.get('q') || '').trim().slice(0,80);
  if (q) { where.push('(us.name LIKE ? ESCAPE \'\\\' OR us.dept LIKE ? ESCAPE \'\\\' OR us.batch LIKE ? ESCAPE \'\\\')'); args.push(like(q),like(q),like(q)); }
  const interest = String(qs.get('interest') || '');
  if (interest) { if (!ADDA_INTERESTS.includes(interest)) throw E('অবৈধ interest filter'); where.push('EXISTS (SELECT 1 FROM json_each(ap.interests) WHERE value=?)'); args.push(interest); }
  const availability = String(qs.get('availability') || '');
  if (availability) { if (!['free','later','busy'].includes(availability)) throw E('অবৈধ availability filter'); where.push('ap.availability=?'); args.push(availability); }
  const rows = db.prepare('SELECT us.id,us.name,us.dept,us.batch,us.sem,us.avatar,us.vstatus,ap.availability,ap.interests,ap.bio FROM users us JOIN adda_profiles ap ON ap.user_id=us.id WHERE '+where.join(' AND ')+' ORDER BY CASE ap.availability WHEN \'free\' THEN 0 WHEN \'later\' THEN 1 ELSE 2 END,ap.updated DESC LIMIT 60').all(...args);
  return { items:rows.map(r => ({ id:r.id,name:r.name,dept:r.dept,batch:r.batch,sem:r.sem,avatar:r.avatar,verified:r.vstatus==='approved',availability:r.availability,interests:JSON.parse(r.interests || '[]'),bio:r.bio || '' })), interests:ADDA_INTERESTS };
}, 'auth');

R('POST', '/api/adda/report', async ({ req, u }) => {
  addaStudent(u);
  const d = await readJson(req), target = Number(d.targetId), reason = String(d.reason || ''), details = String(d.details || '').trim().slice(0,500);
  if (!Number.isSafeInteger(target) || target < 1 || target === u.id) throw E('সঠিক শিক্ষার্থী নির্বাচন করুন');
  if (!ADDA_REASONS.includes(reason)) throw E('রিপোর্টের কারণ নির্বাচন করুন');
  const member = db.prepare("SELECT id FROM users WHERE id=? AND role='user' AND type='শিক্ষার্থী' AND status='active'").get(target);
  const recent = db.prepare('SELECT id FROM adda_reports WHERE reporter_id=? AND target_id=? AND created>?').get(u.id,target,now()-86400000);
  if (recent) throw E('এই শিক্ষার্থীকে গত ২৪ ঘণ্টায় ইতিমধ্যে রিপোর্ট করেছেন');
  if (recent) throw E('এই শিক্ষার্থীকে গত ২৪ ঘণ্টায় ইতিমধ্যে রিপোর্ট করেছেন');
  db.prepare('INSERT INTO adda_reports(reporter_id,target_id,reason,details,created) VALUES(?,?,?,?,?)').run(u.id,target,reason,details,now());
  log(u.id, 'Campus Adda report', 'Target: '+target);
  return { ok:1 };
}, 'auth');

// messaging (no phone numbers needed)
R('POST', '/api/conversations', async ({ req, u }) => {
  const d = await readJson(req), to = +d.to; if (!to || to === u.id) throw E('ভুল অনুরোধ'); const t = db.prepare("SELECT id FROM users WHERE id=? AND status='active'").get(to); if (!t) throw E('সদস্য পাওয়া যায়নি', 404);
  const a = Math.min(u.id, to), b = Math.max(u.id, to); db.prepare('INSERT OR IGNORE INTO conversations(a,b,post_id,updated) VALUES(?,?,?,?)').run(a, b, +d.postId || null, now()); return { id: db.prepare('SELECT id FROM conversations WHERE a=? AND b=?').get(a, b).id };
}, 'auth');
const conv = (id, u) => { const c = db.prepare('SELECT * FROM conversations WHERE id=? AND (a=? OR b=?)').get(id, u.id, u.id); if (!c) throw E('কথোপকথন পাওয়া যায়নি', 404); return c; };
R('GET', '/api/conversations', async ({ u }) => db.prepare('SELECT * FROM conversations WHERE a=? OR b=? ORDER BY updated DESC LIMIT 100').all(u.id, u.id).map(c => {
  const o = db.prepare('SELECT id,name,dept,avatar,vstatus FROM users WHERE id=?').get(c.a === u.id ? c.b : c.a), l = db.prepare('SELECT body,sender,created FROM messages WHERE conv_id=? ORDER BY id DESC LIMIT 1').get(c.id);
  const un = db.prepare('SELECT COUNT(*) n FROM messages WHERE conv_id=? AND sender!=? AND id>COALESCE((SELECT last_id FROM conv_reads WHERE conv_id=? AND user_id=?),0)').get(c.id, u.id, c.id, u.id).n;
  const pt = c.post_id ? (db.prepare('SELECT title FROM posts WHERE id=?').get(c.post_id) || {}).title : null; return { id: c.id, other: pub(o), last: l, unread: un, post: pt, updated: c.updated };
}), 'auth');
R('GET', '/api/conversations/(\\d+)/messages', async ({ qs, u, m }) => {
  const c = conv(m[1], u), after = +qs.get('after') || 0, o = db.prepare('SELECT id,name,dept,avatar,vstatus FROM users WHERE id=?').get(c.a === u.id ? c.b : c.a);
  const ms = db.prepare('SELECT id,sender,body,created FROM messages WHERE conv_id=? AND id>? ORDER BY id LIMIT 200').all(c.id, after); if (ms.length) db.prepare('INSERT INTO conv_reads VALUES(?,?,?) ON CONFLICT(conv_id,user_id) DO UPDATE SET last_id=excluded.last_id').run(c.id, u.id, ms[ms.length - 1].id);
  return { messages: ms, other: pub(o) };
}, 'auth');
R('POST', '/api/conversations/(\\d+)/messages', async ({ req, u, m }) => {
  rl('msg' + u.id, 60, 6e4); if (u.status !== 'active') throw E('অ্যাকাউন্ট সীমাবদ্ধ', 403); const c = conv(m[1], u), body = String((await readJson(req)).body || '').trim().slice(0, 2000); if (!body) throw E('বার্তা লিখুন');
  const r = db.prepare('INSERT INTO messages(conv_id,sender,body,created) VALUES(?,?,?,?)').run(c.id, u.id, body, now()); db.prepare('UPDATE conversations SET updated=? WHERE id=?').run(now(), c.id); return { id: r.lastInsertRowid };
}, 'auth');
R('GET', '/api/unread', async ({ u }) => ({ messages: db.prepare('SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id=m.conv_id WHERE (c.a=? OR c.b=?) AND m.sender!=? AND m.id>COALESCE((SELECT last_id FROM conv_reads WHERE conv_id=c.id AND user_id=?),0)').get(u.id, u.id, u.id, u.id).n, notifications: db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0').get(u.id).n }), 'auth');
R('GET', '/api/notifications', async ({ u }) => db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(u.id), 'auth');
R('POST', '/api/notifications/read', async ({ u }) => { db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(u.id); return { ok: 1 }; }, 'auth');

// ---------- super admin ----------
R('GET', '/api/admin/stats', async () => { const c = (s, ...a) => db.prepare(s).get(...a).n, k = x => c("SELECT COUNT(*) n FROM posts WHERE kind=? AND status!='hidden'", x); return { users: c("SELECT COUNT(*) n FROM users WHERE role='user'"), verified: c("SELECT COUNT(*) n FROM users WHERE vstatus='approved' AND role='user'"), pending: c("SELECT COUNT(*) n FROM users WHERE vstatus='pending'"), restricted: c("SELECT COUNT(*) n FROM users WHERE status!='active'"), house: k('house'), donors: k('donor'), requests: c("SELECT COUNT(*) n FROM posts WHERE kind='request' AND status='active'"), lost: k('lost'), market: k('market'), skill: k('skill'), job: k('job'), tuition: k('tuition'), hires: c('SELECT COUNT(*) n FROM requests'), reports: c("SELECT COUNT(*) n FROM reports WHERE status='open'"), messages: c('SELECT COUNT(*) n FROM messages') }; }, 'admin');
R('GET', '/api/admin/users', async ({ qs }) => {
  const { p, ps, off } = page(qs, 20), w = ["role='user'"], a = []; const q = (qs.get('q') || '').trim(); if (q) { w.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR sid LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')"); a.push(like(q), like(q), like(q), like(q)); }
  if (qs.get('status')) { w.push('status=?'); a.push(qs.get('status')); } if (qs.get('v')) { w.push('vstatus=?'); a.push(qs.get('v')); }
  const total = db.prepare('SELECT COUNT(*) n FROM users WHERE ' + w.join(' AND ')).get(...a).n;
  const items = db.prepare('SELECT id,email,sid,name,type,dept,batch,sem,phone,status,vstatus,vnote,vfile IS NOT NULL hasfile,created,last_login,(SELECT COUNT(*) FROM posts WHERE user_id=users.id) posts FROM users WHERE ' + w.join(' AND ') + ' ORDER BY (vstatus="pending") DESC,id DESC LIMIT ? OFFSET ?').all(...a, ps, off); return { items, total, pages: Math.max(1, Math.ceil(total / ps)) };
}, 'admin');
R('GET', '/api/admin/users/(\\d+)/verification', async ({ res, m }) => { const u = db.prepare('SELECT vfile FROM users WHERE id=?').get(m[1]); if (!u || !u.vfile) throw E('ফাইল নেই', 404); serveFile(null, res, path.join(PRIV, u.vfile), { private: 1 }); return null; }, 'admin');
R('POST', '/api/admin/users/(\\d+)/action', async ({ req, u: adm, m }) => {
  const d = await readJson(req), t = db.prepare('SELECT * FROM users WHERE id=?').get(m[1]); if (!t) throw E('সদস্য নেই', 404); if (t.role === 'admin') throw E('অ্যাডমিনের উপর এই কাজ করা যায় না', 403); let out = { ok: 1 };
  const A = { approve: () => { db.prepare("UPDATE users SET vstatus='approved' WHERE id=?").run(t.id); notify(t.id, 'verify', 'আপনার অ্যাকাউন্ট যাচাই হয়েছে ✔'); }, reject: () => { db.prepare("UPDATE users SET vstatus='rejected' WHERE id=?").run(t.id); notify(t.id, 'verify', 'যাচাইয়ের অনুরোধ প্রত্যাখ্যাত হয়েছে', 'সঠিক তথ্য ও স্পষ্ট ছবিসহ আবার চেষ্টা করুন।'); }, suspend: () => db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(t.id), ban: () => { db.prepare("UPDATE users SET status='banned' WHERE id=?").run(t.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.id); }, restore: () => db.prepare("UPDATE users SET status='active' WHERE id=?").run(t.id), resetpw: () => { const pw = crypto.randomBytes(7).toString('base64url'); db.prepare('UPDATE users SET pass=? WHERE id=?').run(hash(pw), t.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.id); out = { ok: 1, password: pw }; }, delete: () => { for (const x of db.prepare('SELECT name FROM uploads WHERE user_id=?').all(t.id)) fs.rm(path.join(UP, x.name), () => { }); if (t.vfile) fs.rm(path.join(PRIV, t.vfile), () => { }); db.prepare('DELETE FROM users WHERE id=?').run(t.id); } };
  if (!A[d.action]) throw E('ভুল কাজ'); A[d.action](); log(adm.id, 'অ্যাডমিন: ' + d.action, `${t.name} (${t.sid})`, req); return out;
}, 'admin');
R('GET', '/api/admin/posts', async ({ qs }) => {
  const { p, ps, off } = page(qs, 20), w = ['1=1'], a = []; if (qs.get('kind')) { w.push('p.kind=?'); a.push(qs.get('kind')); } if (qs.get('uid')) { w.push('p.user_id=?'); a.push(+qs.get('uid')); } if (qs.get('status')) { w.push('p.status=?'); a.push(qs.get('status')); }
  const q = (qs.get('q') || '').trim(); if (q) { w.push("(p.title LIKE ? ESCAPE '\\' OR p.data LIKE ? ESCAPE '\\')"); a.push(like(q), like(q)); }
  const total = db.prepare('SELECT COUNT(*) n FROM posts p WHERE ' + w.join(' AND ')).get(...a).n;
  const items = db.prepare('SELECT p.*,us.name aname,us.sid asid,us.email aemail,us.phone aphone,us.status ast FROM posts p JOIN users us ON us.id=p.user_id WHERE ' + w.join(' AND ') + ' ORDER BY p.id DESC LIMIT ? OFFSET ?').all(...a, ps, off).map(r => ({ id: r.id, kind: r.kind, title: r.title, data: JSON.parse(r.data || '{}'), media: JSON.parse(r.media || '[]'), status: r.status, created: r.created, author: { id: r.user_id, name: r.aname, sid: r.asid, email: r.aemail, phone: r.aphone, status: r.ast } })); return { items, total, pages: Math.max(1, Math.ceil(total / ps)) };
}, 'admin');
R('POST', '/api/admin/posts/(\\d+)/action', async ({ req, u, m }) => { const d = await readJson(req), p = db.prepare('SELECT * FROM posts WHERE id=?').get(m[1]); if (!p) throw E('পোস্ট নেই', 404); if (d.action === 'hide') db.prepare("UPDATE posts SET status='hidden' WHERE id=?").run(p.id); else if (d.action === 'show') db.prepare("UPDATE posts SET status='active' WHERE id=?").run(p.id); else if (d.action === 'delete') db.prepare('DELETE FROM posts WHERE id=?').run(p.id); else throw E('ভুল কাজ'); log(u.id, 'অ্যাডমিন পোস্ট: ' + d.action, p.title, req); return { ok: 1 }; }, 'admin');
R('GET', '/api/admin/reports', async ({ qs }) => db.prepare('SELECT r.*,us.name rname,p.title,p.kind,p.status pstatus,p.user_id puid,pu.name pname FROM reports r JOIN users us ON us.id=r.user_id LEFT JOIN posts p ON p.id=r.post_id LEFT JOIN users pu ON pu.id=p.user_id WHERE r.status=? ORDER BY r.id DESC LIMIT 100').all(qs.get('status') === 'closed' ? 'closed' : 'open'), 'admin');
R('POST', '/api/admin/reports/(\\d+)', async ({ req, u, m }) => { const d = await readJson(req), r = db.prepare('SELECT * FROM reports WHERE id=?').get(m[1]); if (!r) throw E('রিপোর্ট নেই', 404); if (d.action === 'hide') db.prepare("UPDATE posts SET status='hidden' WHERE id=?").run(r.post_id); if (d.action === 'delete') db.prepare('DELETE FROM posts WHERE id=?').run(r.post_id); db.prepare("UPDATE reports SET status='closed',note=? WHERE id=?").run(d.action + (d.note ? ': ' + String(d.note).slice(0, 200) : ''), r.id); notify(r.user_id, 'moderation', 'আপনার রিপোর্ট পর্যালোচনা করা হয়েছে', 'ধন্যবাদ, কমিউনিটি নিরাপদ রাখতে সাহায্য করার জন্য।'); log(u.id, 'রিপোর্ট নিষ্পত্তি', d.action, req); return { ok: 1 }; }, 'admin');
R('POST', '/api/admin/announcements', async ({ req, u }) => { const d = await readJson(req), t = String(d.title || '').trim().slice(0, 150), b = String(d.body || '').trim().slice(0, 2000); if (!t || !b) throw E('শিরোনাম ও বিবরণ দিন'); db.prepare('INSERT INTO announcements(title,body,created) VALUES(?,?,?)').run(t, b, now()); for (const x of db.prepare("SELECT id FROM users WHERE role='user' AND status='active'").all()) notify(x.id, 'announce', t, b.slice(0, 120), '#/home'); log(u.id, 'ঘোষণা প্রকাশ', t, req); return { ok: 1 }; }, 'admin');
R('DELETE', '/api/admin/announcements/(\\d+)', async ({ m }) => { db.prepare('DELETE FROM announcements WHERE id=?').run(m[1]); return { ok: 1 }; }, 'admin');
R('GET', '/api/admin/logs', async ({ qs }) => { const { ps, off } = page(qs, 50); return db.prepare('SELECT l.*,us.name,us.role FROM logs l LEFT JOIN users us ON us.id=l.user_id ORDER BY l.id DESC LIMIT ? OFFSET ?').all(ps, off); }, 'admin');

// ---------- static & server ----------
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', webmanifest: 'application/manifest+json' };
function serveFile(req, res, file, o = {}) {
  fs.stat(file, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('পাওয়া যায়নি'); }
    const ext = path.extname(file).slice(1), h = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes', 'Cache-Control': o.private ? 'private, no-store' : o.long ? 'public, max-age=31536000, immutable' : 'no-cache' };
    const rg = req && /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (rg) { let s = rg[1] === '' ? st.size - +rg[2] : +rg[1], en = rg[2] === '' || rg[1] === '' ? st.size - 1 : Math.min(+rg[2], st.size - 1); if (s > en || s >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); } res.writeHead(206, { ...h, 'Content-Range': `bytes ${s}-${en}/${st.size}`, 'Content-Length': en - s + 1 }); return fs.createReadStream(file, { start: s, end: en }).pipe(res); }
    res.writeHead(200, { ...h, 'Content-Length': st.size }); fs.createReadStream(file).pipe(res);
  });
}
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; frame-ancestors 'none'" };
const server = http.createServer(async (req, res) => {
  for (const k in SEC) res.setHeader(k, SEC[k]);
  try {
    const url = new URL(req.url, 'http://x'), p = decodeURIComponent(url.pathname);
    if (p.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method)) { const o = req.headers.origin; if (o && new URL(o).host !== req.headers.host) throw E('অনুমোদিত নয়', 403); }
      rl('api' + ip(req), 600, 6e4); const u = getUser(req); if (u && u.status === 'banned') throw E('অ্যাকাউন্ট নিষিদ্ধ', 403);
      for (const r of routes) { if (r.m !== req.method) continue; const m = r.re.exec(p); if (!m) continue; if (r.opt && !u) throw E('লগইন করুন', 401); if (r.opt === 'admin' && u.role !== 'admin') throw E('অনুমতি নেই', 403);
        const out = await r.fn({ req, res, u, m, qs: url.searchParams }); if (out === null) return; res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(out)); }
      throw E('পাওয়া যায়নি', 404);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw E('অনুমোদিত নয়', 405);
    if (p.startsWith('/uploads/')) { const n = p.slice(9); if (!/^[a-f0-9]{32}\.(jpg|png|gif|webp|mp4|webm)$/.test(n)) throw E('পাওয়া যায়নি', 404); return serveFile(req, res, path.join(UP, n), { long: 1 }); }
    const f = p === '/' ? 'index.html' : p === '/admin' ? 'admin.html' : p.slice(1), fp = path.join(PUB, f);
    if (!fp.startsWith(PUB + path.sep)) throw E('পাওয়া যায়নি', 404); serveFile(req, res, fp);
  } catch (e) { const c = e.code && Number.isInteger(e.code) ? e.code : 500; if (c === 500) console.error(e); if (!res.headersSent) { res.writeHead(c, { 'Content-Type': 'application/json; charset=utf-8', Connection: c === 413 ? 'close' : 'keep-alive' }); res.end(JSON.stringify({ error: c === 500 ? 'সার্ভারে সমস্যা হয়েছে' : e.message })); } }
});
server.listen(PORT, () => console.log('GUB Connect চলছে: http://localhost:' + PORT));
