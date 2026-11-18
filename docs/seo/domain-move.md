# Moving to thegatecast.com: what is done and what is left

18 Nov 2026. The site was at `https://gatecast.vercel.app`. Its address is now `https://www.thegatecast.com`. The pages and their paths are the same; only the host changed.

## Where things stand

| Question | Answer (read from Vercel on 18 Nov 2026) |
|---|---|
| Is `thegatecast.com` on the project? | Yes, verified. It redirects to `www.thegatecast.com` (308) |
| Is `www.thegatecast.com` on the project? | Yes, verified. It is the main address and serves the site |
| DNS and certificates | Correct. The domain was bought through Vercel and uses its nameservers |
| Does `gatecast.vercel.app` redirect to the new address? | Yes, since 18 Nov 2026 (`vercel.json`) |

The code names the www form everywhere (`lib/site.js`), because that is the address that answers. If you would rather the bare `thegatecast.com` were the main one, change it in Vercel (Settings → Domains: make `thegatecast.com` the production domain and redirect www to it), then say so and the one constant and the hand-written pages are changed together.

## Done in the code

- Every page's canonical link, share tags and structured data, the sitemap, `robots.txt`, `llms.txt`, the weekly pages and the feed name `https://www.thegatecast.com`.
- The two Supabase functions (`community`: votes, tips, book suggestions; `assist`: Draft with Claude) accept the new address, with and without www, and still accept the old one.

## Left for the owner, in order

### 1. Supabase sign-in address and the redirect: done (18 Nov 2026)

The owner set the Site URL to `https://www.thegatecast.com` and added `https://www.thegatecast.com/review.html` to the Redirect URLs in Supabase. The permanent redirect is now the first block of `redirects` in `vercel.json`: every address at `gatecast.vercel.app` forwards (308) to the same page at `https://www.thegatecast.com`, except a search engine's ownership file at the root, which Google will not follow to another domain. Preview deployments are not affected.

**Check:** open `https://gatecast.vercel.app/how.html`. The address bar should end at `https://www.thegatecast.com/how.html`. Then open the review page at the new address and sign in once.

### 2. Google Search Console (15 minutes)

1. Add a property for the new address. A **Domain** property for `thegatecast.com` covers www and non-www: Google gives a TXT record; add it in Vercel → Domains → `thegatecast.com` → DNS Records.
2. Sitemaps → submit `https://www.thegatecast.com/sitemap.xml`.
3. URL inspection → request indexing for the front page, `/stacks/worth-knowing/` and `/stacks/content-notes/`.
4. Only if a property for the old address exists: open the old property → Settings → Change of address (the redirect it asks for is live).

### 3. Bing Webmaster Tools (10 minutes)

Add `https://www.thegatecast.com`, verify (it can import from Search Console), and submit the same sitemap. ChatGPT search and Copilot read Bing's index.

### 4. IndexNow (1 minute)

Run `node scripts/indexnow.cjs`. It tells Bing and others about every page in the sitemap. It should print `200 OK` or `202 Accepted`.

### 5. Links elsewhere

Update the address in the launch drafts, in Buttondown once the newsletter exists, and in any social profile.

## What to watch for two weeks

| What | Where | Normal | Not normal |
|---|---|---|---|
| New addresses being indexed | Search Console → Pages; a `site:thegatecast.com` search once a week | The count rises over one to two weeks | No pages after two weeks |
| 404s | Search Console → Pages → Not found; Vercel → Logs, status 404 | A few requests for files that never existed | A 404 for a path that worked before. No path changed in the move |
| The redirect | Open two or three old links by hand each week | Each lands on the same page at the new address | A link that lands on the front page |

Keep the redirect from `gatecast.vercel.app` for good. Removing it breaks every old link.
