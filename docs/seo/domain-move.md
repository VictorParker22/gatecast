# Moving Gatecast to thegatecast.com: the owner's checklist

18 Nov 2026. The site was at `https://gatecast.vercel.app`. Its address is now `https://thegatecast.com`: the bare domain, with https and without www. The pages and their paths are the same; only the host changed.

Do the steps in this order. Each one says how to check that it worked.

## Where things stood on 18 Nov 2026

Read from Vercel that day. Nothing was changed.

| Question | Answer |
|---|---|
| Is `thegatecast.com` on the gatecast project? | Yes, and verified |
| Is `www.thegatecast.com` on the project? | Yes, and verified |
| Is the DNS right? | Yes. The domain was bought through Vercel and uses Vercel's nameservers. Vercel reports no misconfiguration and has issued a certificate for both names |
| Which one is the main address? | **`www.thegatecast.com`.** `thegatecast.com` redirects to it (308). This is Vercel's default and the opposite of what the code says, so step 1 changes it |
| Does `gatecast.vercel.app` redirect to the new address? | No. It still showed the site. Step 4 changes it |

## 1. Vercel: make thegatecast.com the main address

Every page now names `https://thegatecast.com/...` as its address. Until this step is done, that address forwards to the www form, and search engines get two answers.

In Vercel, open the gatecast project, then Settings → Domains.

1. Open `thegatecast.com` → Edit. Turn the redirect off: choose "Connect to an environment" and "Production". Save.
2. Open `www.thegatecast.com` → Edit. Choose "Redirect to" `thegatecast.com`, with "308 Permanent Redirect". Save.

Do them in that order, so the two names never point at each other.

**Check:** open `https://www.thegatecast.com/how.html`. The address bar should end up at `https://thegatecast.com/how.html`.

**At the registrar:** nothing to do. Vercel is the registrar and runs the DNS. If the domain ever moves to another DNS provider, Vercel's Domains page shows the two records to copy (an A record for `thegatecast.com` and a CNAME for `www`).

Do not add a www redirect to `vercel.json` as well. One redirect in the code and one in the dashboard, pointing opposite ways, would loop.

## 2. Supabase: let the new address vote, send tips and sign in

Votes, tips, book suggestions and the review console's "Draft with Claude" are refused from an address the two Supabase functions do not know. Do this before step 4 sends every visitor to the new address.

In the Supabase dashboard, project `hfdwmzuedjcsaxgzhzmu`:

1. Edge Functions → Secrets. Set both of these to `https://thegatecast.com,https://www.thegatecast.com`:
   - `COMMUNITY_ALLOWED_ORIGINS`
   - `ASSIST_ALLOWED_ORIGINS`

   This works at once, with no deploy. The same addresses are also in the functions' code now, so the secrets can be removed after the lead next deploys `community` and `assist` (the commands are in `supabase/README.md`). The old address stays allowed either way.
2. Authentication → URL Configuration. Set Site URL to `https://thegatecast.com`. Under Redirect URLs, add `https://thegatecast.com/review.html`. Leave the `gatecast.vercel.app` entry there for now.

**Check:** on `https://thegatecast.com`, rate a story on the Weird-o-meter and reload: your rating is still there. Sign in at `https://thegatecast.com/review.html`: the link in the email comes back to the console.

## 3. Deploy the code change

The lead merges the change that moves every address in the code. Vercel deploys it by itself. If the redirect of step 4 is merged with it, steps 1 and 2 must be done first.

**Check**, on the live site:

- `https://thegatecast.com/sitemap.xml` lists only `https://thegatecast.com/...` addresses.
- `https://thegatecast.com/robots.txt` ends with `Sitemap: https://thegatecast.com/sitemap.xml`.
- `https://thegatecast.com/llms.txt` says "It lives at https://thegatecast.com".
- View the source of the front page: `<link rel="canonical" href="https://thegatecast.com/">`.

## 4. Redirect the old address (308)

Once steps 1 and 2 are done, `gatecast.vercel.app` should forward every page to the same page on `thegatecast.com`, for good. That is how search engines and old links learn about the move.

The redirect is in the code: the first block in the `redirects` list of `vercel.json`. It is in a commit of its own, after the one that moved the addresses, so the lead can merge it with step 3 or hold it back. It takes effect when that commit is deployed:

```json
{
  "source": "/:path((?!google[0-9a-f]+\\.html$|BingSiteAuth\\.xml$).*)",
  "has": [{ "type": "host", "value": "gatecast.vercel.app" }],
  "destination": "https://thegatecast.com/:path*",
  "permanent": true
}
```

