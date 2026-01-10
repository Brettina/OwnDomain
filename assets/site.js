// --- NEW: partial loader + page renderer ---


const CONTACT_EMAIL = "software_b_lohr@web.de"; // <-- put your real inbox here
const DISPLAY_EMAIL = "software_b_lohr [at] web.de"; // shown on page

async function loadPartial(selector, url) {
  const host = document.querySelector(selector);
  if (!host) return;
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) return;
  host.innerHTML = await res.text();
}

function setAriaCurrent(pageKey) {
  document.querySelectorAll("[data-nav]").forEach(a => {
    if (a.getAttribute("data-nav") === pageKey) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

async function getPagesContent() {
  const res = await fetch("/assets/pages.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("Could not load pages.json");
  return await res.json();
}

function renderObfuscatedEmail() {
  document.querySelectorAll("[data-email]").forEach(host => {
    const a = document.createElement("a");
    a.href = `mailto:${CONTACT_EMAIL}`;
    a.textContent = DISPLAY_EMAIL;
    host.replaceChildren(a);
  });
}
function openMailto({ subject, body }) {
  const url =
    `mailto:${encodeURIComponent(CONTACT_EMAIL)}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;

  window.location.href = url;
}

function attachContactFormHandler(pageKey) {
  const form = document.querySelector("[data-contact-form]");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    // Honeypot: if filled => do nothing (spam)
    const honey = form.querySelector('input[name="company"]');
    if (honey && honey.value.trim() !== "") return;

    const fd = new FormData(form);
    const name = (fd.get("name") || "").toString().trim();
    const email = (fd.get("email") || "").toString().trim();
    const topic = (fd.get("topic") || "").toString().trim();
    const message = (fd.get("message") || "").toString().trim();

    const subject = `[${pageKey}] ${topic || "contact"} — ${name || "anonymous"}`;
    const body =
`Page: ${pageKey}
Name: ${name}
Email: ${email}
Topic: ${topic}

Message:
${message}
`;

    openMailto({ subject, body });
  });
}

function attachOrderFormHandlers(pageKey) {
  document.querySelectorAll("form[data-order-form]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();

      // Honeypot: if filled => do nothing (spam)
      const honey = form.querySelector('input[name="company"]');
      if (honey && honey.value.trim() !== "") return;

      const item = form.getAttribute("data-item") || "Item";
      const fd = new FormData(form);

      const qty = (fd.get("qty") || "1").toString().trim();
      const variant = (fd.get("variant") || "Default").toString().trim();
      const name = (fd.get("name") || "").toString().trim();
      const email = (fd.get("email") || "").toString().trim();
      const notes = (fd.get("notes") || "").toString().trim();

      const subject = `[${pageKey}] Order request — ${item}`;
      const body =
`Page: ${pageKey}
Item: ${item}
Quantity: ${qty}
Variant: ${variant}

Name: ${name}
Email: ${email}

Notes:
${notes}
`;

      openMailto({ subject, body });
    });
  });
}


function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) {
    if (typeof c === "string") n.appendChild(document.createTextNode(c));
    else if (c) n.appendChild(c);
  }
  return n;
}

function renderPills(pills, target) {
  target.innerHTML = "";
  const ul = el("ul", { class: "pill-list", "aria-label": "Key areas" });
  (pills || []).forEach(p => ul.appendChild(el("li", { text: p })));
  target.appendChild(ul);
}

function renderServices(services, target) {
  target.innerHTML = "";

  // Use <details> to keep the page shorter/readable
  (services || []).forEach(group => {
    const details = el("details", { class: "card" });
    details.appendChild(el("summary", { text: group.group }));

    const wrap = el("div", { class: "cards", style: "margin-top:12px;" });
    (group.items || []).forEach(it => {
      const card = el("article", { class: "card" }, [
        el("h3", { text: it.name }),
        el("p", { text: it.desc })
      ]);
      wrap.appendChild(card);
    });

    details.appendChild(wrap);
    target.appendChild(details);
  });
}

function renderStore(store, target) {
  target.innerHTML = "";
  if (!store) return;

  target.appendChild(el("p", { class: "fineprint", text: store.intro || "" }));

  // Current
  target.appendChild(el("h3", { text: "Current" }));
  const currentWrap = el("div", { class: "cards" });

  (store.current || []).forEach((p, idx) => {
    const card = el("article", { class: "card product" }, [
      el("h4", { text: p.item }),
      el("p", { text: `Status: ${p.status || "—"} · ${p.desc || ""}` })
    ]);

    const form = el("form", { class: "form", "data-order-form": "", "data-item": p.item });

    // honeypot
    form.appendChild(el("div", { class: "field", style: "position:absolute; left:-9999px;", "aria-hidden": "true" }, [
      el("label", { for: `company-store-${idx}`, text: "Company" }),
      el("input", { id: `company-store-${idx}`, name: "company", autocomplete: "off", tabindex: "-1" })
    ]));

    // qty
    form.appendChild(el("div", { class: "field" }, [
      el("label", { for: `qty-store-${idx}`, text: "Quantity" }),
      el("input", { id: `qty-store-${idx}`, name: "qty", type: "number", min: "1", max: "50", value: "1", required: "" })
    ]));

    // variant
    form.appendChild(el("div", { class: "field" }, [
      el("label", { for: `variant-store-${idx}`, text: "Variant" }),
      (() => {
        const sel = el("select", { id: `variant-store-${idx}`, name: "variant" });
        (p.variants || ["Default"]).forEach(v => sel.appendChild(el("option", { value: v, text: v })));
        return sel;
      })()
    ]));

    // name/email/notes
    form.appendChild(el("div", { class: "field" }, [
      el("label", { for: `name-store-${idx}`, text: "Name" }),
      el("input", { id: `name-store-${idx}`, name: "name", autocomplete: "name", required: "" })
    ]));
    form.appendChild(el("div", { class: "field" }, [
      el("label", { for: `email-store-${idx}`, text: "Email" }),
      el("input", { id: `email-store-${idx}`, name: "email", type: "email", autocomplete: "email", required: "" })
    ]));
    form.appendChild(el("div", { class: "field" }, [
      el("label", { for: `notes-store-${idx}`, text: "Notes" }),
      el("textarea", { id: `notes-store-${idx}`, name: "notes", rows: "3" })
    ]));

    form.appendChild(el("button", { class: "button", type: "submit", text: "Email order request" }));

    card.appendChild(form);
    currentWrap.appendChild(card);
  });

  target.appendChild(currentWrap);

  // Past
  target.appendChild(el("h3", { text: "Past" }));
  const pastWrap = el("div", { class: "cards" });
  (store.past || []).forEach(p => {
    pastWrap.appendChild(el("article", { class: "card product" }, [
      el("h4", { text: p.item }),
      el("p", { text: p.desc || "" })
    ]));
  });
  target.appendChild(pastWrap);
}

function renderTimeline(timeline, target) {
  target.innerHTML = "";
  const ol = el("ol", { class: "timeline" });
  (timeline || []).forEach(t => {
    ol.appendChild(el("li", {}, [
      el("div", { class: "time", text: t.year }),
      el("div", { class: "content" }, [
        el("h3", { text: t.title }),
        el("p", { text: t.desc })
      ])
    ]));
  });
  target.appendChild(ol);
}

function renderContactTopics(options, selectEl) {
  selectEl.innerHTML = "";
  (options || []).forEach(([val, label]) => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    selectEl.appendChild(opt);
  });
}

async function initPageFromJSON() {
  const pageKey = document.body.getAttribute("data-page");
  if (!pageKey) return;

  const data = await getPagesContent();
  const page = data[pageKey];
  if (!page) return;

  setAriaCurrent(pageKey);

  // hero
  document.querySelector("[data-title]").textContent = page.title || "";
  document.querySelector("[data-lead]").textContent = page.lead || "";
  renderPills(page.pills || [], document.querySelector("[data-pills]"));

  // scope note
  const scope = document.querySelector("[data-scope]");
  scope.innerHTML = "";
  (page.scopeNote || []).forEach(line => scope.appendChild(el("p", { class: "fineprint", text: line })));

  // services/store/timeline
  renderServices(page.services, document.querySelector("[data-services]"));
    const storeSection = document.querySelector("[data-store-section]");
    const storeTarget = document.querySelector("[data-store]");
    if (page.hideStore) {
    if (storeSection) storeSection.style.display = "none";
    } else {
    if (storeSection) storeSection.style.display = "";
    renderStore(page.store, storeTarget);
    }
  renderTimeline(page.timeline, document.querySelector("[data-timeline]"));

  // contact topics
  const topicSelect = document.querySelector("select[name=topic]");
  if (topicSelect) renderContactTopics(page.contactTopicOptions, topicSelect);
}

async function initSharedLayout() {
  await loadPartial("#header-slot", "/assets/partials/header.html");
  await loadPartial("#footer-slot", "/assets/partials/footer.html");

  // year in footer
  document.querySelectorAll("[data-year]").forEach(el => el.textContent = new Date().getFullYear());
}

// Call these alongside your existing mailto/email-obfuscation init
async function initSite() {
  await initSharedLayout();
  await initPageFromJSON();

  renderObfuscatedEmail();

  const pageKey = document.body.getAttribute("data-page") || "home";
  attachContactFormHandler(pageKey);
  attachOrderFormHandlers(pageKey);
}


document.addEventListener("DOMContentLoaded", () => {
  initSite().catch(() => {});
});
