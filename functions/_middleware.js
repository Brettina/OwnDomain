export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const host = url.hostname;

  // TEMP DEBUG (put first)
  if (host === "publish-lohr.com" || host === "www.publish-lohr.com") {
    return new Response("middleware-hit", { status: 200 });
  }

  return next();
}
