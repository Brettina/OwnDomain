import { EmailMessage } from "cloudflare:email";

function esc(s) {
  return String(s || "").replace(/\r/g, "").trim();
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;

  // same-origin guard (keep it simple + safe)
  const origin = request.headers.get("Origin") || "";
  const host = new URL(request.url).origin;
  if (origin && origin !== host) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "bad json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const to = "anfrage@weichware-lohr.de";
  const replyTo = esc(payload.replyTo);
  const message = esc(payload.message);

  if (!message) {
    return new Response(JSON.stringify({ ok: false, error: "missing message" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // IMPORTANT: must be an address on *your* domain with Email Routing enabled
  // Replace with a real sender you configured in Cloudflare Email Routing.
  const from = "web@anfrage@weichware-lohr.de"; // <-- CHANGE THIS

  const subject = "[test] Mail-Test Webseite";
  const body =
`Mail-Test (webpages/test)

Reply-To: ${replyTo || "—"}

Message:
${message}
`;

  const msg = new EmailMessage(from, to, body);
  msg.setSubject(subject);

  if (replyTo) {
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
