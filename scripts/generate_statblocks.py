"""statblocks index generator (Wave F5): system statblocks from wiki data.

Reads (read-only on the vault):
  World/Systems/Magic Ranks.md ......... 7 ordered ranks (template magic-ranks)
  World/Systems/Magic.md ............... shared doctrine rows (ceiling, schools)
  World/Systems/Mage-Cells.md .......... shared source row (related)
  World/Species/index.md ............... Major Species + Direct Entries scope
                                         (template species-traits)
  World/Species/<Entry>.md ............. Lifespan / Mage-cell expression / Traits /
                                         Appearance / Governance / Nations rows;
                                         files without stat rows keep thin
                                         name-only entries (never invented)
  World/Economy, Demographics, Stats/Currencies/index.md .. 25-row table
                                         (template currencies: Symbol/Region/Status)
Joins:  C:/Users/pc/Documents/worldofgeor/public/wiki-index.json by title match
        (species join scoped to /Species/ urls, currencies to currency urls)
Writes: argv[1] or C:/Users/pc/Documents/worldofgeor/dist/wiki/statblocks-index.json
Stdlib only. Read-only on the vault. Prints counts. Never invents lore:
an entry exists ONLY for a real vault row/file; every trait value is a
real vault string (markup-stripped, length-capped). Files or rows with no
resolvable wiki article keep path "" (cards render as plain text).
"""
import json
import pathlib
import re
import sys

VAULT = pathlib.Path(r"C:/Users/pc/Documents/Lore/Lore")
MAGIC_RANKS = pathlib.Path("World/Systems/Magic Ranks.md")
MAGIC = pathlib.Path("World/Systems/Magic.md")
MAGE_CELLS = pathlib.Path("World/Systems/Mage-Cells.md")
SPECIES_INDEX = pathlib.Path("World/Species/index.md")
SPECIES_DIR = pathlib.Path("World/Species")
CURRENCIES_INDEX = pathlib.Path("World/Economy, Demographics, Stats/Currencies/index.md")
WIKI_INDEX = pathlib.Path(r"C:/Users/pc/Documents/worldofgeor/public/wiki-index.json")
DEFAULT_OUT = pathlib.Path(r"C:/Users/pc/Documents/worldofgeor/dist/wiki/statblocks-index.json")

TEMPLATES = [
    {"id": "magic-ranks", "title": "Magic Ranks"},
    {"id": "species-traits", "title": "Species Traits"},
    {"id": "currencies", "title": "Currencies"},
]

RANK_RE = re.compile(r"^\s*\d+\.\s+\*\*(.+?)\*\*\s*$", re.M)
BULLET_RE = re.compile(r"^- \*\*(.+?):\*\*\s*(.+?)\s*$", re.M)
TABLE_ROW_RE = re.compile(r"^\|\s*\[\[([^|\]]+)(?:\|[^]]+)?\]\]\s*\|\s*`([^`\n]+)`\s*\|\s*([^|\n]+?)\s*(?:\|\s*([^|\n]+?)\s*)?\|?\s*$", re.M)
LINK_RE = re.compile(r"\[\[([^|\]]+)\|([^]]+)\]\]|\[\[([^]]+)\]\]")


