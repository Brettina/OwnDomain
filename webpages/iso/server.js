const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
app.use(express.json());

const ISO_DIR = __dirname;
const DOCS_DIR = path.join(ISO_DIR, 'docs');
const APPROVALS_FILE = path.join(ISO_DIR, 'approvals.json');

// ── Ensure docs dir and approvals file exist ──────────────────
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR);
if (!fs.existsSync(APPROVALS_FILE)) fs.writeFileSync(APPROVALS_FILE, '{}');

function loadApprovals() {
  return JSON.parse(fs.readFileSync(APPROVALS_FILE, 'utf8'));
}

function saveApprovals(data) {
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify(data, null, 2));
}

// ── GET /api/docs ─────────────────────────────────────────────
// Groups files by base name, returns odt + all pdfs per doc
app.get('/api/docs', (req, res) => {
  const files = fs.readdirSync(DOCS_DIR);
  const approvals = loadApprovals();
  const groups = {};

  files.forEach(f => {
    const ext = path.extname(f).toLowerCase();
    if (ext === '.odt') {
      const base = path.basename(f, '.odt');
      if (!groups[base]) groups[base] = { odt: null, pdfs: [] };
      groups[base].odt = f;
    }
  });

  files.forEach(f => {
    const ext = path.extname(f).toLowerCase();
    if (ext === '.pdf') {
      // Match pdf back to odt base: "sicherheitsrichtlinie_2025-04-22_14-33.pdf"
      const base = f.replace(/_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.pdf$/, '')
                    .replace(/\.pdf$/, '');
      if (groups[base]) {
        groups[base].pdfs.push(f);
      } else {
        // pdf without matching odt — still expose it
        groups[base] = { odt: null, pdfs: [f] };
      }
    }
  });

  // Sort pdfs newest first
  Object.values(groups).forEach(g => {
    g.pdfs.sort().reverse();
  });

  // Attach approval state
  Object.keys(groups).forEach(base => {
    groups[base].approval = approvals[base] || null;
  });

  res.json(groups);
});

// ── POST /api/approve ─────────────────────────────────────────
// Body: { docName, approver, role }
// Converts odt → pdf, renames with timestamp, saves approval
app.post('/api/approve', (req, res) => {
  const { docName, approver, role } = req.body;
  if (!docName || !approver || !role) {
    return res.status(400).json({ error: 'docName, approver and role required' });
  }

  const odtPath = path.join(DOCS_DIR, `${docName}.odt`);
  if (!fs.existsSync(odtPath)) {
    return res.status(404).json({ error: `${docName}.odt not found in docs/` });
  }

  // LibreOffice: --outdir outputs <docName>.pdf next to odt
  const cmd = `libreoffice --headless --convert-to pdf --outdir "${DOCS_DIR}" "${odtPath}"`;

  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error('LibreOffice error:', stderr);
      return res.status(500).json({ error: 'PDF conversion failed', detail: stderr });
    }

    // LibreOffice writes docName.pdf — rename with timestamp
    const rawPdf = path.join(DOCS_DIR, `${docName}.pdf`);
    const now = new Date();
    const ts = now.toISOString()
      .replace('T', '_')
      .replace(/:/g, '-')
      .slice(0, 16); // "2025-04-22_14-33"
    const stampedPdf = `${docName}_${ts}.pdf`;
    const stampedPath = path.join(DOCS_DIR, stampedPdf);

    try {
      fs.renameSync(rawPdf, stampedPath);
    } catch (renameErr) {
      return res.status(500).json({ error: 'Rename failed', detail: renameErr.message });
    }

    // Save approval
    const approvals = loadApprovals();
    approvals[docName] = {
      approvedBy: approver,
      role,
      timestamp: now.toISOString(),
      pdfFilename: stampedPdf
    };
    saveApprovals(approvals);

    res.json({ ok: true, pdfFilename: stampedPdf, timestamp: now.toISOString() });
  });
});

// ── Static: serve docs folder ─────────────────────────────────
app.use('/docs', express.static(DOCS_DIR));

// ── Static: serve zerti and ueberwachung pages ────────────────
app.use('/zerti', express.static(path.join(ISO_DIR, 'zerti')));
app.use('/ueberwachung', express.static(path.join(ISO_DIR, 'ueberwachung')));

// Root → redirect to zerti
app.get('/', (req, res) => res.redirect('/zerti/'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ISO tracker running → http://localhost:${PORT}`));