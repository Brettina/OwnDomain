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
// ── Inconsistencies API (content-based; AI hook wired in later) ──
const DOCREGISTER_FILE = path.join(ISO_DIR, 'docregister.json');
function loadDocregister(){ try { return JSON.parse(fs.readFileSync(DOCREGISTER_FILE,'utf8')); } catch { return {}; } }
function saveDocregister(d){ fs.writeFileSync(DOCREGISTER_FILE, JSON.stringify(d, null, 2)); }

app.get('/api/inconsistencies', (req, res) => {
  if (!currentRole(req)) return res.status(401).json({ error: 'Nicht angemeldet' });
  const reg = loadDocregister();
  const ignored = (reg._meta && reg._meta.ignoredInconsistencies) || [];
  // TODO: replace [] with real AI content analysis over the documents in docs/.
  let items = [];
  items = items.filter(it => !ignored.includes(it.id));
  res.json({ items });
});

app.post('/api/inconsistencies/ignore', (req, res) => {
  if (!currentRole(req)) return res.status(401).json({ error: 'Nicht angemeldet' });
  const { id, reason } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  const reg = loadDocregister();
  if (!reg._meta) reg._meta = {};
  if (!Array.isArray(reg._meta.ignoredInconsistencies)) reg._meta.ignoredInconsistencies = [];
  if (!Array.isArray(reg._meta.ignoredLog)) reg._meta.ignoredLog = [];
  if (!reg._meta.ignoredInconsistencies.includes(id)) {
    reg._meta.ignoredInconsistencies.push(id);
    reg._meta.ignoredLog.push({ id, reason: reason || '', by: currentRole(req), at: new Date().toISOString() });
  }
  saveDocregister(reg);
  res.json({ ok: true });
});

// ── Asset owners (parsed from the messy Assetliste CSV) ──────
const ASSET_CSV = path.join(DOCS_DIR, 'conv_tables', 'dat-013 Assetliste HW__assetlist.csv');

function parseCsvLine(line) {                 // minimal CSV (handles quotes + commas)
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function loadAssetOwners() {
  const map = {};
  try {
    const text = fs.readFileSync(ASSET_CSV, 'utf8');
    const lines = text.split(/\r?\n/);
    // find the header row that contains "Kategorie inkl ID" and "Eigentümer"
    let hi = lines.findIndex(l => /Kategorie inkl ID/i.test(l) && /Eigent/i.test(l));
    if (hi < 0) return map;
    const hdr = parseCsvLine(lines[hi]);
    const idCol = hdr.findIndex(h => /Kategorie inkl ID/i.test(h));
    const ownerCol = hdr.findIndex(h => /Eigent/i.test(h));
    for (let i = hi + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cells = parseCsvLine(lines[i]);
      const id = (cells[idCol] || '').trim().toLowerCase();
      let owner = (cells[ownerCol] || '').trim();
      if (!/^[a-z]{3}-\d{3}$/.test(id) || !owner) continue;
      owner = owner.replace(/\s*\([^)]*\)/g, '').trim();   // drop "(R/A)" etc.
      map[id] = owner;
    }
  } catch (e) { console.warn('Asset CSV parse failed:', e.message); }
  return map;
}

app.get('/api/asset-owners', (req, res) => {
  if (!currentRole(req)) return res.status(401).json({ error: 'Nicht angemeldet' });
  res.json(loadAssetOwners());
});
require('./search')(app, { currentRole, DOCS_DIR });
// ════════════════════════════════════════════════════════════════
//  COMPLIANCE WORKFLOWS  (Vorfall melden + Lessons Learned)
//  Paste into server.js directly ABOVE:  // ── Static routes ──────
//  REPLACES any previous compliance-workflows block. Additive only;
//  reuses transporter / parseCsvLine / currentRole / loadConfig.
// ════════════════════════════════════════════════════════════════

const USER_DATA_DIR  = path.join(ISO_DIR, 'user_data');
const INCIDENTS_FILE = path.join(USER_DATA_DIR, 'incidents.json');
const LESSONS_FILE   = path.join(USER_DATA_DIR, 'lessonslearned.json');

if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true });
if (!fs.existsSync(INCIDENTS_FILE)) fs.writeFileSync(INCIDENTS_FILE, '[]');
if (!fs.existsSync(LESSONS_FILE))   fs.writeFileSync(LESSONS_FILE, '[]');

