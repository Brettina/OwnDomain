# SEO-TODO

Offene Punkte zur SEO-Optimierung, die über `robots.txt`, `sitemap.xml` und `llms.txt` hinausgehen. Noch nicht umgesetzt.

## Open Graph / Twitter Cards
Keine Seite hat `og:title`, `og:description`, `og:image`. Ohne diese Tags erscheint beim Teilen (Social Media, Messenger) keine Vorschau.

## Strukturierte Daten (JSON-LD)
Kein `Person`- bzw. `ProfessionalService`-Schema vorhanden. Würde Rich Snippets in der Google-Suche ermöglichen.

## Alt-Texte bei Bildern
Z. B. in `webpages/blog/index.html` fehlen bei beiden `<img>`-Tags Alt-Texte. Betrifft vermutlich weitere Seiten. Relevant für Bildersuche und Barrierefreiheit.

## Canonical Links
Keine Seite hat `<link rel="canonical">`. Sinnvoll gegen Duplicate-Content-Risiken, z. B. bei den Teaser-Seiten (`webpages/teaser/*`).

## Sprache
Website-Inhalte (inkl. Meta-Tags wie Description) sollen durchgängig Deutsch sein, nicht Englisch.

## Inkonsistenzen
- `webpages/consulting/index.html`: `<h1>` ist leer.
- `webpages/consulting/index.html`: Meta-Description ist auf Englisch ("Project management, agency support, backoffice, marketing ops, and sales enablement."), muss auf Deutsch.

## Nicht geprüft, aber relevant
- Ladezeit / Core Web Vitals
- HTTPS-Redirect
- Mobile-Darstellung
- Backlinks
