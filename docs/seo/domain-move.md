# Moving to thegatecast.com: what is done and what is left

18 Nov 2026. The site was at `https://gatecast.vercel.app`. Its address is now `https://www.thegatecast.com`. The pages and their paths are the same; only the host changed.

## Where things stand

| Question | Answer (read from Vercel on 18 Nov 2026) |
|---|---|
| Is `thegatecast.com` on the project? | Yes, verified. It redirects to `www.thegatecast.com` (308) |
| Is `www.thegatecast.com` on the project? | Yes, verified. It is the main address and serves the site |
| DNS and certificates | Correct. The domain was bought through Vercel and uses its nameservers |
| Does `gatecast.vercel.app` redirect to the new address? | Not yet. It still shows the site (step 1 below) |

The code names the www form everywhere (`lib/site.js`), because that is the address that answers. If you would rather the bare `thegatecast.com` were the main one, change it in Vercel (Settings → Domains: make `thegatecast.com` the production domain and redirect www to it), then say so and the one constant and the hand-written pages are changed together.

## Done in the code

- Every page's canonical link, share tags and structured data, the sitemap, `robots.txt`, `llms.txt`, the weekly pages and the feed name `https://www.thegatecast.com`.
- The two Supabase functions (`community`: votes, tips, book suggestions; `assist`: Draft with Claude) accept the new address, with and without www, and still accept the old one.

## Left for the owner, in order

### 1. Supabase sign-in address (5 minutes), then the redirect

The review page signs you in with a link by email, and Supabase only sends that link to addresses on its list.

1. Supabase → Authentication → URL Configuration.
2. Set **Site URL** to `https://www.thegatecast.com`.
3. Under **Redirect URLs**, add `https://www.thegatecast.com/review.html`. Leave the old one in place.
4. Check: open `https://www.thegatecast.com/review.html`, ask for a sign-in link, and confirm the link brings you back signed in.

When that works, say so. The permanent redirect from `gatecast.vercel.app` to the new address then goes into `vercel.json` (it is held back until now, because it would send the review page to an address Supabase does not yet accept):

```json
{
  "source": "/:path((?!google[0-9a-f]+\\.html$|BingSiteAuth\\.xml$).*)",
  "has": [{ "type": "host", "value": "gatecast.vercel.app" }],
  "destination": "https://www.thegatecast.com/:path*",
  "permanent": true
}
```

### 2. Google Search Console (15 minutes)

1. Add a property for the new address. A **Domain** property for `thegatecast.com` covers www and non-www: Google gives a TXT record; add it in Vercel → Domains → `thegatecast.com` → DNS Records.
2. Sitemaps → submit `https://www.thegatecast.com/sitemap.xml`.
3. URL inspection → request indexing for the front page, `/stacks/worth-knowing/` and `/stacks/content-notes/`.
4. Only if a property for the old address exists: after the redirect of step 1 is live, open the old property → Settings → Change of address.

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
| The redirect (once added) | Open two or three old links by hand each week | Each lands on the same page at the new address | A link that lands on the front page |

Keep the redirect from `gatecast.vercel.app` for good once it is in. Removing it breaks every old link.
