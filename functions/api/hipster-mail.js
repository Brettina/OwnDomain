import { EmailMessage } from "cloudflare:email";

function esc(s) {
  return String(s || "").replace(/\r/g, "").trim();
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;

  // Only accept same-origin requests (good)
  const origin = request.headers.get("Origin") || "";
  const host = new URL(request.url).origin;
  if (origin && origin !== host) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "bad json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Expect: { to, replyTo, subject, text, meta }
  const to = esc(payload.to);
  const replyTo = esc(payload.replyTo);
  const subject = esc(payload.subject);
  const text = esc(payload.text);

  if (!to || !subject || !text) {
    return new Response(JSON.stringify({ ok: false, error: "missing fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // IMPORTANT: this must be a sender on your domain with Email Routing enabled
  // Example: "webshop@weichware-lohr.de"
  const from = `anfrage@weichware-lohr.de`; // <-- CHANGE THIS

  const msg = new EmailMessage(from, to, text);
  msg.setSubject(subject);

  if (replyTo) {
    // Cloudflare EmailMessage supports headers
    msg.headers.set("Reply-To", replyTo);
  }

  try {
    await env.HIPSTER_SEND.send(msg);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