function loadArr(file) {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function saveArr(file, arr) { fs.writeFileSync(file, JSON.stringify(arr, null, 2)); }

// role -> {name,email} from verantwortliche (single source of truth)
function contactFor(cfg, role) {
  const v = (cfg.verantwortliche || {})[role];
  return v ? { name: v.name || role, email: v.email || '' } : { name: role, email: '' };
}

// Ordered internal recipients. Order = key order in verantwortliche.
// DSB added when personal data ja/unklar.
function routeRoles(cfg, type, personalData) {
  const r = cfg.incidentRouting || {};
  const set = new Set([...(r.default || [])]);
  ((r.byType || {})[type] || []).forEach(x => set.add(x));
  if (personalData === 'ja' || personalData === 'unklar')
    (r.personalDataRoles || []).forEach(x => set.add(x));
  const order = Object.keys(cfg.verantwortliche || {});   // <- order from verantwortliche
  return [...set].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

// ONE internal mail (first role = To, rest = CC) + known participants -> CC.
// Plus a SEPARATE external (BSI) draft only when severity triggers it.
function buildMailDrafts(cfg, inc) {
  const roles = inc.notifiedRoles || [];
  const drafts = [];

  if (roles.length) {
    const contacts = roles.map(r => ({ role: r, ...contactFor(cfg, r) }));
    const toEmails = [...new Set(contacts.map(c => c.email).filter(Boolean))];
    const toLabel  = contacts.map(c => `${c.name} (${c.role})`).join(', ');

    // known participants (name matches a verantwortliche entry) -> CC
    const partContacts = (inc.participants || []).map(p => {
      const hit = Object.values(cfg.verantwortliche || {})
        .find(v => v.name && String(p) && v.name.toLowerCase() === String(p).toLowerCase());
      return hit ? hit.email : '';
    });
    const ccEmails = [...new Set(partContacts.filter(Boolean))];
    const ccLabel  = (inc.participants || []).join(', ');

    const greetNames = contacts.map(c => c.name).join(', ');
    const body =
`Hallo ${greetNames},

es wurde ein Sicherheitsvorfall erfasst und an Sie zur Kenntnis und Bearbeitung weitergeleitet.

Vorfallsart:         ${inc.type}
Einstufung:          ${inc.severity || '-'}
Begruendung:         ${inc.severityReason || '-'}
Entdeckt durch:      ${inc.discoverer || '-'}
Beteiligte:          ${(inc.participants || []).join(', ') || '-'}
Personenbezogene Daten betroffen: ${inc.personalData}
Betroffene Systeme:  ${(inc.systems || []).join(', ') || '-'}

Was ist passiert:
${inc.description || '-'}

Bitte die zugehoerigen Sofortmassnahmen und Fristen beachten.

Diese Nachricht wurde aus dem ISMS-Portal vorbereitet.`;

    drafts.push({
      kind: 'intern',
      toEmails, toLabel, ccEmails, ccLabel,
      subject: `Sicherheitsvorfall: ${inc.type} (${inc.severity || 'ohne Einstufung'})`,
      body
    });
  }

  const ext = cfg.externalAuthority || {};
  if (ext.role && (ext.triggerSeverities || []).includes(inc.severity)) {
    const bsi = contactFor(cfg, ext.role);
    drafts.push({
      kind: 'extern',
      toEmails: bsi.email ? [bsi.email] : [],
      toLabel: `${bsi.name} (${ext.role})`,
      ccEmails: [], ccLabel: '',
      subject: `Meldung eines erheblichen Sicherheitsvorfalls gemaess ${ext.label || 'NIS2 / DSGVO'}`,
      body:
`Sehr geehrte Damen und Herren,

hiermit melden wir gemaess ${ext.label || 'NIS2 / DSGVO'} einen erheblichen Sicherheitsvorfall.

Meldende Organisation:        Helm & Walter
Vorfallsart:                  ${inc.type}
Einstufung:                   ${inc.severity}
Begruendung der Einstufung:   ${inc.severityReason || '-'}
Personenbezogene Daten betroffen: ${inc.personalData}
Betroffene Systeme:           ${(inc.systems || []).join(', ') || '-'}
Zeitpunkt der Kenntnisnahme:  ${inc.timestamp || ''}

Sachverhalt:
${inc.description || '-'}

Wir halten Sie ueber den weiteren Verlauf und die ergriffenen Massnahmen auf dem Laufenden.

Mit freundlichen Gruessen
Helm & Walter`
    });
  }
  return drafts;
}

function loadExcelIncidents() {
  const out = [];
  try {
    const dir = path.join(DOCS_DIR, 'conv_tables');
    const file = fs.readdirSync(dir).find(f => /vorfallsregister/i.test(f) && f.endsWith('.csv'));
    if (!file) return out;
    fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      const cells = parseCsvLine(line).map(c => c.trim());
      const dateCell = cells.find(c => /\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{2,4}/.test(c));
      const textCells = cells.filter(Boolean);
      if (!dateCell || textCells.length < 2) return;
      out.push({ id: 'excel-' + i, source: 'excel', date: dateCell,
        type: textCells.find(c => c !== dateCell) || 'Vorfall', discoverer: '' });
    });
  } catch (e) { console.warn('Excel incident parse skipped:', e.message); }
  return out;
}

