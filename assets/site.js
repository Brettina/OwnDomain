// --- NEW: partial loader + page renderer ---


const CONTACT_EMAIL = "anfrage@weichware-lohr.de"; // <-- put your real inbox here
const DISPLAY_EMAIL = "anfrage [at] weichware-lohr.de"; // shown on page

let PRODUCTS_CACHE = null;

async function getProductsContent() {
  if (PRODUCTS_CACHE) return PRODUCTS_CACHE;
  const res = await fetch("/assets/products.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("Could not load products.json");
  PRODUCTS_CACHE = await res.json();
  return PRODUCTS_CACHE;
}


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
    `mailto:${CONTACT_EMAIL}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;

  window.location.href = url;
}

async function sendHipsterMailIfNeeded({ pageKey, payload, statusEl }) {
  // Only Hipster uses POST sending; every other page stays mailto.
  if (pageKey !== "hipster") return false;

  try {
    if (statusEl) statusEl.textContent = "Sende …";

    const res = await fetch("/api/hipster-mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      if (statusEl) statusEl.textContent = "Senden fehlgeschlagen — öffne Mail-Entwurf als Fallback.";
      console.warn("hipster-mail failed:", res.status, t);
      return false;
    }

    if (statusEl) statusEl.textContent = "Gesendet. Ich melde mich per Mail.";
    return true;
  } catch (e) {
    if (statusEl) statusEl.textContent = "Senden fehlgeschlagen — öffne Mail-Entwurf als Fallback.";
    console.warn("hipster-mail error:", e);
    return false;
  }
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

const status = form.querySelector("[data-form-status]") || (() => {
  const p = document.createElement("p");
  p.className = "fineprint";
  p.setAttribute("data-form-status", "");
  p.style.marginTop = "10px";
  form.appendChild(p);
  return p;
})();

const payload = {
  kind: "contact",
  pageKey,
  name,
  email,
  topic,
  message
};

sendHipsterMailIfNeeded({ pageKey, payload, statusEl: status }).then((ok) => {
  if (!ok) openMailto({ subject, body });
  else form.reset();
});
  });
}

function attachOrderFormHandlers(pageKey) {
  document.querySelectorAll("form[data-order-form]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();

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
`
+ `Item: ${item}
Quantity: ${qty}
Variant: ${variant}

Name: ${name}
Email: ${email}

Notes:
${notes}
`;

      // Legacy forms always use mailto (the Hipster v2 form uses POST via sendHipsterMailIfNeeded).
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

function renderStore(store, target, { pageKey, productsData } = {}) {
  target.innerHTML = "";
  if (!store) return;

  const productsAll = (productsData && productsData.products) ? productsData.products : [];
  const orderCfg = (productsData && productsData.order) ? productsData.order : null;
  const productsForPage = productsAll.filter(p => (p.page || "") === pageKey);

  // Intro text
  if (store.intro) target.appendChild(el("p", { class: "fineprint", text: store.intro }));

  // If we have products for this page, render them
  if (productsForPage.length) {
    // Product grid
    target.appendChild(el("h3", { text: "Produkte" }));
    const grid = el("div", { class: "cards" });

    productsForPage.forEach((p) => {
      const imgWrap = el("div", { class: "product-imgwrap" });

      if (p.decorateJuice) {
        const canvas = el("canvas", {
          class: "product-img",
          width: "1200",
          height: "900",
          "data-juice-canvas": "1",
          "data-src": p.image,
          "aria-label": `${p.name} Produktbild (variiert)`
        });
        imgWrap.appendChild(canvas);
      } else {
        imgWrap.appendChild(el("img", {
          class: "product-img",
          src: p.image,
          alt: p.name,
          loading: "lazy"
        }));
      }

      const meta = el("div", { class: "meta" }, [
        el("span", { class: "badge", text: p.status || "—" })
      ]);

      const pickBtn = el("button", {
        class: "button button-secondary",
        type: "button",
        text: "Für Bestellung auswählen"
      });

      pickBtn.addEventListener("click", () => {
        const sel = target.querySelector("select[data-order-product]");
        if (!sel) return;
        sel.value = p.id;
        sel.dispatchEvent(new Event("change"));
        const form = target.querySelector("form[data-order-form-v2]");
        if (form) form.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      const card = el("article", { class: "card product" }, [
        imgWrap,
        el("h4", { text: p.name }),
        el("p", { text: p.description || "" }),
        meta,
        el("div", { class: "cta-row" }, [pickBtn])
      ]);

      grid.appendChild(card);
    });

    target.appendChild(grid);

    // Order form
    target.appendChild(el("h3", { text: "Bestellung zur Abholung (Anfrage)" }));
    if (orderCfg && orderCfg.pickupHint) {
      target.appendChild(el("p", { class: "fineprint", text: orderCfg.pickupHint }));
    }

    const form = el("form", { class: "form", "data-order-form-v2": "" });

    // Honeypot
    form.appendChild(el("div", {
      class: "field",
      style: "position:absolute; left:-9999px;",
      "aria-hidden": "true"
    }, [
      el("label", { for: "company-order-v2", text: "Company" }),
      el("input", { id: "company-order-v2", name: "company", autocomplete: "off", tabindex: "-1" })
    ]));

    // Product select
    form.appendChild(el("div", { class: "field" }, [
      el("label", { for: "order-product", text: "Produkt" }),
      (() => {
        const sel = el("select", {
          id: "order-product",
          name: "product",
          required: "",
          "data-order-product": ""
        });
        productsForPage.forEach(p => sel.appendChild(el("option", { value: p.id, text: p.name })));
        return sel;
      })()
    ]));

    // Quantity
    form.appendChild(el("div", { class: "field" }, [
      el("label", { for: "order-qty", text: "Menge" }),
      el("input", { id: "order-qty", name: "qty", type: "number", min: "1", max: "50", value: "1", required: "" })
    ]));

    // Variant
    const variantField = el("div", { class: "field" }, [
      el("label", { for: "order-variant", text: "Variante" }),
      el("select", { id: "order-variant", name: "variant" })
    ]);
    form.appendChild(variantField);

    // Pickup block (ONLY for pickupRequired product)
    const pickupBlock = el("div", {
      class: "card",
      "data-pickup-block": "",
      style: "display:none; margin-top:14px;"
    }, [
      el("h4", { text: "Saftladen — Termin & Ort" }),
      el("p", { class: "fineprint", text: "Nur für Saftladen nötig. Für andere Produkte reicht eine normale Anfrage." }),

      el("div", { class: "field" }, [
        el("label", { for: "order-pickup-dt", text: "Abhol-Zeitpunkt (Wunsch)" }),
        el("input", { id: "order-pickup-dt", name: "datetime", type: "datetime-local" })
      ]),

      el("div", { class: "field" }, [
        el("label", { for: "order-pickup-location-label", text: "Abholort (kurz beschreiben)" }),
        el("input", {
          id: "order-pickup-location-label",
          name: "location_label",
          placeholder: "z.B. Lohr Zentrum / Würzburg Hbf / Parkplatz …"
        })
      ]),

      el("input", { type: "hidden", name: "lat", value: "" }),
      el("input", { type: "hidden", name: "lng", value: "" }),

      el("div", { class: "field" }, [
        el("label", { text: "Ort auf der Karte wählen (Klick setzt Marker)" }),
        el("div", { class: "map", id: "order-map", role: "application", "aria-label": "Karte zur Ortsauswahl" }),
        el("p", { class: "fineprint", text: "Wenn die Karte nicht lädt: Ort oben beschreiben; Koordinaten sind optional." })
      ]),

      el("div", { class: "field" }, [
        el("label", { text: "Saftladen — bereits geplant (zum Dazukommen)" }),
        el("div", { "data-saftladen-calendar": "" }),
        el("p", { class: "fineprint", text: "Nur Anzeige. Bearbeitung nur durch Admin (JSON-Datei im Repo)." })
      ])
    ]);

    form.appendChild(pickupBlock);

    // Contact fields
    form.appendChild(el("div", { class: "field" }, [
      el("label", { for: "order-name", text: "Name" }),
      el("input", { id: "order-name", name: "name", autocomplete: "name", required: "" })
    ]));
    form.appendChild(el("div", { class: "field" }, [
      el("label", { for: "order-email", text: "E-Mail" }),
      el("input", { id: "order-email", name: "email", type: "email", autocomplete: "email", required: "" })
    ]));
    form.appendChild(el("div", { class: "field" }, [
      el("label", { for: "order-notes", text: "Notizen" }),
      el("textarea", { id: "order-notes", name: "notes", rows: "4", placeholder: "Sonderwünsche, Alternativ-Zeiten, Variante/Farbe/Material, etc." })
    ]));

    // Consent
    form.appendChild(el("div", { class: "field checkbox" }, [
      el("input", { id: "order-consent", name: "consent", type: "checkbox", required: "" }),
      el("label", { for: "order-consent", text: "Ich stimme zu, dass meine Daten zur Beantwortung meiner Bestellung verwendet werden." })
    ]));

    form.appendChild(el("button", { class: "button", type: "submit", text: "Bestellung absenden" }));

    // Status message
    const statusBox = el("p", { class: "fineprint", "data-form-status": "", style: "margin-top:10px;" }, []);
    form.appendChild(statusBox);

    target.appendChild(form);

    // Variants
    const productSelect = form.querySelector("select[name=product]");
    const variantSelect = form.querySelector("select[name=variant]");

    const fillVariants = () => {
      const id = productSelect.value;
      const p = productsForPage.find(x => x.id === id);
      variantSelect.innerHTML = "";
      (p && p.variants && p.variants.length ? p.variants : ["Standard"])
        .forEach(v => variantSelect.appendChild(el("option", { value: v, text: v })));
    };

    // Pickup toggle
    const setPickupRequired = (on) => {
      const dt = form.querySelector('input[name="datetime"]');
      const loc = form.querySelector('input[name="location_label"]');

      pickupBlock.style.display = on ? "" : "none";

      if (on) {
        dt.setAttribute("required", "");
        loc.setAttribute("required", "");
      } else {
        dt.removeAttribute("required");
        loc.removeAttribute("required");
        dt.value = "";
        loc.value = "";
        form.querySelector('input[name="lat"]').value = "";
        form.querySelector('input[name="lng"]').value = "";
      }
    };

    const syncPickupUI = () => {
      const id = productSelect.value;
      const p = productsForPage.find(x => x.id === id);
      setPickupRequired(!!(p && p.pickupRequired));
    };

    productSelect.addEventListener("change", () => {
      fillVariants();
      syncPickupUI();
    });

    fillVariants();
    syncPickupUI();

    // Calendar (read-only)
    renderSaftladenCalendar(
      pickupBlock.querySelector("[data-saftladen-calendar]"),
      "/assets/saftladen-bookings.json"
    );

    // Submit
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const honey = form.querySelector('input[name="company"]');
      if (honey && honey.value.trim() !== "") return;

      const fd = new FormData(form);
      const productId = (fd.get("product") || "").toString();
      const p = productsForPage.find(x => x.id === productId);

      const payload = {
        kind: "order",
        pageKey,
        productId,
        productName: p ? p.name : productId,
        qty: (fd.get("qty") || "1").toString().trim(),
        variant: (fd.get("variant") || "Standard").toString().trim(),
        datetime: (fd.get("datetime") || "").toString().trim(),
        location_label: (fd.get("location_label") || "").toString().trim(),
        lat: (fd.get("lat") || "").toString().trim(),
        lng: (fd.get("lng") || "").toString().trim(),
        name: (fd.get("name") || "").toString().trim(),
        email: (fd.get("email") || "").toString().trim(),
        notes: (fd.get("notes") || "").toString().trim()
      };

      const status = form.querySelector("[data-form-status]");
      const ok = await sendHipsterMailIfNeeded({ pageKey, payload, statusEl: status });

      // fallback to mailto if POST not available or fails
      if (!ok) {
        const subject = `[${pageKey}] Bestellung — ${payload.productName}`;
        const body =
`Seite: ${pageKey}

Produkt: ${payload.productName}
Menge: ${payload.qty}
Variante: ${payload.variant}

${p && p.pickupRequired ? `Saftladen-Termin:
Zeitpunkt: ${payload.datetime}
Ort: ${payload.location_label}
Koordinaten: ${payload.lat && payload.lng ? `${payload.lat}, ${payload.lng}` : "—"}
` : ""}

Kontakt:
Name: ${payload.name}
E-Mail: ${payload.email}

Notizen:
${payload.notes}
`;
        openMailto({ subject, body });
      } else {
        form.reset();
        fillVariants();
        syncPickupUI();
      }
    });

    // Map init (only inside pickupBlock)
    initOrderMap({
      root: pickupBlock,
      orderCfg,
      locations: orderCfg && orderCfg.locations ? orderCfg.locations : []
    });

    // Decorate “juice” canvases
    decorateJuiceCanvases(target);

    return;
  }

  // Fallback (no products.json for page)
  target.appendChild(el("p", {
    class: "fineprint",
    text: "Hinweis: Keine Produkte aus products.json gefunden — fallback auf Seitenkonfiguration."
  }));
}



function initOrderMap({ root, orderCfg, locations }) {
  const mapEl = root.querySelector("#order-map");
  if (!mapEl) return;

  const latInput = root.querySelector('input[name="lat"]');
  const lngInput = root.querySelector('input[name="lng"]');
  const locLabelInput = root.querySelector('input[name="location_label"]');

  // If Leaflet isn't available, don't break the form
  if (!window.L) {
    mapEl.style.display = "none";
    return;
  }

  const center = (orderCfg && orderCfg.defaultCenter) ? orderCfg.defaultCenter : { lat: 49.989, lng: 9.578 };

  const map = L.map(mapEl, { scrollWheelZoom: false }).setView([center.lat, center.lng], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  let marker = null;

  const setPoint = (lat, lng) => {
    if (!marker) marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    marker.setLatLng([lat, lng]);
    latInput.value = String(lat);
    lngInput.value = String(lng);

    marker.off("dragend");
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      latInput.value = String(p.lat);
      lngInput.value = String(p.lng);
    });
  };

  map.on("click", (e) => setPoint(e.latlng.lat, e.latlng.lng));

  // Add quick-pick location buttons (from products.json)
  if (Array.isArray(locations) && locations.length) {
    const btnRow = el("div", { class: "cta-row", style: "margin-top:10px;" });
    locations.forEach((loc) => {
      const b = el("button", { class: "button button-secondary", type: "button", text: loc.label });
      b.addEventListener("click", () => {
        locLabelInput.value = loc.label;
        map.setView([loc.lat, loc.lng], 14);
        setPoint(loc.lat, loc.lng);
      });
      btnRow.appendChild(b);
    });
    mapEl.insertAdjacentElement("afterend", btnRow);
  }
}
async function renderSaftladenCalendar(host, url) {
  if (!host) return;
  host.innerHTML = "Lade Termine …";

  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error("bookings load failed");
    const data = await res.json();

    const slots = Array.isArray(data.slots) ? data.slots.slice() : [];
    slots.sort((a, b) => String(a.start).localeCompare(String(b.start)));

    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.style.padding = "12px";

    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.textContent = "Geplante Saftladen-Termine";
    wrap.appendChild(title);

    const ul = document.createElement("ul");
    ul.className = "fineprint";
    ul.style.margin = "10px 0 0";
    ul.style.paddingLeft = "18px";

    if (!slots.length) {
      const li = document.createElement("li");
      li.textContent = "Noch keine Termine eingetragen.";
      ul.appendChild(li);
    } else {
      for (const s of slots) {
        const li = document.createElement("li");
        const start = (s.start || "").replace("T", " ");
        const end = (s.end || "").replace("T", " ");
        const loc = s.location || "—";
        const note = s.note ? ` — ${s.note}` : "";
        li.textContent = `${start}–${end} | ${loc}${note}`;
        ul.appendChild(li);
      }
    }

    wrap.appendChild(ul);
    host.replaceChildren(wrap);
  } catch (e) {
    console.warn("renderSaftladenCalendar:", e);
    host.textContent = "Termine konnten nicht geladen werden.";
  }
}

