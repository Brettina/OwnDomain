// ===========================================================================
//  search.js  —  ID-graph document search for the ISO tracker (no AI needed)
//  Wire into server.js with:   require('./search')(app, { currentRole, DOCS_DIR });
//  Then the front-end calls  GET /api/search?q=<term>
// ===========================================================================
const fs = require('fs');
const path = require('path');

module.exports = function attachSearch(app, { currentRole, DOCS_DIR }) {
  const DIRS = ['conv_tables', 'conv_meta', 'conv_markdown', 'conv_text'];
  // Auto-detect IDs: XXX-000 style and "G 0.00" Gefährdungs style.
  const ID_RE = /\b([A-Za-z]{2,4}\d?-\d{2,4}|[A-DG]\.\d{1,2}\.\d{1,2}|G\s?0\.\d{1,2})\b/g;
  const normId = s => s.toUpperCase().replace(/\s+/g, '');

  function parseCsv(t) {
    return t.split(/\r?\n/).map(l => {
      const o = []; let c = '', q = false;
      for (let i = 0; i < l.length; i++) {
        const ch = l[i];
        if (q) { if (ch === '"' && l[i+1] === '"') { c += '"'; i++; } else if (ch === '"') q = false; else c += ch; }
        else if (ch === '"') q = true;
        else if (ch === ',') { o.push(c); c = ''; }
        else c += ch;
      }
      o.push(c); return o;
    });
  }

  // ---- Index (built once, refreshable) ----
  let units = [];     // {file, line, text, ids:Set<string>, desc}
  let byId = {};      // id -> [units]
  let idFreq = {};    // id -> count (hub detection)
  let builtAt = 0;

  function buildIndex() {
    units = []; byId = {}; idFreq = {};
    for (const d of DIRS) {
      const dir = path.join(DOCS_DIR, d);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        let txt; try { txt = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
        if (f.endsWith('.csv')) {
          parseCsv(txt).forEach((row, i) => {
            const text = row.join(' | ');
            if (!text.trim()) return;
            const ids = new Set((text.match(ID_RE) || []).map(normId));
            const cells = row.map(c => c.trim())
              .filter(c => c && !/^[A-Za-z]{2,4}-\d{2,3}$/.test(c) && /[a-zA-Z]{3}/.test(c));
            units.push({ file: f, line: i + 1, text, ids, desc: cells.slice(0, 3).join(' ') });
          });
        } else {
          txt.split(/\r?\n/).forEach((ln, i) => {
            if (!ln.trim()) return;
            const ids = new Set((ln.match(ID_RE) || []).map(normId));
            units.push({ file: f, line: i + 1, text: ln, ids, desc: ln.length < 200 ? ln : '' });
          });
        }
      }
    }
    units.forEach(u => u.ids.forEach(id => (byId[id] = byId[id] || []).push(u)));
    Object.keys(byId).forEach(id => idFreq[id] = byId[id].length);
    builtAt = Date.now();
  }

  // ---- Fuzzy scoring: Dice bigrams + substring + longest-common-substring bonus ----
  function lcsLen(a, b) {
    a = a.toLowerCase(); b = b.toLowerCase();
    let best = 0;
    const dp = Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      let prev = 0;
      for (let j = 1; j <= b.length; j++) {
        const tmp = dp[j];
        dp[j] = a[i-1] === b[j-1] ? prev + 1 : 0;
        if (dp[j] > best) best = dp[j];
        prev = tmp;
      }
    }
    return best;
  }
  function score(term, text) {
    if (!term || !text) return 0;
    const t = term.toLowerCase(), x = text.toLowerCase();
    if (x.includes(t)) return 1;
    const bg = s => { const o = new Set(); for (let i = 0; i < s.length - 1; i++) o.add(s.slice(i, i+2)); return o; };
    const A = bg(t), B = bg(x); let n = 0; A.forEach(v => B.has(v) && n++);
    const dice = 2 * n / ((A.size + B.size) || 1);
    // bonus: how much of the term is covered by a contiguous substring of the text
    const cover = lcsLen(t, x) / t.length;            // e.g. crypto vs kryptographie -> "rypto" ~0.83
    return Math.max(dice, cover * 0.9);
  }

  function bestIds(term, k = 2, threshold = 0.55) {
    const scored = [];
    for (const [id, us] of Object.entries(byId)) {
      let s = 0;
      for (const u of us) { if (!u.desc) continue; const d = score(term, u.desc); if (d > s) s = d; }
      if (s >= threshold) scored.push({ id, score: +s.toFixed(3) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  // ---- Bounded BFS over the ID graph (up to 3 levels), hub-aware ----
  function expand(seedIds, maxDepth = 3, { perNode = 6, maxNodes = 25, hubCutoff = 40 } = {}) {
    const seen = new Set(seedIds);
    const order = seedIds.map(id => ({ id, depth: 0 }));
    const depthOf = {}; seedIds.forEach(id => depthOf[id] = 0);
    for (let qi = 0; qi < order.length && seen.size < maxNodes; qi++) {
      const { id, depth } = order[qi];
      if (depth >= maxDepth) continue;
      const nb = {};
      (byId[id] || []).forEach(u => u.ids.forEach(nid => {
        if (nid !== id && !seen.has(nid) && idFreq[nid] <= hubCutoff) nb[nid] = (nb[nid] || 0) + 1;
      }));
      Object.entries(nb).sort((a, b) => b[1] - a[1]).slice(0, perNode).forEach(([nid]) => {
        if (seen.size < maxNodes) { seen.add(nid); depthOf[nid] = depth + 1; order.push({ id: nid, depth: depth + 1 }); }
      });
    }
    return [...seen].map(id => ({ id, depth: depthOf[id] }));
  }

  // Rows for a set of ids, grouped per file, capped per file
  function rowsForIds(idList, perFileCap = 8) {
    const wanted = new Set(idList.map(x => x.id));
    const perFile = {};
    units.forEach(u => {
      for (const id of u.ids) if (wanted.has(id)) {
        (perFile[u.file] = perFile[u.file] || []).push({ line: u.line, text: u.text.slice(0, 400), ids: [...u.ids] });
        break;
      }
    });
    return Object.entries(perFile).map(([file, rows]) => ({ file, rows: rows.slice(0, perFileCap), total: rows.length }));
  }

  app.get('/api/search', (req, res) => {
    if (typeof currentRole === 'function' && !currentRole(req))
      return res.status(401).json({ error: 'Nicht angemeldet' });
    if (!builtAt) buildIndex();
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ q, textHits: [], idSection: null });

    // SECTION 1 — direct text hits, grouped per file
    const textPerFile = {};
    const ql = q.toLowerCase();
    for (const u of units) {
      if (u.text.toLowerCase().includes(ql)) {
        (textPerFile[u.file] = textPerFile[u.file] || []).push({ line: u.line, text: u.text.slice(0, 400) });
      }
    }
    const textHits = Object.entries(textPerFile)
      .map(([file, rows]) => ({ file, rows: rows.slice(0, 8), total: rows.length }));

    // SECTION 2 — fuzzy term -> best ID(s) -> 3-level graph expansion -> rows
    const seeds = bestIds(q, 2);
    let idSection = null;
    if (seeds.length) {
      const reached = expand(seeds.map(s => s.id), 3);
      idSection = {
        seeds,
        reachedIds: reached,                       // [{id, depth}]
        files: rowsForIds(reached)
      };
    }
    res.json({ q, textHits, idSection });
  });

  // optional: force a reindex (e.g. after converting new docs)
  app.post('/api/search/reindex', (req, res) => {
    if (typeof currentRole === 'function' && !currentRole(req))
      return res.status(401).json({ error: 'Nicht angemeldet' });
    buildIndex();
    res.json({ ok: true, units: units.length, ids: Object.keys(byId).length });
  });
};