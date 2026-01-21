
export async function onRequestPost({ request }) {
  const form = await request.formData();
  const name = (form.get("name") || "").toString().trim();
  const email = (form.get("email") || "").toString().trim();
  const message = (form.get("message") || "").toString().trim();

  console.log("CONTACT FORM:", { name, email, messageLength: message.length });

  return new Response(
    JSON.stringify({ ok: true, name, email, message }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}
