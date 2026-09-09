#!/usr/bin/env python3
"""Build or check the portable MediaWiki starter pack. Python standard library only."""

import argparse
import hashlib
import re
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "catanova-wiki.xml"
NAMESPACE = "http://www.mediawiki.org/xml/export-0.11/"
XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace"
XSI_NAMESPACE = "http://www.w3.org/2001/XMLSchema-instance"
TIMESTAMP = "2026-09-09T00:00:00Z"
PAGES = [
    ("Main_Page", "Main Page", 0),
    ("Getting_started", "Getting started", 0),
    ("Resources", "Resources", 0),
    ("Buildings", "Buildings", 0),
    ("Trading_and_ports", "Trading and ports", 0),
    ("Development_cards", "Development cards", 0),
    ("Awards", "Awards", 0),
    ("Map_generation", "Map generation", 0),
    ("Turn_timer", "Turn timer", 0),
    ("Accounts_and_friends", "Accounts and friends", 0),
    ("FAQ", "FAQ", 0),
    ("Category_Guides", "Category:Guides", 14),
    ("Category_Game_rules", "Category:Game rules", 14),
    ("Project_Copyrights", "Project:Copyrights", 4),
]


def element(parent, name, value=None, **attributes):
    child = ET.SubElement(parent, f"{{{NAMESPACE}}}{name}", attributes)
    if value is not None:
        child.text = str(value)
    return child


def sha1_base36(data):
    number = int.from_bytes(hashlib.sha1(data).digest(), "big")
    result = ""
    while number:
        number, remainder = divmod(number, 36)
        result = "0123456789abcdefghijklmnopqrstuvwxyz"[remainder] + result
    return result.rjust(31, "0")


def build():
    titles = {title for _, title, _ in PAGES}
    assert len(titles) == len(PAGES), "Duplicate article title"
    expected_files = {f"{filename}.wiki" for filename, _, _ in PAGES}
    actual_files = {path.name for path in (ROOT / "pages").glob("*.wiki")}
    assert actual_files == expected_files, "Update PAGES for missing or unlisted sources"

    ET.register_namespace("", NAMESPACE)
    ET.register_namespace("xsi", XSI_NAMESPACE)
    document = ET.Element(
        f"{{{NAMESPACE}}}mediawiki",
        {
            "version": "0.11",
            f"{{{XML_NAMESPACE}}}lang": "en",
            f"{{{XSI_NAMESPACE}}}schemaLocation": (
                f"{NAMESPACE} https://www.mediawiki.org/xml/export-0.11.xsd"
            ),
        },
    )
    site = element(document, "siteinfo")
    element(site, "sitename", "Catanova Wiki")
    element(site, "dbname", "catanova_wiki_starter")
    element(site, "base", "https://wiki.catanova.io/wiki/Main_Page")
    element(site, "generator", "Catanova original starter pack")
    element(site, "case", "first-letter")
    namespaces = element(site, "namespaces")
    for number, name in [(0, ""), (4, "Project"), (14, "Category")]:
        element(namespaces, "namespace", name, key=str(number), case="first-letter")

    link_count = 0
    for page_id, (filename, title, namespace_id) in enumerate(PAGES, 1):
        content = (ROOT / "pages" / f"{filename}.wiki").read_text(encoding="utf-8")
        assert content.endswith("\n"), f"Missing final newline: {filename}"
        for match in re.finditer(r"\[\[([^\[\]]+)\]\]", content):
            target = match.group(1).split("|", 1)[0].split("#", 1)[0]
            target = target.strip().lstrip(":").replace("_", " ") or title
            target = target[0].upper() + target[1:]
            assert target in titles, f"Unknown article in {title}: {target}"
            link_count += 1

        data = content.encode("utf-8")
        digest = sha1_base36(data)
        page = element(document, "page")
        element(page, "title", title)
        element(page, "ns", namespace_id)
        element(page, "id", page_id)
        revision = element(page, "revision")
        element(revision, "id", page_id)
        element(revision, "timestamp", TIMESTAMP)
        contributor = element(revision, "contributor")
        element(contributor, "username", "Catanova contributors")
        element(revision, "comment", "Original MIT-licensed starter text; see Project:Copyrights.")
        element(revision, "origin", page_id)
        element(revision, "model", "wikitext")
        element(revision, "format", "text/x-wiki")
        element(
            revision,
            "text",
            content,
            **{f"{{{XML_NAMESPACE}}}space": "preserve", "bytes": str(len(data)), "sha1": digest},
        )
        element(revision, "sha1", digest)

    ET.indent(document, space="  ")
    output = ET.tostring(document, encoding="utf-8", xml_declaration=True) + b"\n"
    restored = ET.fromstring(output)
    for node, (filename, _, _) in zip(restored.findall(f"{{{NAMESPACE}}}page"), PAGES):
        text = node.find(f"{{{NAMESPACE}}}revision/{{{NAMESPACE}}}text")
        original = (ROOT / "pages" / f"{filename}.wiki").read_text(encoding="utf-8")
        assert text is not None and text.text == original, "XML text round-trip failed"
    return output, link_count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate sources and compare the saved XML")
    args = parser.parse_args()
    output, links = build()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != output:
            raise SystemExit("XML is missing or stale. Run python3 docs/wiki/build_pack.py")
    else:
        OUTPUT.write_bytes(output)
    print(f"{'Checked' if args.check else 'Built'} {len(PAGES)} pages, {links} internal links, {len(output):,} XML bytes")


if __name__ == "__main__":
    main()
