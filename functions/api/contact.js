export async function onRequestPost({ request, env }) {
  const form = await request.formData();

  const name = (form.get("name") || "").toString().trim();
  const email = (form.get("email") || "").toString().trim();
  const message = (form.get("message") || "").toString().trim();

  if (!email || !message) {
    return new Response("Missing required fields", { status: 400 });
  }

  const mailPayload = {
    personalizations: [
      {
        to: [{ email: env.MAIL_TO }],
        reply_to: { email }
      }
    ],
    from: {
      email: env.MAIL_FROM,
      name: "Website Kontakt"
    },
    subject: "Neue Anfrage über die Website",
    content: [
      {
        type: "text/plain",
        value:
          `Name: ${name}\n` +
          `Email: ${email}\n\n` +
          message
      }
    ]
  };

  const resp = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(mailPayload)
  });

   if (!resp.ok) {
    const errText = await resp.text();
    return new Response(
      `Mail send failed\nStatus: ${resp.status}\n${errText}`,
      { status: 500 }
    );
  }


  return new Response("OK", { status: 200 });
}
