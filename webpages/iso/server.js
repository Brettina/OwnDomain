const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { exec } = require('child_process');
const nodemailer = require('nodemailer');
const app = express();
app.use(express.json());

const ISO_DIR = __dirname;
const DOCS_DIR = path.join(ISO_DIR, 'docs');
const APPROVALS_FILE = path.join(ISO_DIR, 'approvals.json');
const CONFIG_FILE = path.join(ISO_DIR, 'config.json');
const ACCESS_FILE = path.join(ISO_DIR, 'zugriffsverwaltung.json');// ── Auth config ──────────────────────────────────────────────
const PASSWORD = process.env.ISO_PASSWORD || '12345';                 // demo password
const SECRET   = process.env.ISO_SECRET   || 'CHANGE-ME-to-a-long-random-string';
const HIERARCHY = ['streng_vertraulich', 'vertraulich', 'intern', 'oeffentlich'];
const DEFAULT_LEVEL = 'oeffentlich';   // files NOT in the JSON: 'oeffentlich' = everyone sees them

const transporter = nodemailer.createTransport({
  host: 'smtp.yourprovider.com',
  port: 587,
  secure: false,
  auth: {
    user: 'your@email.com',
    pass: 'your-password'
  }
});

if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR);
if (!fs.existsSync(APPROVALS_FILE)) fs.writeFileSync(APPROVALS_FILE, '{}');

function loadApprovals() {
  return JSON.parse(fs.readFileSync(APPROVALS_FILE, 'utf8'));
}
function saveApprovals(data) {
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify(data, null, 2));
}
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return { responsibilities: {}, driveLinks: {} }; }
}
function loadAccess() {
  try { return JSON.parse(fs.readFileSync(ACCESS_FILE, 'utf8')); }
  catch { return {}; }
}

// ── Access helpers (same logic as the front-end guard) ───────
function norm(s) {
  return decodeURIComponent(String(s)).trim().toLowerCase().replace(/\s+/g, ' ');
}
function baseName(s) {
  let n = decodeURIComponent(String(s)).split(/[\\/]/).pop();
  n = n.replace(/\.(pdf|odt|ods|odp|docx?)$/i, '');
  n = n.replace(/_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/, '');
  return norm(n);
}
function roleKnown(role) {
  const data = loadAccess();
  return HIERARCHY.some(l => (data[l]?.roles || []).includes(role));
}
function canRoleSee(role, base) {
  const data = loadAccess();
  const idx = HIERARCHY.findIndex(l => (data[l]?.roles || []).includes(role));
  const fromIdx = idx === -1 ? HIERARCHY.length : idx;
  const allowed = new Set(), classified = new Set();
  HIERARCHY.forEach((level, i) => {
    (data[level]?.files || []).forEach(f => {
      const b = baseName(f); classified.add(b);
      if (i >= fromIdx) allowed.add(b);
    });
  });
  if (allowed.has(base)) return true;
  if (classified.has(base)) return false;          // classified but above clearance
  return HIERARCHY.includes(DEFAULT_LEVEL);         // unclassified -> default policy
}

// ── Signed-cookie session (stateless, no extra npm packages) ──
function sign(value) {
  const mac = crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
  return value + '.' + mac;
}
function verify(signed) {
  if (!signed || signed.indexOf('.') < 0) return null;
  const i = signed.lastIndexOf('.');
  const value = signed.slice(0, i), mac = signed.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value; // the role
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('='); if (i < 0) return;
    out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function currentRole(req) {
  return verify(parseCookies(req).iso_session || '');
}
function requireLogin(req, res, next) {
  if (currentRole(req)) return next();
  return res.redirect('/welcome/');
}

// ── Auth endpoints ───────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { role, password } = req.body || {};
  if (password !== PASSWORD) return res.status(401).json({ error: 'Falsches Passwort' });
  if (!roleKnown(role))      return res.status(400).json({ error: 'Unbekannte Rolle' });
  // NOTE: add "Secure;" to this cookie once you serve over HTTPS
  res.setHeader('Set-Cookie',
    'iso_session=' + encodeURIComponent(sign(role)) +
    '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + (60 * 60 * 8));
  res.json({ ok: true, role });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'iso_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const role = currentRole(req);
  if (!role) return res.status(401).json({ error: 'not logged in' });
  res.json({ role });
});

// GET /api/config
app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

