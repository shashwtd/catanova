# Catanova wiki starter

Original player encyclopedia content for a future **wiki.catanova.io**. Nothing here creates a wiki, publishes articles, changes DNS, or connects game accounts to wiki accounts. The pack works without templates, extensions, custom CSS, or uploaded images.

## Free hosting or free software?

Checked **9 September 2026**. No paid wiki subscription is proposed. The current choices are a free Fandom community, a self-hosted MediaWiki encyclopedia, or static branded documentation. They can complement one another, but they have different running costs and editing workflows.

| Approach                      | Editing and ownership                                                                                                                                             | Cost and maintenance                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Fandom**                    | Browser editing, revisions, categories and community discussion on a Fandom address. Community governance and platform rules apply.                               | No hosting subscription; Fandom operates the servers and displays advertising.                                        |
| **Self-hosted MediaWiki**     | A browser-editable encyclopedia on `wiki.catanova.io`, with our own branding, editor permissions and backups.                                                     | Free software; consumes Azure VM memory, CPU, disk and backup storage. We maintain it.                                |
| **Static branded guide/wiki** | Pages, navigation and search built from repository content. Contributions use Git reviews and a rebuild; no built-in wiki editor, accounts or discussion history. | Existing `/guide/` needs no extra service. A separate static site can use free static hosting within platform limits. |

**For an owned, editable encyclopedia, choose MediaWiki. For the first small 2–4-player playtest, keep the existing guide available and add Fandom if the owner wants its community tools; bringing up a second dynamic service is optional.** Player count alone does not size a public wiki: crawlers, image processing and edits also consume resources. Self-hosting can follow once the game VM has measured headroom. No VM or wiki is currently provisioned by this plan.

### Concrete self-hosted MediaWiki plan

