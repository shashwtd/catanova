# Search, previews and launch checks

Updated 9 September 2026. The owner has purchased **catanova.io**. These changes prepare the application for that address; they do not configure DNS, publish a server, submit a sitemap or guarantee search rankings.

## What is implemented

- **A readable entry page before JavaScript.** The production build renders the existing welcome component into HTML, including its real Create/Join choices, short description and guide/repository links. This is the same public UI, not a separate crawler-only page. React takes over when the game bundle loads. [Google's JavaScript guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics).
- **A public guide at `/guide/`.** Original, illustrated instructions cover the actual player count, room flow, building costs, turns, ports, cards, awards, accounts and recovery. It needs no JavaScript or authentication. It complements the deeper planned wiki; it is not a duplicate copy of every wiki article.
- **Distinct titles and descriptions**, absolute canonical URLs, Open Graph and large-card social metadata. The preview image is a 1200 × 630 JPEG made from approved Catanova art. No invented review scores, traffic statistics, prices or awards appear in metadata. [Open Graph reference](https://ogp.me/).
- **Site icons:** transparent 48/96 PNG favicons, a multi-size ICO, a 180-pixel Apple icon and 192/512 manifest icons. Stable URLs and square dimensions support browser/search identification; Google chooses whether and when to display an icon. The manifest does not add offline gameplay. [Google favicon guidance](https://developers.google.com/search/docs/appearance/favicon-in-search).
- **Sitemap and robots:** `/sitemap.xml` lists only `/` and `/guide/`. `robots.txt` lets crawlers fetch public assets and see the server's indexing directives. Invite routes, the legacy room query, auth callback, APIs and health checks receive `X-Robots-Tag: noindex, nofollow`. Room and callback pages use a separate empty app shell to preserve their own entry flow. Robots directives are not access control; auth remains required independently.
- **Real HTTP behavior:** unknown routes return 404, the guide's slash URL is canonical, and alternate index filenames redirect. Sitemap, manifest, fonts, icons and preview images have appropriate content types. The application's existing CSP remains in place.

The source lives in `apps/client/src/PublicPages.tsx`; `scripts/render-public-pages.ts` writes the public HTML/discovery files after Vite finishes. Branding is reproducible using `scripts/export-branding.mjs`, documented in [branding exports](BRANDING_EXPORTS.md). Committed source/assets are sufficient for the build; generated `dist/` stays ignored. Invite and auth indexing headers come from the Node server and must be preserved if the frontend is moved to a different host.

## What to do at public launch

1. Deploy the game at `https://catanova.io`, bind HTTPS and permanently redirect `www.catanova.io` to the apex. Preserve invitation paths and queries through the host-level redirect. Follow the [infrastructure plan](LAUNCH_INFRASTRUCTURE.md); changing metadata alone does not host the site.
2. Complete Supabase's account schema, public Site URL/OAuth redirect configuration, Google account linking and Turnstile hostname setup. Verify a real Google/guest round trip and an invite opened by another device. No staging or preview deployment should be indexed: add a host-wide `noindex` header there, or restrict access.
3. Add a **Domain property** for `catanova.io` in [Google Search Console](https://search.google.com/search-console/about). Verify with the exact DNS TXT record Google issues. Submit `https://catanova.io/sitemap.xml` and inspect the home and guide URLs. No verification token has been created or added by this change. [Verification instructions](https://support.google.com/webmasters/answer/9008080), [sitemap submission](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).
4. Optionally verify the domain in [Bing Webmaster Tools](https://www.bing.com/webmasters/) and submit the same sitemap. Use the actual account-provided records.
5. Check a real shared link in the services players use: Discord, WhatsApp, Messages and social platforms. They cache previews, sometimes for a long time. Confirm that they can fetch the public image without cookies or bot challenges. Use [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/) or [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) where applicable; this does not require publishing a promotional post.
6. Measure load time on a modest phone and mobile connection, layout shifts, image transfer size, readable controls and errors. Optimize the original large landing art if measurements show it delays the main content. Do not call a local test a production performance score.
7. Once the chosen **free** wiki is accepted and hosted, link it from the guide and in-game help and keep article titles/links stable. For a Miraheze custom domain, add its sitemap to the verified Search Console property. For Fandom, use only verification/indexing controls the host actually provides; owning `catanova.io` does not verify `catanova.fandom.com`. Do not publish duplicate full encyclopedias as an SEO experiment.

Search Console access, DNS, deployment, live social-preview checks and production performance measurements are still outstanding. Google decides indexing, title/snippet presentation and ranking; technical readiness is only one part of discovery. [SEO starter guidance](https://developers.google.com/search/docs/fundamentals/seo-starter-guide).

## Queries and useful pages

Use a few pages with clear purposes:

| Player intent                                      | Destination and useful content                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Catan alternative / Catan multiplayer with friends | Homepage: what Catanova is, actual player count, Create/Join, clear access choices         |
| How to play Catanova                               | `/guide/`: a complete first-game walkthrough, costs and links to deeper rules              |
| Catanova ports, development cards, Longest Road    | The relevant encyclopedia article, with examples and illustrations                         |
| Recover a disconnected Catanova game               | Troubleshooting guide reflecting tested recovery behavior and its limits                   |
| Compare Catanova with other games                  | A later, dated, fact-checked comparison, once the public service can be evaluated honestly |

Avoid keyword repetition, doorway pages, purchased backlinks and unverified superiority claims. An early release should describe its real scope and limitations. The [growth plan](GROWTH.md) contains 42 distribution routes and ten substantive article ideas; launch those after people can reliably finish games.

## Choosing a free wiki

**The wiki must be free; the provider choice remains pending.** Miraheze is the candidate for an owned `wiki.catanova.io` address and an ad-free reading experience, subject to its current acceptance/content policies. Fandom is a valid free alternative with familiar community tools, but its normal URL is on `fandom.com`, readers encounter its advertising model, and the wiki operates under Fandom's community rules. The [infrastructure plan](LAUNCH_INFRASTRUCTURE.md) records account prerequisites, unresolved eligibility checks and the fair tradeoffs. There is no paid wiki recommendation in the initial plan.

Fandom's network can be a discovery surface, but there is no evidence that a new Catanova community would automatically rank better there. Google describes page-level ranking systems alongside site-wide signals; a host's reputation does not guarantee a page a position. Fandom also recommends useful articles and normal SEO work. [Google ranking systems](https://developers.google.com/search/docs/appearance/ranking-systems-guide), [Fandom SEO guidance](https://community.fandom.com/wiki/Help:Search_Engine_Optimization)

An owned address is useful for branding and future portability; it is not a search-ranking promise. The prepared [MediaWiki content pack](wiki/README.md) is portable, but each host's content, licensing and generated-art/text rules must be checked before import. The existing `/guide/` can serve players while the free-wiki decision and acceptance are pending.
