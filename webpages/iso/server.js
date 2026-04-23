const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
app.use(express.json());

const ISO_DIR = __dirname;
const DOCS_DIR = path.join(ISO_DIR, 'docs');
const APPROVALS_FILE = path.join(ISO_DIR, 'approvals.json');
const CONFIG_FILE = path.join(ISO_DIR, 'config.json');

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

// GET /api/config — send responsibilities + driveLinks to frontend
app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

// GET /api/docs
app.get('/api/docs', (req, res) => {
  const files = fs.readdirSync(DOCS_DIR);
  const approvals = loadApprovals();
  const groups = {};

  // Collect all files per base name, per extension
  files.forEach(f => {
    const ext = path.extname(f).toLowerCase();
    if (ext !== '.odt' && ext !== '.pdf') return;

    // Strip timestamp suffix: "name_2025-04-22_14-33.pdf" → "name"
    const base = path.basename(f, ext)
      .replace(/_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/, '');

    if (!groups[base]) groups[base] = { odts: [], pdfs: [] };
    if (ext === '.odt') groups[base].odts.push(f);
    if (ext === '.pdf') groups[base].pdfs.push(f);
  });

  // For each group: keep only the latest odt and latest pdf
  const result = {};
  Object.entries(groups).forEach(([base, g]) => {
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

// POST /api/approve
app.post('/api/approve', (req, res) => {
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

    res.json({ ok: true, pdfFilename: stampedPdf, timestamp: now.toISOString() });
  });
});

app.use('/docs', express.static(DOCS_DIR));
app.use('/zerti', express.static(path.join(ISO_DIR, 'zerti')));
app.use('/ueberwachung', express.static(path.join(ISO_DIR, 'ueberwachung')));
app.get('/', (req, res) => res.redirect('/zerti/'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ISO tracker running → http://localhost:${PORT}`));