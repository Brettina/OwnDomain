import { EmailMessage } from "cloudflare:email";

function esc(s) {
  return String(s || "").replace(/\r/g, "").trim();
}

function buildText(payload) {
  const kind = esc(payload.kind);
  const pageKey = esc(payload.pageKey);

  if (kind === "order") {
    const pickupPart = payload.datetime || payload.location_label || payload.lat || payload.lng
      ? `\nSaftladen-Termin:\nZeitpunkt: ${esc(payload.datetime)}\nOrt: ${esc(payload.location_label)}\nKoordinaten: ${esc(payload.lat)} ${esc(payload.lng)}\n`
      : "";

    return (
`Kind: order
Page: ${pageKey}

Product: ${esc(payload.productName)} (${esc(payload.productId)})
Qty: ${esc(payload.qty)}
Variant: ${esc(payload.variant)}
${pickupPart}
Name: ${esc(payload.name)}
Email: ${esc(payload.email)}

Notes:
${esc(payload.notes)}
`);
  }

  // contact
  return (
`Kind: contact
Page: ${pageKey}

Name: ${esc(payload.name)}
Email: ${esc(payload.email)}
Topic: ${esc(payload.topic)}

Message:
${esc(payload.message)}
`);
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;

  // Basic hard gate: only accept from same origin
  const origin = request.headers.get("Origin") || "";
  const host = new URL(request.url).origin;
  if (origin && origin !== host) return new Response("forbidden", { status: 403 });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }

  // only hipster
  if (payload.pageKey !== "hipster") return new Response("forbidden", { status: 403 });

  const subject =
    payload.kind === "order"
      ? `[hipster] Bestellung — ${esc(payload.productName)}`
      : `[hipster] Kontakt — ${esc(payload.topic) || "Anfrage"}`;

  const text = buildText(payload);

  // IMPORTANT: sender must be on the domain with Email Routing enabled. :contentReference[oaicite:3]{index=3}
  const from = `hipster@YOUR_DOMAIN_HERE`;  // <-- change
  const to = null; // binding destination_address will be used when null/undefined :contentReference[oaicite:4]{index=4}

  const msg = new EmailMessage(from, to, text);
  msg.setSubject(subject);

  try {
    await env.HIPSTER_SEND.send(msg);
    return new Response("ok");
  } catch (e) {
    return new Response(String(e && e.message ? e.message : e), { status: 500 });
  }
}