// GET /api/docs — filtered to what the logged-in role may see
app.get('/api/docs', (req, res) => {
  const role = currentRole(req);
  if (!role) return res.status(401).json({ error: 'Nicht angemeldet' });

  const files = fs.readdirSync(DOCS_DIR);
  const approvals = loadApprovals();
  const groups = {};

  files.forEach(f => {
    const ext = path.extname(f).toLowerCase();
    if (ext !== '.odt' && ext !== '.pdf') return;
    const base = path.basename(f, ext).replace(/_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/, '');
    if (!groups[base]) groups[base] = { odts: [], pdfs: [] };
    if (ext === '.odt') groups[base].odts.push(f);
    if (ext === '.pdf') groups[base].pdfs.push(f);
  });

  const result = {};
  Object.entries(groups).forEach(([base, g]) => {
    if (!canRoleSee(role, baseName(base))) return;   // hide forbidden docs from the listing
    g.odts.sort().reverse();
    g.pdfs.sort().reverse();
    result[base] = {
      odt: g.odts[0] || null,
      pdf: g.pdfs[0] || null,
      approval: approvals[base] || null,
    };
  });

  res.json(result);
});

// POST /api/approve — requires login
app.post('/api/approve', (req, res) => {
  if (!currentRole(req)) return res.status(401).json({ error: 'Nicht angemeldet' });

  const { docName, approver, role } = req.body;
  if (!docName || !approver || !role)
    return res.status(400).json({ error: 'docName, approver and role required' });

  const odtPath = path.join(DOCS_DIR, `${docName}.odt`);
  if (!fs.existsSync(odtPath))
    return res.status(404).json({ error: `${docName}.odt not found in docs/` });

  const cmd = `libreoffice --headless --convert-to pdf --outdir "${DOCS_DIR}" "${odtPath}"`;
  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error('LibreOffice error:', stderr);
      return res.status(500).json({ error: 'PDF conversion failed', detail: stderr });
    }

    const rawPdf = path.join(DOCS_DIR, `${docName}.pdf`);
    const now = new Date();
    const ts = now.toISOString().replace('T', '_').replace(/:/g, '-').slice(0, 16);
    const stampedPdf = `${docName}_${ts}.pdf`;
    const stampedPath = path.join(DOCS_DIR, stampedPdf);

    try { fs.renameSync(rawPdf, stampedPath); }
    catch (e) { return res.status(500).json({ error: 'Rename failed', detail: e.message }); }

    const approvals = loadApprovals();
    approvals[docName] = { approvedBy: approver, role, timestamp: now.toISOString(), pdfFilename: stampedPdf };
    saveApprovals(approvals);

    const config = loadConfig();
    const roleEmail = config.emails?.[role];
    if (roleEmail) {
      transporter.sendMail({
        from: '"ISO System" <no-reply@yourdomain.com>',
        to: roleEmail,
        subject: `Dokument freigegeben: ${docName}`,
        text: `\nDokument: ${docName}\nFreigegeben von: ${approver}\nRolle: ${role}\nZeit: ${now.toISOString()}\n    `
      }, (err) => { if (err) console.error('Mail error:', err); });
    }

    res.json({ ok: true, pdfFilename: stampedPdf, timestamp: now.toISOString() });
  });
});

// ── Static routes ────────────────────────────────────────────
// PUBLIC: the access map itself (login page + guard need it before login)
app.use('/docs/conv_meta', express.static(path.join(DOCS_DIR, 'conv_meta')));
// GATED: every other file under /docs is checked against the role

// PUBLIC: the access map (login page + guard need it before login)
app.get('/zugriffsverwaltung.json', (req, res) => {
  res.sendFile(ACCESS_FILE);
});
app.use('/docs', (req, res, next) => {
  const role = currentRole(req);
  if (!role) return res.status(401).send('Nicht angemeldet');
  if (!canRoleSee(role, baseName(req.path)))
    return res.status(403).send('Kein Zugriff auf dieses Dokument');
  next();
}, express.static(DOCS_DIR));

// GATED pages
//app.use('/zerti', requireLogin, express.static(path.join(ISO_DIR, 'zerti')));
//app.use('/ueberwachung', requireLogin, express.static(path.join(ISO_DIR, 'ueberwachung')));
// Automatically expose every webpage inside ISO
for (const entry of fs.readdirSync(ISO_DIR, { withFileTypes: true })) {

  if (!entry.isDirectory()) continue;

  if (entry.name === "welcome") continue;

  const folder = path.join(ISO_DIR, entry.name);

  if (!fs.existsSync(path.join(folder, "index.html"))) continue;

  console.log(`Page: /${entry.name}`);

  app.use(
    "/" + entry.name,
    requireLogin,
    express.static(folder)
  );
}
// PUBLIC login page
app.use('/welcome', express.static(path.join(ISO_DIR, 'welcome')));

app.get('/', (req, res) => res.redirect(currentRole(req) ? '/zerti/' : '/welcome/'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ISO tracker running → http://localhost:${PORT}`));