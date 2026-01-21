function esc(s) {
  return String(s || "").replace(/\r/g, "").trim();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const MAILCHANNELS_URL = "https://api.mailchannels.net/tx/v1/send";

export async function onRequestPost(ctx) {
  try {
    const { request } = ctx;

    const origin = request.headers.get("Origin") || "";
    const host = new URL(request.url).origin;
    if (origin && origin !== host) {
      return json({ ok: false, error: "forbidden", origin, host }, 403);
    }

    let payload = {};
    try {
      payload = await request.json();
    } catch (e) {
      return json({ ok: false, error: "bad json", detail: String(e?.message || e) }, 400);
    }

    const to = "anfrage@weichware-lohr.de";
    const replyTo = esc(payload.replyTo);
    const message = esc(payload.message);

    if (!message) return json({ ok: false, error: "missing message" }, 400);

    const fromEmail = "web@weichware-lohr.de";
    const fromName = "Weichware Lohr (Test)";
    const subject = "[test] Mail-Test Webseite";

    const text =
`Mail-Test (webpages/test)

Reply-To: ${replyTo || "—"}

Message:
${message}
`;

    const mcBody = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromEmail, name: fromName },
      subject,
      content: [{ type: "text/plain", value: text }],
      ...(replyTo ? { reply_to: { email: replyTo } } : {})
    };

    const res = await fetch(MAILCHANNELS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mcBody)
    });

    const outText = await res.text();

    if (!res.ok) {
      return json({ ok: false, error: "mailchannels_failed", status: res.status, detail: outText }, 502);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: "exception", detail: String(e?.message || e) }, 500);
  }
}