Use the **1.43 LTS branch with its current security patch**; the download page lists 1.43.9 at this check. Pin the selected image/version and refresh it deliberately as patches arrive. MediaWiki is GPL free software and does not charge per reader, editor or game. [Supported releases and license](https://www.mediawiki.org/wiki/Download)

Run three separate workloads behind the VM's HTTPS reverse proxy: the existing Catanova Node service, a MediaWiki PHP/web container, and a private MariaDB container used only by the wiki. Route `wiki.catanova.io` to MediaWiki and keep the game's SQLite file and Supabase accounts separate. MariaDB is MediaWiki's recommended database family; SQLite is supported but is not the default recommendation for this public, illustrated encyclopedia. [Installation requirements](https://www.mediawiki.org/wiki/Manual:Installation_requirements)

The community-maintained **Docker Official Image** provides a practical starting point. Persist `/var/www/html/images`, `LocalSettings.php`, and the MariaDB data directory on the managed data disk. The image does not create these persistence mounts for us. Keep credentials and private configuration outside Git. This image is distinct from Wikimedia's **MediaWiki-Docker development environment**, which is not the production setup. [Image and persistence instructions](https://hub.docker.com/_/mediawiki), [development-environment scope](https://www.mediawiki.org/wiki/MediaWiki-Docker)

Start with the Vector skin and bundled VisualEditor, ordinary categories, tables and built-in search. VisualEditor supports editing without wikitext and still needs enabling/configuration. Avoid adding a separate search cluster or unrelated extensions for 14 starter pages. A logo and restrained CSS can make this recognizably Catanova without recreating Fandom's interface. [VisualEditor setup and skin support](https://www.mediawiki.org/wiki/Extension:VisualEditor)

Before public editing, finish HTTPS, an owner-controlled administrator account, account recovery email delivery, editor permissions and basic spam controls. Put resource limits on the wiki workloads and bound PHP concurrency so a burst of page requests cannot consume all game-server memory. Test a wiki edit and thumbnail generation while a game runs; a too-small VM should keep the static guide until it can support both. These are deployment recommendations, not measured capacity claims.

Back up the wiki database, uploads and private configuration off-host, and test restoration. An XML export preserves articles and revisions but does not replace the database/files backup. Update MediaWiki, its extensions, PHP and the OS; sharing one VM also shares its maintenance and outage window. [Backup scope](https://www.mediawiki.org/wiki/Manual:Backing_up_a_wiki)

**Budget:** software/subscription $0. If the already-planned VM has enough spare capacity, its fixed compute charge might stay unchanged; storage, backups, traffic or a VM resize can add cost. Azure credits can cover only eligible charges. Quote the combined deployment before provisioning rather than labeling self-hosting permanently free.

### If the branded site stays static

Keep the existing server-rendered `/guide/` for first-game help. To expand it into a static encyclopedia, add article routes, navigation and search, and render the reviewed content at build time. The `.wiki` files/XML are source material, not a ready-to-publish static site: a conversion/rendering step and link checks still need implementation. Publishing this directory alone will not create a usable wiki.

A standalone build could use Cloudflare Workers Static Assets without a dynamic Worker. Static asset requests and storage currently have no hosting charge; Worker execution and other services have separate limits/billing. This would keep wiki reading off the game VM, but it would not add browser editing. [Static hosting billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)

### Keeping Fandom and the branded site useful

Both are possible. Give each a clear editorial purpose rather than automatically mirroring every article:

- **Catanova guide/branded wiki:** release-checked mechanics, interface reference, account help, troubleshooting and changes to implemented rules.
- **Fandom community:** useful standalone game introductions, worked strategy examples, opening-placement discussions, illustrated match situations and community discoveries. Contributors remain free to develop the encyclopedia within Fandom's rules; it must not be merely an advertisement or a collection of redirects. [Fandom community policy](https://www.fandom.com/community-creation-policy)

Link between relevant articles where this helps a reader. A ports reference can explain the implemented exchange rules; a community strategy page can compare when each port is useful. Keep shared factual summaries accurate, respect attribution and the license of any later community edits, and do not repeatedly import this starter over those edits. The source pack is portable; that does not make two live editing databases automatically synchronized.

Ordinary content overlap does **not** imply an automatic search penalty. Google may select one representative URL for substantially duplicate pages, and a declared canonical URL is only a hint. Maintaining two identical encyclopedias adds editorial work without ensuring two search results. Prefer distinct useful coverage; do not assume Fandom lets us configure cross-domain canonical tags. [Google's canonicalization guidance](https://developers.google.com/search/docs/crawling-indexing/canonicalization)

## Contents

- `pages/*.wiki`: editable MediaWiki source for 11 articles, two category pages, and `Project:Copyrights`.
- `catanova-wiki.xml`: the same 14 pages in MediaWiki export format 0.11, with one starter revision each.
- `build_pack.py`: regenerates the XML and checks every internal article/category link, source coverage, and exact text round-trip.

Articles cover getting started, resources, buildings, trades and ports, development cards, awards, balanced maps, the timer, accounts and friends, and common questions. Tables, categories, and ordinary links provide an encyclopedia structure that can be themed later. `Main Page` is the entry point.

The text describes repository behavior as reviewed on **9 September 2026**. It identifies the custom two-player option, custom map preset, optional timer, and provisional rare-card cases. It makes no claim that a public game server is already deployed. The complete [rulebook](https://github.com/shashwtd/catanova/blob/main/docs/RULEBOOK.md) remains the detailed specification.

## Import into MediaWiki

1. Use a fresh wiki or review existing pages with the same titles first. Importing can merge histories; this is a starter pack, not a mechanism for overwriting later community edits.
2. Sign in with an administrator account that has both `import` and `importupload`. Open **Special:Import**, select the XML upload option, and upload `catanova-wiki.xml`. A managed host may need to grant these rights or perform the import.
3. If asked for a source/interwiki prefix, use a distinct source label such as `catanova-starter` as supported by the host. Keep imported attribution separate from local users; `Catanova contributors` is this pack's collective attribution label, not an account to create or impersonate.
4. Keep the source namespaces: article pages in main, copyright notice in Project, categories in Category. Import and verify the result reports 14 pages. Open `Main Page`, follow its links, and check the tables on a phone.

The pack contains no real user IDs, email addresses, credentials, files, or user account history. Its page/revision numbers are identifiers within this generated package. The fixed timestamp records the starter edition, not edits on an existing public wiki. XML content imports do not upload image files or configure the site. [MediaWiki import manual](https://www.mediawiki.org/wiki/Manual:Importing_XML_dumps)

For Fandom or another managed service, ask its administrator to use the supported import route. If file imports are unavailable, create the 14 titles from `PAGES` in `build_pack.py` and paste their `.wiki` source using the source editor. That fallback does not depend on import permissions. The pack does not assume Fandom supports the custom domain or a particular skin.

## Logo, navigation, and editing

Upload the existing [Catanova full logo](../../apps/client/public/art/branding/catanova-logo-v2.png) separately, under a clear filename such as `Catanova-logo.png`. Use the host's supported logo/theme settings; self-hosted MediaWiki exposes the logo through its [logo configuration](https://www.mediawiki.org/wiki/Manual:$wgLogos). Keep the existing [art provenance](../art/logo-concepts/provenance-v2.json) with any distribution of the asset. The XML intentionally has no missing image links.

Use a readable encyclopedia skin, the Catanova logo, warm paper surfaces, restrained teal links, and the existing resource colors. Keep article text on a quiet background. No game login, OAuth secret, or Supabase key belongs in the wiki theme. Set the site's project/copyright link to the imported `Project:Copyrights` page as appropriate to its contribution license.

For navigation, add links to Main Page, Getting started, Resources, Buildings, Trading and ports, Development cards, and FAQ using the host's navigation editor. On a standard MediaWiki sidebar, this block can be merged into **MediaWiki:Sidebar**; keep any existing tools and search sections. [Sidebar customization](https://www.mediawiki.org/wiki/Manual:Interface/Sidebar)

```text
* Explore Catanova
** Main Page|Home
** Getting started|Getting started
** Resources|Resources
** Buildings|Buildings
** Trading and ports|Trading and ports
** Development cards|Development cards
** FAQ|FAQ
```

Enable the host's visual editor if available so contributors can edit articles without learning wikitext. Later pages can add strategy examples, illustrated board situations, and patch notes. Keep speculative strategy distinct from confirmed rules; do not import third-party articles or official game artwork as filler.

## Update and validate

Edit the `.wiki` sources, then run from the repository root:

```sh
python3 docs/wiki/build_pack.py
python3 docs/wiki/build_pack.py --check
```

The first command writes only `catanova-wiki.xml`; neither command contacts a server. Titles use spaces inside the XML. The explicit page list maps portable filenames such as `Category_Game_rules.wiki` to their actual namespace titles. New articles must be added there before regeneration.

The package follows the official [MediaWiki 0.11 export schema](https://www.mediawiki.org/xml/export-0.11.xsd). The local check verifies deterministic output and internal links, not a live import or skin rendering. After a wiki has real edits, update its articles through normal review rather than repeatedly reimporting this starter history.

## Sources and reuse

The starter prose is original documentation based on the repository's [rulebook](../RULEBOOK.md), [playtest notes](../PLAYTEST.md), [map generator](../MAP_GENERATION.md), [turn clock](../TURN_CLOCK.md), [guest access](../GUEST_ACCESS.md), and account/profile implementation. The in-article external links point to the public repository so they remain usable outside this checkout.

The repository [MIT license](../../LICENSE) permits reuse of this text with its notice retained; the complete notice is included in `Project:Copyrights`. No official CATAN assets or third-party wiki passages are included. A hosted wiki's terms and selected license for future contributions still apply. Importing this starter does not silently change the license for later community edits.
