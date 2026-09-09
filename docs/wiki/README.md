# Catanova wiki starter

Original player encyclopedia content for a future **wiki.catanova.io**. Nothing here creates a wiki, publishes articles, changes DNS, or connects game accounts to wiki accounts. The pack works without templates, extensions, custom CSS, or uploaded images.

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