function loadMeasures() {
  const out = [];
  try {
    const dir = path.join(DOCS_DIR, 'conv_tables');
    const file = fs.readdirSync(dir).find(f => /atalog/i.test(f) && f.endsWith('.csv'));
    if (!file) return out;
    fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/).forEach(line => {
      if (!line.trim()) return;
      const cells = parseCsvLine(line).map(c => c.trim());
      const idx = cells.findIndex(c => /^MAS-[a-z]+-\d+$/i.test(c));
      if (idx < 0) return;
      const rest = cells.slice(idx + 1).filter(Boolean);
      out.push({ id: cells[idx], kategorie: rest[0] || '', bezeichnung: rest[1] || '' });
    });
  } catch (e) { console.warn('Measure parse skipped:', e.message); }
  return out;
}

app.get('/api/incidents', (req, res) => {
  if (!currentRole(req)) return res.status(401).json({ error: 'Nicht angemeldet' });
  const web = loadArr(INCIDENTS_FILE).map(i => ({ ...i, source: i.source || 'web' }));
  res.json({ incidents: [...loadExcelIncidents(), ...web] });
});

app.post('/api/incidents', (req, res) => {
  if (!currentRole(req)) return res.status(401).json({ error: 'Nicht angemeldet' });
  const cfg = loadConfig();
  const b = req.body || {};
  if (!b.type) return res.status(400).json({ error: 'type required' });
  const arr = loadArr(INCIDENTS_FILE);
  const nextId = arr.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
  const inc = {
    id: nextId, source: 'web',
    date: b.date || new Date().toISOString().slice(0, 10),
    timestamp: new Date().toISOString(),
    type: b.type,
    discoverer: b.discoverer || '',
    participants: Array.isArray(b.participants) ? b.participants : (b.participants ? [b.participants] : []),
    description: b.description || '',
    severity: b.severity || '',
    severityReason: b.severityReason || '',
    personalData: b.personalData || 'unklar',
    systems: Array.isArray(b.systems) ? b.systems : []
  };
  inc.notifiedRoles = routeRoles(cfg, inc.type, inc.personalData);
  inc.mailDrafts = buildMailDrafts(cfg, inc);
  arr.push(inc);
  saveArr(INCIDENTS_FILE, arr);
  res.json({ ok: true, incident: inc });
});

app.post('/api/sendMail', (req, res) => {
  if (!currentRole(req)) return res.status(401).json({ error: 'Nicht angemeldet' });
  const { to, cc, subject, body } = req.body || {};
  if (!to) return res.status(400).json({ error: 'to required' });
  const ccVal = Array.isArray(cc) ? cc.join(',') : (cc || '');
  transporter.sendMail({
    from: '"ISO System" <no-reply@yourdomain.com>',
    to, cc: ccVal, subject: subject || '', text: body || ''
  }, (err, info) => {
    if (err) { console.error('Mail error:', err); return res.status(500).json({ error: err.message }); }
    res.json({ ok: true, messageId: info && info.messageId });
  });
});

app.get('/api/lessons', (req, res) => {
  if (!currentRole(req)) return res.status(401).json({ error: 'Nicht angemeldet' });
  res.json({ lessons: loadArr(LESSONS_FILE) });
});

app.post('/api/lessons', (req, res) => {
  if (!currentRole(req)) return res.status(401).json({ error: 'Nicht angemeldet' });
  const b = req.body || {};
  if (b.incident === undefined || b.incident === null)
    return res.status(400).json({ error: 'incident required' });
  const arr = loadArr(LESSONS_FILE);
  const lesson = { incident: b.incident, date: new Date().toISOString().slice(0, 10),
    text: b.text || '', measures: Array.isArray(b.measures) ? b.measures : [] };
  const i = arr.findIndex(x => String(x.incident) === String(b.incident));
  if (i >= 0) arr[i] = lesson; else arr.push(lesson);
  saveArr(LESSONS_FILE, arr);
  res.json({ ok: true, lesson });
});

app.get('/api/measures', (req, res) => {
  if (!currentRole(req)) return res.status(401).json({ error: 'Nicht angemeldet' });
  res.json({ measures: loadMeasures() });
});
// ════════════════════════ END COMPLIANCE WORKFLOWS ══════════════
// ════════════════════════ END COMPLIANCE WORKFLOWS ══════════════

// ── Static routes ────────────────────────────────────────────
// PUBLIC: the access map itself (login page + guard need it before login)
app.use('/docs/conv_meta', express.static(path.join(DOCS_DIR, 'conv_meta')));
// GATED: every other file under /docs is checked against the role

// PUBLIC: the access map (login page + guard need it before login)
app.get('/zugriffsverwaltung.json', (req, res) => {
  res.sendFile(ACCESS_FILE);
});

// GATED: data files the Compliance Monitor (zerti page) fetches by URL.
// Without these, fetch('/docregister.json') / fetch('/isoschedule.json')
// hit the catch-all 404 (HTML), r.json() throws, and the monitor renders nothing.
app.get('/docregister.json', requireLogin, (req, res) => {
  res.sendFile(path.join(ISO_DIR, 'docregister.json'));
});
app.get('/isoschedule.json', requireLogin, (req, res) => {
  res.sendFile(path.join(ISO_DIR, 'isoschedule.json'));
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