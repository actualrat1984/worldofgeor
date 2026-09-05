"""gallery index generator (Wave D3): character gallery from character files.

Reads:  <vault>/World/History/Characters/*.md (family:/house:, species:,
        home:, status:, type:, tags:)
Joins:  <repository>/public/wiki-index.json by title match
Writes: argv[1] or <repository>/dist/wiki/gallery-index.json
Stdlib only. Read-only on the vault. Prints counts. Never invents lore:
an entry exists ONLY for a real character file; every field comes from a
real frontmatter value (house/species/nation/status) or a real tag through
the documented SPECIES_TAGS map below; "(next life)" reincarnation notes
are membership-excluded, never houses (trees precedent). Files with no
resolvable wiki article keep name-only entries (cards render as text).
Portraits: the vault carries no resolvable portrait files for these pages
(3 bare image: filenames with no path), so the page uses initial-letter
avatars and links lore instead of images.
"""

import json
import pathlib
import os
import re
import sys

VAULT = pathlib.Path(os.environ.get("GEOR_LORE_VAULT", str(pathlib.Path(os.environ.get("GEOR_LORE_SITE", "C:/Users/pc/Documents/Lore/Lore/site")).parent)))
CHARACTERS = pathlib.Path("World/History/Characters")
WIKI_INDEX = pathlib.Path(__file__).resolve().parents[1] / "public/wiki-index.json"
DEFAULT_OUT = pathlib.Path(__file__).resolve().parents[1] / "dist/wiki/gallery-index.json"

FM_RE = re.compile(r"\A---\s*\n(.*?)\n---", re.S)
NEXT_LIFE_RE = re.compile(r"\(next life\)", re.I)

# Real tag -> gallery facet label. Tags are real vault fields; this map only
# normalizes them into display labels (webs-precedent: raw lines mapped to
# a controlled vocabulary). First hit in file tag order wins.
SPECIES_TAGS = {
    "human": "Human",
    "catmen": "Catmen",
    "dragon": "Dragon",
    "fallen-dragon": "Dragon",
    "demon": "Demon",
    "elf": "Elf",
    "orc": "Orc",
    "ogre": "Ogre",
    "goblin": "Goblin",
    "kobold": "Kobold",
    "snake": "Snake People",
    "serpent": "Snake People",
    "beastmen": "Beastmen",
    "wolvesfolk": "Wolvesfolk",
    "machine": "Machine",
    "homunculi": "Homunculi",
    "hybrian": "Hybrian",
    "deity": "Deity",
    "goddess": "Deity",
    "demigod": "Deity",
    "celestial": "Deity",
}

# species: scalar normalization (vault uses both spellings).
SPECIES_SCALAR = {"humans": "Human", "human": "Human", "ogres": "Ogre"}


def parse_frontmatter(text):
    m = FM_RE.match(text)
    if not m:
        return {}, []
    fm = m.group(1)
    scalars = {}
    for key in ("family", "house", "species", "home", "status", "type"):
        sm = re.search(r"^" + key + r"\s*:\s*(.+?)\s*$", fm, re.M)
        if sm:
            value = sm.group(1).strip().strip("'\"")
            if value and value != "[]":
                scalars[key] = value
    tags = []
    for tm in re.finditer(r"^tags\s*:\s*(.+?)\s*$", fm, re.M):
        inline = tm.group(1).strip()
        if inline.startswith("["):
            tags.extend(a.strip().strip("'\"") for a in inline.strip("[]").split(","))
    # list-style tags:
    #   tags:
    #   - character
    #   - human
    cur_tags = False
    for line in fm.splitlines():
        s = line.strip()
        if re.match(r"^tags\s*:\s*$", s):
            cur_tags = True
            continue
        if cur_tags:
            if s.startswith("-"):
                tags.append(s[1:].strip().strip("'\""))
            elif s:
                cur_tags = False
    tags = [t for t in tags if t]
    return scalars, tags


def main():
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    files = sorted((VAULT / CHARACTERS).glob("*.md"))
    try:
        wiki_index = json.loads(WIKI_INDEX.read_text(encoding="utf-8"))
    except OSError:
        wiki_index = []
    rows = wiki_index if isinstance(wiki_index, list) else wiki_index.get("pages", wiki_index.get("items", []))
    # Scope the join to character articles: stems must never resolve to a
    # nation, religion, or species page that happens to share a title.
    char_rows = [e for e in rows if isinstance(e, dict)
                 and isinstance(e.get("title"), str) and isinstance(e.get("url"), str)
                 and "/History/Characters/" in e["url"] and e["url"].startswith("/wiki/")]
    by_title, by_folded = {}, {}
    for entry in char_rows:
        title, url = entry["title"], entry["url"]
        by_title.setdefault(title, url)
        by_folded.setdefault(title.casefold(), url)
    # Wiki display titles carry emoji sigils ("The Highest") or
    # subtitles ("Cletas — God of Reason"). Fall back to sigil-stripped
    # and then subtitle-stripped matching so gallery cards still link out
    # (webs precedent). Anything still unresolved stays unlinked and
    # renders as text.
    by_stripped, by_prefix = {}, {}
    for entry in char_rows:
        title, url = entry["title"], entry["url"]
        bare = re.sub(r"^[^\w]+", "", title).strip().casefold()
        if bare:
            by_stripped.setdefault(bare, url)
            head = re.split(r"\s+[—–\-|]\s+|\s+\(", bare, maxsplit=1)[0].strip()
            if head:
                by_prefix.setdefault(head, url)

    entries = []
    houses, kinds, nations, historical = set(), set(), set(), 0
    for f in files:
        name = f.stem
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        scalars, tags = parse_frontmatter(text)
        entry = {"name": name}

        house = scalars.get("family") or scalars.get("house") or ""
        if NEXT_LIFE_RE.search(house):
            house = ""
        if house:
            entry["house"] = house
            houses.add(house)

        species = ""
        raw_species = scalars.get("species", "").strip()
        if raw_species:
            species = SPECIES_SCALAR.get(raw_species.casefold(), raw_species)
        if not species:
            for tag in tags:
                hit = SPECIES_TAGS.get(tag.casefold())
                if hit:
                    species = hit
                    break
        if not species and scalars.get("type", "").strip().casefold() == "deity":
            species = "Deity"
        if species:
            entry["species"] = species
            kinds.add(species)

        nation = scalars.get("home", "").strip()
        if nation:
            entry["nation"] = nation
            nations.add(nation)

        status = scalars.get("status", "").strip()
        if status:
            entry["status"] = status
            if status.casefold() == "historical":
                historical += 1

        stem = name.casefold()
        path = (by_title.get(name, by_folded.get(stem, ""))
                or by_stripped.get(stem, "") or by_prefix.get(stem, ""))
        if path:
            entry["path"] = path
        entries.append(entry)

    entries.sort(key=lambda e: e["name"].casefold())
    payload = {
        "source": "World/History/Characters/*.md + wiki-index.json title join",
        "files_scanned": len(files),
        "entries": entries,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    linked = sum(1 for e in entries if "path" in e)
    print(f"gallery {len(entries)} characters from {len(files)} files "
          f"[{len(houses)} houses, {len(kinds)} kinds, {len(nations)} nations, "
          f"{historical} historical, {linked} linked]")


if __name__ == "__main__":
    main()
