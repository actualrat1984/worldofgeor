"""trees index generator (Wave D1): family trees from World/History files.

Reads:  <vault>/World/History/Characters/**/*.md (family: frontmatter = membership)
        <vault>/World/History/Families/*.md + Dynasties/*.md (house names,
        household father/mother links, children lists)
Joins:  C:/Users/pc/Documents/worldofgeor/public/wiki-index.json by title match
Writes: argv[1] or C:/Users/pc/Documents/worldofgeor/dist/wiki/trees-index.json
Stdlib only. Read-only on the vault. Prints counts. Never invents lore:
houses come from real Families/Dynasties files and real family: values
("(next life)" reincarnation notes are membership-excluded, never members);
parents/spouse come ONLY from real [[links]] in file bodies (household
father/mother/children lines, wife/husband lines, son/daughter/child-of
and father/mother-of phrasing). Unresolvable or absent links are omitted.
"""
import json
import pathlib
import re
import sys

VAULT = pathlib.Path(r"C:/Users/pc/Documents/Lore/Lore")
CHARACTERS = pathlib.Path("World/History/Characters")
FAMILIES = pathlib.Path("World/History/Families")
DYNASTIES = pathlib.Path("World/History/Dynasties")
WIKI_INDEX = pathlib.Path(r"C:/Users/pc/Documents/worldofgeor/public/wiki-index.json")
DEFAULT_OUT = pathlib.Path(r"C:/Users/pc/Documents/worldofgeor/dist/wiki/trees-index.json")

LINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")
FM_RE = re.compile(r"\A---\s*\n(.*?)\n---", re.S)
NEXT_LIFE_RE = re.compile(r"\(next life\)", re.I)


def parse_frontmatter(text):
    m = FM_RE.match(text)
    if not m:
        return {}, [], ""
    fm, body = m.group(1), text[m.end():]
    scalars = {}
    for key in ("family", "house"):
        sm = re.search(r"^" + key + r"\s*:\s*(.+?)\s*$", fm, re.M)
        if sm:
            value = sm.group(1).strip().strip("'\"")
            if value and value != "[]":
                scalars[key] = value
    aliases = []
    am = re.search(r"^aliases\s*:\s*(.+?)\s*$", fm, re.M)
    if am:
        aliases = [a.strip().strip("'\"[]") for a in re.split(r",", am.group(1))]
        aliases = [a for a in aliases if a]
    return scalars, aliases, body


def link_targets(text):
    return [(m.group(1).strip(), (m.group(2) or m.group(1)).strip())
            for m in LINK_RE.finditer(text)]