function decorateJuiceCanvases(root) {
  const canvases = root.querySelectorAll("canvas[data-juice-canvas]");
  canvases.forEach((c) => {
    const src = c.getAttribute("data-src");
    if (!src) return;

    const ctx = c.getContext("2d");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = c.width, h = c.height;

      // draw base
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      // “slightly different”: subtle warm tint + tiny “juice” doodle
      ctx.fillStyle = "rgba(255, 180, 60, 0.10)";
      ctx.fillRect(0, 0, w, h);

      // sticker-like juice icon
      ctx.save();
      ctx.translate(w * 0.08, h * 0.12);
      ctx.rotate(-0.08);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      roundRect(ctx, 0, 0, w * 0.22, h * 0.10, 24);
      ctx.fill();

      ctx.fillStyle = "rgba(20,20,20,0.85)";
      ctx.font = `${Math.floor(h * 0.045)}px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
      ctx.fillText("SAFT", w * 0.03, h * 0.065);

      // tiny “straw”
      ctx.strokeStyle = "rgba(20,20,20,0.85)";
      ctx.lineWidth = Math.max(6, h * 0.007);
      ctx.beginPath();
      ctx.moveTo(w * 0.19, h * 0.01);
      ctx.lineTo(w * 0.16, h * 0.07);
      ctx.stroke();

      ctx.restore();
    };
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
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
   const productsData = await getProductsContent().catch(() => null);

renderServices(page.services, document.querySelector("[data-services]"));
const storeSection = document.querySelector("[data-store-section]");
const storeTarget = document.querySelector("[data-store]");
if (page.hideStore) {
  if (storeSection) storeSection.style.display = "none";
} else {
  if (storeSection) storeSection.style.display = "";
  renderStore(page.store, storeTarget, { pageKey, productsData });


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
