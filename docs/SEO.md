# Search and discovery

Updated 11 September 2026. Catanova is live at **https://catanova.io**. The owner has added it to Google Search Console; sitemap submission is still an account-side step. There is no paid SEO service or wiki subscription required.

## Submit the sitemap now

1. Open the existing **catanova.io** property in [Google Search Console](https://search.google.com/search-console).
2. Open **Sitemaps**, enter **https://catanova.io/sitemap.xml** under **Add a new sitemap**, and submit. If the field already prefixes the domain, enter only `sitemap.xml`.
3. Check that the sitemap reports **Success**. This confirms Google could read the file; it does not mean every page is indexed.
4. Use **URL inspection** for `https://catanova.io/` and `https://catanova.io/guide/`. Run the live test, check that fetching and indexing are allowed, and request indexing for these updated pages. Check the selected canonical URL after Google processes them.
5. In **Performance → Search results**, watch queries, impressions, clicks and click-through rate over time. Check **Page indexing** for concrete errors before changing copy again.

Do not upload an XML file to Google or submit room/invite links. The sitemap already lives on the server and is linked from `robots.txt`. Its two URLs are the public home and guide pages. No fabricated `lastmod`, priority or daily update claims are included. [Google sitemap submission](https://support.google.com/webmasters/answer/7451001), [URL inspection](https://support.google.com/webmasters/answer/9012289).

Also add or import the verified site in free [Bing Webmaster Tools](https://www.bing.com/webmasters/), submit that same sitemap, and inspect the two public URLs there. Submit changed public content; there is no reason to notify search engines about game turns. [Bing sitemap help](https://www.bing.com/webmasters/help/sitemaps-3b5cf6ed), [Bing URL inspection](https://www.bing.com/webmasters/help/url-inspection-55a30305).

These dashboard actions require the owner's authenticated accounts. Repository changes do not submit the property or prove indexing.

## Keep the brand first

The home title is **Catanova — Build. Trade. Settle.**, including the browser tab and social title. Its single-line visible description mentions a Catan alternative and the real two-to-four-player scope. The longer search description explains free browser play and private multiplayer rooms. There are no “number one,” popularity, rating or perfect-reliability claims.

The guide answers concrete questions about mixed phone/computer rooms, two-player rules, accounts, costs, trading and reconnecting. It explains that Catanova is independent and unofficial. This makes the mechanics discoverable without crowding the game menu or publishing thin keyword pages.

The homepage uses `WebSite` microdata with the name **Catanova** and its canonical URL. It matches the displayed branding and persists after the client loads. It is a site-name hint, not a rich-result or ranking promise. No invented organization, reviews, FAQ rich-result eligibility, app-store listing or third-party affiliation is declared. [Google site-name guidance](https://developers.google.com/search/docs/appearance/site-names).

## ChatGPT and other AI search

The same readable HTML is served to people and crawlers. Search engines can read the guide without JavaScript, cookies or signing in. Normal internal links and descriptive headings lead to the useful sections.

`robots.txt` allows public crawling, including **OAI-SearchBot**. OpenAI identifies this bot as its search crawler; **GPTBot** is a separate training control. Search inclusion does not require opting into training. This update preserves the existing crawler policy rather than changing a training preference. If a firewall or CDN is added, check that it does not block the search bot's published IP ranges or challenge public guide/image requests. A robots allowance cannot override a firewall. [Official OpenAI crawler documentation](https://developers.openai.com/api/docs/bots).

Google says ordinary SEO practices also apply to its AI search features and requires no special AI text file or schema. We are not adding an `llms.txt` file as a ranking tactic: useful, accessible HTML remains the source of truth. Neither technical eligibility nor a sitemap guarantees a Google result or ChatGPT citation. [Google AI search guidance](https://developers.google.com/search/docs/appearance/ai-features).

## Technical behavior to preserve

- The production build prerenders the actual homepage. The guide is a standalone HTML page with no game bundle.
- Each public page has its own title, description and canonical, plus Open Graph/large-card preview metadata. The code-composed, optimized 1200 × 630 social image at `/branding/social-card-v3.jpg` can be fetched without authentication. Its alt text is “Catanova — Build. Trade. Settle. Golden logo above a sunny island coast.”
- Room URLs, legacy `?room=` invitations, authentication callbacks, APIs and health checks retain `X-Robots-Tag: noindex, nofollow`. Search directives do not replace authentication.
- Unknown URLs return 404. `/guide` and alternate index paths redirect to their canonical addresses. Compression, cache validators and optimized art remain enabled.
- No cookies, usernames, saved-room identifiers or Supabase credentials are embedded into public HTML or the sitemap. Keep development/staging sites private or host-wide noindex.

Implementation: `apps/client/src/PublicPages.tsx`, `apps/client/src/EntryScreen.tsx`, `scripts/render-public-pages.ts` and `apps/server/src/static.ts`. Public-page tests check branding, rendered answers, metadata, icons and sitemap membership; HTTP tests check equal public responses for search user agents and private-route indexing headers.

After deployment, check the current preview image in an actual shared link. Discord, WhatsApp and other services may cache old metadata; a newly versioned image URL helps refresh the image once they recrawl the page. This does not force every service to refresh instantly. Keep full-size source artwork out of browser downloads.

For growth, publish useful rules examples, release notes and real gameplay clips, and link the guide where they answer a player's question. See [content channels](GROWTH.md) and the [free-wiki options](wiki/README.md). Avoid buying backlinks or mirroring identical encyclopedias just to target more queries. Search visibility should lead to a game friends can understand and finish.