def main():
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    chars = sorted((VAULT / CHARACTERS).rglob("*.md"))
    try:
        wiki_index = json.loads(WIKI_INDEX.read_text(encoding="utf-8"))
    except OSError:
        wiki_index = []
    rows = wiki_index if isinstance(wiki_index, list) else wiki_index.get("pages", wiki_index.get("items", []))
    by_title, by_folded = {}, {}
    for entry in rows:
        if not isinstance(entry, dict):
            continue
        title, url = entry.get("title"), entry.get("url")
        if not isinstance(title, str) or not isinstance(url, str):
            continue
        by_title.setdefault(title, url)
        by_folded.setdefault(title.casefold(), url)

    people = {}
    for f in chars:
        if f.name == "index.md":
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        scalars, aliases, body = parse_frontmatter(text)
        people[f.stem] = {"file": f, "family": scalars.get("family") or scalars.get("house") or "",
                          "aliases": aliases, "body": body}

    def resolve(label, house_members=None):
        label = label.strip()
        if label in people:
            return label
        folded = label.casefold()
        for name in people:
            if name.casefold() == folded:
                return name
        for name, info in people.items():
            if any(a.casefold() == folded for a in info["aliases"]):
                return name
        first = folded.split()[0] if folded.split() else ""
        if first:
            pool = house_members if house_members is not None else list(people)
            hits = [n for n in pool if n.casefold().split()[0] == first]
            if len(hits) == 1:
                return hits[0]
        return None

    # House names: real Families/Dynasties files + real family: values.
    houses = {}
    for folder in (FAMILIES, DYNASTIES):
        root = VAULT / folder
        if root.is_dir():
            for f in sorted(root.glob("*.md")):
                if f.name != "index.md":
                    houses.setdefault(f.stem, {"file": f, "members": []})
    for name, info in people.items():
        fam = info["family"].strip()
        if fam and not NEXT_LIFE_RE.search(fam):
            houses.setdefault(fam, {"file": None, "members": []})
    # Membership: exact family: value, or surname == house for dynasty houses.
    for name, info in people.items():
        fam = info["family"].strip()
        if fam and not NEXT_LIFE_RE.search(fam) and fam in houses:
            houses[fam]["members"].append(name)
            continue
        surname = name.split()[-1] if name.split() else ""
        if surname in houses and (VAULT / DYNASTIES / (surname + ".md")).exists():
            houses[surname]["members"].append(name)

    parents = {name: [] for name in people}
    spouses = {name: [] for name in people}

    def add_parent(child, parent):
        if parent and parent != child and parent not in parents[child]:
            parents[child].append(parent)

    def add_spouse(a, b):
        if a and b and a != b:
            if b not in spouses[a]:
                spouses[a].append(b)
            if a not in spouses[b]:
                spouses[b].append(a)

    # House files: household father/mother links + children lists.
    for house, info in houses.items():
        members = info["members"]
        if info["file"] is None:
            continue
        try:
            text = info["file"].read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        _, _, body = parse_frontmatter(text)
        fathers, mothers, children = [], [], []
        role_pat = re.compile(r"(?:^|[*_`\s-])(?:\S+\s+)?(father|mother)\s*[\u2014\u2013-]", re.I)
        for line in body.splitlines():
            low = line.lower()
            role = role_pat.search(line)
            if role:
                for target, _ in link_targets(line):
                    person = resolve(target)
                    if person is None:
                        continue
                    if role.group(1).lower() == "father" and person not in fathers:
                        fathers.append(person)
                    elif role.group(1).lower() == "mother" and person not in mothers:
                        mothers.append(person)
                continue
            if "children" in low or "child:" in low:
                for target, _ in link_targets(line):
                    person = resolve(target)
                    if person is not None and person not in children:
                        children.append(person)
        for child in children:
            for p in fathers + mothers:
                add_parent(child, p)

    # Character bodies: spouse + parent phrasing with real [[links]].
    spouse_pat = re.compile(
        r"(?<![\w-])(?:first|second|third)?\s*(?:wife|husband)\b\s*[:\u2014\u2013-]\s*[*_]*(\[\[[^\]]+\]\])"
        r"|(?<![\w-])(?:first|second|third)?\s*(?:wife|husband)\s+of\s+[*_]*(\[\[[^\]]+\]\])", re.I)
    childof_pat = re.compile(
        r"(?:son|daughter|child)[^.{}]*?\sof\s+[*_]*((?:[*_]*\[\[[^\]]+\]\][,*\s]*(?:and\s*)?)+)", re.I)
    parentof_pat = re.compile(
        r"(?:father|mother)[^.{}]*?\sof\s+[*_]*((?:[*_]*\[\[[^\]]+\]\][,*\s]*(?:and\s*)?)+)", re.I)

    def linked_names(fragment):
        return [t for t, _ in link_targets(fragment)]

    for name, info in people.items():
        body = info["body"]
        for m in spouse_pat.finditer(body):
            frag = m.group(1) or m.group(2) or ""
            for target in linked_names(frag):
                other = resolve(target)
                if other:
                    add_spouse(name, other)
        for m in childof_pat.finditer(body):
            got = [resolve(t) for t in linked_names(m.group(1))]
            for p in got[:2]:
                if p:
                    add_parent(name, p)
        for m in parentof_pat.finditer(body):
            # "not the biological mother/father of ..." denies kinship — skip.
            if re.search(r"\bnot\b", body[max(0, m.start() - 30):m.start()], re.I):
                continue
            for target in linked_names(m.group(1)):
                child = resolve(target)
                if child:
                    add_parent(child, name)
    # Twins share parents (only fills gaps, never overwrites).
    twin_pat = re.compile(r"twin\s+(?:sister|brother)\s+of\s+(\[\[[^\]]+\]\])", re.I)
    for name, info in people.items():
        if parents[name]:
            continue
        m = twin_pat.search(info["body"])
        if m:
            sib = resolve(linked_names(m.group(1))[0]) if linked_names(m.group(1)) else None
            if sib and parents.get(sib):
                parents[name] = list(parents[sib])

    payload_houses = []
    for house in sorted(houses, key=str.casefold):
        members = sorted(set(houses[house]["members"]), key=str.casefold)
        if not members:
            continue
        entries = []
        for name in members:
            url = by_title.get(name, by_folded.get(name.casefold(), ""))
            entry = {"name": name, "path": url,
                     "parents": [p for p in parents[name] if p in people]}
            sp = [s for s in spouses[name] if s in people]
            # Singular spouse?: emit only when the vault names exactly one.
            if len(sp) == 1:
                entry["spouse"] = sp[0]
            entries.append(entry)
        payload_houses.append({"house": house, "members": entries})

    payload = {
        "source": (CHARACTERS.as_posix() + "/**/*.md + Families/*.md + Dynasties/*.md + wiki-index.json title join"),
        "files_scanned": len(chars),
        "houses": payload_houses,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    counts = ", ".join(f"{h['house']} ({len(h['members'])})" for h in payload_houses)
    print(f"trees {sum(len(h['members']) for h in payload_houses)} members "
          f"in {len(payload_houses)} houses [{counts}] from {len(chars)} files")


if __name__ == "__main__":
    main()
