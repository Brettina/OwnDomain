import { EmailMessage } from "cloudflare:email";

function esc(s) {
  return String(s || "").replace(/\r/g, "").trim();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestPost(ctx) {
  try {
    const { request, env } = ctx;

    // 1) Same-origin guard
    const origin = request.headers.get("Origin") || "";
    const host = new URL(request.url).origin;
    if (origin && origin !== host) {
      return json({ ok: false, error: "forbidden", origin, host }, 403);
    }

    // 2) Parse JSON
    let payload = {};
    try {
      payload = await request.json();
    } catch (e) {
      return json({ ok: false, error: "bad json", detail: String(e?.message || e) }, 400);
    }

    const to = "anfrage@weichware-lohr.de";
    const replyTo = esc(payload.replyTo);
    const message = esc(payload.message);

    if (!message) {
      return json({ ok: false, error: "missing message" }, 400);
    }

    // 3) HARD CHECK: binding exists
    if (!env || !env.HIPSTER_SEND || typeof env.HIPSTER_SEND.send !== "function") {
      return json({
        ok: false,
        error: "missing email binding env.HIPSTER_SEND",
        hint: "Check Cloudflare Pages/Workers bindings: you need an Email Routing binding named HIPSTER_SEND."
      }, 500);
    }

    // 4) IMPORTANT: sender must be on YOUR domain with Email Routing enabled
    // CHANGE THIS LINE:
    const from = "anfrage@weichware-lohr.de";

    const subject = "[test] Mail-Test Webseite";
    const body =
`Mail-Test (webpages/test)

Reply-To: ${replyTo || "—"}

Message:
${message}
`;

    const msg = new EmailMessage(from, to, body);
    msg.setSubject(subject);
    if (replyTo) msg.headers.set("Reply-To", replyTo);

    await env.HIPSTER_SEND.send(msg);

    return json({ ok: true });
  } catch (e) {
    // If ANY exception happens, return it as JSON instead of CF's 1101 page
    return json({ ok: false, error: "exception", detail: String(e?.message || e) }, 500);
  }
}
