# Search engine ownership files

Put a search engine's site-verification file here and the build (`scripts/build-data.cjs`) copies it to the root of the site, where the search engine looks for it.

- **Google Search Console**: add the property `https://www.thegatecast.com/` as a URL-prefix property, choose "HTML file", download the file (named like `google1234abcd5678ef90.html`), put it in this folder unchanged, commit and deploy. Then press Verify in Search Console. Keep the file here afterwards: Google checks it again from time to time. (A Domain property for `thegatecast.com`, verified with a TXT record under Vercel → Domains → thegatecast.com → DNS Records, also works and needs no file.) The site was at `https://gatecast.vercel.app/` until 18 Nov 2026; `docs/seo/domain-move.md` has the steps for the move.
- **Bing Webmaster Tools**: the easiest route is "Import from Google Search Console" once Google is verified. If you verify by file instead, Bing's `BingSiteAuth.xml` goes here in the same way.

Only `.html`, `.txt` and `.xml` files with plain names are copied, and the build stops with an error rather than let one replace a file of the site (a page, `robots.txt`, `sitemap.xml`, the icons or the IndexNow key). This README is not copied.

These files are public by design: they prove ownership only because nobody else can put them on this site.
