/*
WHY THIS APPROACH (condensed recap for future):
- Cloudflare Email Routing only receives/forwards mail; it cannot send.
- Cloudflare Pages/Workers can only do HTTP fetch, not SMTP (no TCP sockets).
- MailChannels “free send without account” no longer works (401), so we avoid provider APIs.
- Choice: use existing mailbox provider (web.de) SMTP as the sender.
- Solution: Pages Function receives the form and forwards JSON to a tiny self-hosted relay
  (PHP) that logs into smtp.web.de and sends the email.
*/

export async function onRequestPost({ request, env }) {
  const form = await request.formData();
  const name = (form.get("name") || "").toString().trim();
  const email = (form.get("email") || "").toString().trim();
  const message = (form.get("message") || "").toString().trim();

  await fetch(env.RELAY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-relay-token": env.RELAY_TOKEN
    },
    body: JSON.stringify({ name, email, message })
  });

  return new Response("OK");
}
