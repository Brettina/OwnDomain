export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const host = url.hostname;

  const publishHosts = ["publish-lohr.com", "www.publish-lohr.com"];

  if (publishHosts.includes(host)) {
    const targetBase = "/webpages/teaser/teaser-publish";

    if (url.pathname === "/" || url.pathname === "") {
      url.pathname = `${targetBase}/`;
    } else {
      url.pathname = `${targetBase}${url.pathname}`;
    }

    return fetch(new Request(url.toString(), request));
  }

  return next();
}
