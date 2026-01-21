export async function onRequestPost(context) {
  const { request, env } = context;

  const contentType = request.headers.get("content-type") || "";
  let name = "";
  let email = "";
  let message = "";

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    name = (form.get("name") || "").toString().trim();
    email = (form.get("email") || "").toString().trim();
    message = (form.get("message") || "").toString().trim();
  } else if (contentType.includes("application/json")) {
    const body = await request.json();
    name = (body.name || "").toString().trim();
    email = (body.email || "").toString().trim();
    message = (body.message || "").toString().trim();
  } else {
    return new Response("Unsupported content type", { status: 415 });
  }

  if (!email || !message) {
    return new Response("Missing required fields", { status: 400 });
  }

  // --- basic anti-spam: simple honeypot field (optional)
  // If you add <input name="company" style="display:none"> in the form:
  // const company = (form.get("company") || "").toString().trim();
  // if (company) return new Response("OK", { status: 200 });

  // --- SEND EMAIL: call your mail-sending provider/API here ---
  // Example placeholder:
  // await fetch("https://api.provider.tld/send", { ... });

  return new Response("OK", { status: 200 });
}