It applies only to requests for `gatecast.vercel.app`, so preview deployments and the new address are untouched. It leaves Google's and Bing's ownership files alone, because Google will not follow a verification file to another domain (see step 5). To undo it, delete the block (or revert its commit) and deploy.

There is another way to do the same thing: in Vercel → Settings → Domains, open `gatecast.vercel.app` → Edit → "Redirect to" `thegatecast.com`, "308 Permanent Redirect". Use one or the other, not both. The dashboard redirect also forwards the ownership files.

**Check:** open `https://gatecast.vercel.app/stacks/skyjack/`. The address bar should end up at `https://thegatecast.com/stacks/skyjack/`.

## 5. Google Search Console

1. Add the new property. Either:
   - a Domain property for `thegatecast.com`: Google gives a TXT record; add it in Vercel → Domains → `thegatecast.com` → DNS Records. It covers www and non-www together; or
   - a URL-prefix property for `https://thegatecast.com/`, verified with Google's HTML file in `verify/` (`verify/README.md` has the steps).
2. Sitemaps → enter `https://thegatecast.com/sitemap.xml` → Submit.
3. URL inspection → Request indexing for `https://thegatecast.com/`, `https://thegatecast.com/stacks/worth-knowing/` and `https://thegatecast.com/stacks/content-notes/`.
4. Only if a property for `https://gatecast.vercel.app/` already exists: open that old property → Settings → Change of address → choose the new property. Google asks for the redirect from step 4 and for both properties to be verified. If the old one was verified with an HTML file, keep that file in `verify/`. If there is no old property, skip this: the site was three days old and had nothing in Google to carry over. The redirect does the work.

## 6. Bing Webmaster Tools

1. Add `https://thegatecast.com`. "Import from Google Search Console" is the quickest way once step 5 is done.
2. Sitemaps → submit `https://thegatecast.com/sitemap.xml`.

Bing has no change-of-address form to fill in; it follows the permanent redirect. ChatGPT search and Copilot read Bing's index, so this step matters for AI assistants too.

## 7. Tell IndexNow

After steps 1 and 3, from the repository:

```
node scripts/indexnow.cjs --dry-run
node scripts/indexnow.cjs
```

The first line prints what would be sent and sends nothing. The second sends every address in the sitemap to Bing and the other IndexNow search engines (Google does not take part).

**Check:** the script prints `200 OK` or `202 Accepted`. If it says the key file could not be found, open `https://thegatecast.com/6491d5a42c1dfff2839333d57a417b35.txt`: it should show the same 32 characters. It must be served by `thegatecast.com` itself, not after a redirect to www, which is why step 1 comes first.

## 8. Update the links elsewhere

- **Buttondown** (when the newsletter is turned on; `data/site.json` still has it off): the website address in the newsletter's settings, and any link to the site in the welcome email, the footer and the archive page.
- **Social profiles**: the website field and any pinned post.
- **GitHub**: the repository's "About" → Website field.
- Anywhere else the old address was typed by hand: email signatures, directory listings.

Old links keep working through the redirect, so nothing breaks while this is being done.

## 9. Update the launch drafts

The Show HN post, the Reddit posts and the six newsletter pitches are not in this repository. Replace `gatecast.vercel.app` with `thegatecast.com` in each. Keep writing "Gatecast, the weird-news site": a search for "Gatecast" alone still finds the Stargate podcast first. "The Gatecast" in the address helps a little, but it does not solve that.

## 10. What to watch for two weeks (until 2 Dec 2026)

| What | Where | What is normal | What needs action |
|---|---|---|---|
| The new addresses being indexed | Search Console → Pages, new property; a `site:thegatecast.com` search in Google and Bing once a week | The count of indexed pages rises over one to two weeks. Old addresses show as "Page with redirect" | "Duplicate, Google chose different canonical" naming a www address: step 1 was not done. No pages after a week: check the sitemap was submitted |
| 404s | Search Console → Pages → "Not found (404)"; Vercel → Logs, filtered to status 404 | A few requests for files that never existed | A 404 for a path that worked on the old address. No path changed in the move, so that points to a mistake in the redirect |
| The redirect | Open two or three old links by hand each week | Each lands on the same page at `thegatecast.com` | A link that lands on the front page, or on www |
| IndexNow | Bing Webmaster Tools → IndexNow | The submitted addresses are listed | Nothing listed: run step 7 again |
| Votes and tips | Rate a story on the live site | The rating is kept | An error: step 2 |
| Share previews | Paste a page's link into a post draft | The Gatecast picture appears | No picture: tell the lead |

Keep the redirect from `gatecast.vercel.app` for good. It costs nothing, and removing it breaks every old link.