def clean(value, limit=240):
    text = LINK_RE.sub(lambda m: m.group(2) if m.group(2) is not None else m.group(3), value or "")
    text = re.sub(r"[*_`>]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > limit:
        cut = text[:limit].rsplit(" ", 1)[0] or text[:limit]
        text = cut.rstrip(" ,;-") + "…"
    return text


def norm_title(title):
    text = re.sub(r"^[^\w]+", "", title or "")
    return re.split(r"\s+[—–-]\s+", text, 1)[0].strip()


def load_join():
    try:
        wiki_index = json.loads(WIKI_INDEX.read_text(encoding="utf-8"))
    except OSError:
        wiki_index = []
    rows = wiki_index if isinstance(wiki_index, list) else wiki_index.get("pages", wiki_index.get("items", []))
    scoped = {}
    for entry in rows:
        if not isinstance(entry, dict):
            continue
        title, url = entry.get("title"), entry.get("url")
        if not isinstance(title, str) or not isinstance(url, str):
            continue
        if not url.startswith("/wiki/"):
            continue
        for key in {title, title.casefold(), norm_title(title), norm_title(title).casefold()}:
            scoped.setdefault(key, []).append(url)
    return scoped


def pick(urls, needle):
    if not urls:
        return ""
    if not needle:
        return urls[0]
    for url in urls:
        if needle in url:
            return url
    return ""


def lookup(scoped, name, needle):
    for key in (name, name.casefold(), norm_title(name), norm_title(name).casefold()):
        if key in scoped:
            return pick(scoped[key], needle)
    return ""


def magic_ranks(scoped):
    text = (VAULT / MAGIC_RANKS).read_text(encoding="utf-8", errors="ignore")
    names = [n.strip() for n in RANK_RE.findall(text)]
    magic = (VAULT / MAGIC).read_text(encoding="utf-8", errors="ignore")
    ceiling = ""
    m = re.search(r"^The ceiling of a mage's power is determined by bloodline purity and training\.", magic, re.M)
    if m:
        ceiling = m.group(0)
    melded = ""
    m = re.search(r"^- \*\*Melded magic\*\* — (.+?)\s*$", text, re.M)
    if m:
        melded = "Melded magic — " + m.group(1).strip()
    ranks_url = lookup(scoped, "Magic Ranks", "/Systems/")
    entries = []
    total = len(names)
    for i, name in enumerate(names, 1):
        traits = [{"label": "Tier", "value": f"{i} of {total}"}]
        if i == 1:
            traits.append({"label": "Standing", "value": "Lowest tier"})
        elif i == total:
            traits.append({"label": "Standing", "value": "Highest tier"})
        if ceiling:
            traits.append({"label": "Ceiling", "value": clean(ceiling)})
        if melded:
            traits.append({"label": "Melded magic", "value": clean(melded)})
        entries.append({"template": "magic-ranks", "name": name, "path": ranks_url, "traits": traits})
    return entries, 1 if names else 0


def species_traits(scoped):
    index_text = (VAULT / SPECIES_INDEX).read_text(encoding="utf-8", errors="ignore")
    names = []
    for header in ("## Major Species", "## Direct Entries"):
        start = index_text.find(header)
        if start < 0:
            continue
        section = index_text[start:]
        end = section.find("\n## ", 1)
        body = section[:end] if end >= 0 else section
        names += re.findall(r"\[\[([^|\]]+)(?:\|[^]]+)?\]\]", body)
    # Every link target must resolve to a real vault file: stem map over
    # the Species subtree (Fauna/Flora hubs excluded). Unresolvable names
    # (people, orders, demons-without-pages) are skipped, never invented.
    stem_map = {}
    for f in sorted((VAULT / SPECIES_DIR).rglob("*.md")):
        rel = f.relative_to(VAULT / SPECIES_DIR)
        if rel.name == "index.md" or "Fauna" in rel.parts or "Flora" in rel.parts:
            continue
        stem_map.setdefault(f.stem, f)
        stem_map.setdefault(f.stem.casefold(), f)
    rows = (("Lifespan", "Lifespan"), ("Mage-cell expression", "Magic"),
            ("Traits", "Traits"), ("Appearance", "Build"),
            ("Governance", "Rule"), ("Nations", "Nations"))
    entries, scanned, seen = [], 0, set()
    for name in names:
        target = stem_map.get(name, stem_map.get(name.casefold()))
        if target is None or target in seen:
            continue
        seen.add(target)
        scanned += 1
        try:
            text = target.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        found = {}
        for key, value in BULLET_RE.findall(text):
            found.setdefault(key.strip(), value.strip())
        traits = []
        for source_key, label in rows:
            if found.get(source_key):
                traits.append({"label": label, "value": clean(found[source_key])})
        entries.append({"template": "species-traits", "name": target.stem,
                        "path": lookup(scoped, target.stem, "/Species/"), "traits": traits})
    entries.sort(key=lambda e: e["name"].casefold())
    return entries, scanned


def currencies(scoped):
    text = (VAULT / CURRENCIES_INDEX).read_text(encoding="utf-8", errors="ignore")
    entries = []
    for name, symbol, region, status in TABLE_ROW_RE.findall(text):
        traits = [{"label": "Symbol", "value": clean(symbol, 24)},
                  {"label": "Region", "value": clean(region)}]
        if (status or "").strip() and "---" not in status:
            traits.append({"label": "Status", "value": clean(status)})
        entries.append({"template": "currencies", "name": clean(name, 60),
                        "path": lookup(scoped, clean(name, 60), "urrenc"), "traits": traits})
    return entries


def main():
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    scoped = load_join()
    ranks, rank_files = magic_ranks(scoped)
    species, species_files = species_traits(scoped)
    coins = currencies(scoped)
    entries = ranks + species + coins
    counts = {t["id"]: sum(1 for e in entries if e["template"] == t["id"]) for t in TEMPLATES}
    payload = {
        "source": "Magic Ranks.md + Species/index.md Direct Entries + Currencies/index.md + wiki-index.json title join",
        "files_scanned": rank_files + species_files + 1,
        "templates": [{**t, "entries": counts[t["id"]]} for t in TEMPLATES],
        "entries": entries,
    }
    with_url = sum(1 for e in entries if e["path"])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    json.loads(out.read_text(encoding="utf-8"))
    print(f"statblocks {len(entries)} entries across {len(TEMPLATES)} templates "
          f"({with_url} with wiki URLs: ranks={counts['magic-ranks']}, "
          f"species={counts['species-traits']}, currencies={counts['currencies']})")


if __name__ == "__main__":
    main()
