"""webs index generator (Wave D2): diplomacy webs from nation files + war files.

Reads:  <vault>/World/Nations/**/*.md (infobox relation lines, Rival/Enemy/
        Hostile sections, civil-war / invaded / conquered phrasing)
        <vault>/World/History/Events/**/*.md (Combatants/Parties/Against/
        Invader/Conquered/Hostile Connections lines)
Joins:  C:/Users/pc/Documents/worldofgeor/public/wiki-index.json by title match
Writes: argv[1] or C:/Users/pc/Documents/worldofgeor/dist/wiki/webs-index.json
Stdlib only. Read-only on the vault. Prints counts. Never invents lore:
an edge exists ONLY when a real line names real nation files on both
sides (link targets must casefold-match a nation stem; unlinked or
non-nation targets such as The Hive / Erisian church / Lima are dropped).
States: allied (Ally/Allies/Partner/Parties/aid-alliance), tense (Rival/
Hostile/Against), war (Enemy/Combatants/Invader+Conquered/civil-war/
invaded/Conquered-By). Severity wins on conflict: war > tense > allied.
"""
import json
import pathlib
import re
import sys

VAULT = pathlib.Path(r"C:/Users/pc/Documents/Lore/Lore")
NATIONS = pathlib.Path("World/Nations")
EVENTS = pathlib.Path("World/History/Events")
WIKI_INDEX = pathlib.Path(r"C:/Users/pc/Documents/worldofgeor/public/wiki-index.json")
DEFAULT_OUT = pathlib.Path(r"C:/Users/pc/Documents/worldofgeor/dist/wiki/webs-index.json")

LINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]")
FM_RE = re.compile(r"\A---\s*\n(.*?)\n---", re.S)

SEVERITY = {"allied": 1, "tense": 2, "war": 3}


def link_targets(text):
    return [m.group(1).strip() for m in LINK_RE.finditer(text)]


def sentences(text):
    return re.split(r"(?<=[.!?])\s+|\n+", text)


def main():
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    nation_files = sorted((VAULT / NATIONS).rglob("*.md"))
    event_files = sorted((VAULT / EVENTS).rglob("*.md")) if (VAULT / EVENTS).is_dir() else []
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
    # Wiki display titles carry emoji sigils ("⚔️ The Taberis War"). Fall
    # back to sigil-stripped matching so evidence cards still link out.
    by_stripped = {}
    for entry in rows:
        if not isinstance(entry, dict):
            continue
        title, url = entry.get("title"), entry.get("url")
        if not isinstance(title, str) or not isinstance(url, str):
            continue
        bare = re.sub(r"^[^\w]+", "", title).strip().casefold()
        if bare:
            by_stripped.setdefault(bare, url)

    nations = {}
    for f in nation_files:
        if f.name == "index.md":
            continue
        nations[f.stem] = f
    folded = {name.casefold(): name for name in nations}

    def resolve(label):
        label = label.strip()
        if label in nations:
            return label
        hit = folded.get(label.casefold())
        if hit:
            return hit
        return None

    def evidence_url(stem):
        return (by_title.get(stem, by_folded.get(stem.casefold(), ""))
                or by_stripped.get(stem.casefold(), ""))

    # (a, b) sorted key -> (state, why, evidence_stem)
    edges = {}

    def add(a, b, state, why, ev_stem):
        if not a or not b or a == b:
            return
        if a not in nations or b not in nations:
            return
        key = tuple(sorted((a, b)))
        prev = edges.get(key)
        if prev is None or SEVERITY[state] > SEVERITY[prev[0]]:
            edges[key] = (state, why, ev_stem)

    # --- Nation files: self is one side of every edge. ---
    for stem, f in sorted(nations.items()):
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        m = FM_RE.match(text)
        body = text[m.end():] if m else text
        lines = body.splitlines()
        in_rival_section = False
        for line in lines:
            stripped = line.strip()
            if re.match(r"^#{1,6}\s*rivals?\s*$", stripped, re.I):
                in_rival_section = True
                continue
            if re.match(r"^#{1,6}\s+\S", stripped):
                in_rival_section = False
            if in_rival_section:
                if re.match(r"^[-*]\s+", stripped):
                    head = re.split(r"\s+[—–]\s+|\s+-\s+", stripped, maxsplit=1)[0]
                    for target in link_targets(head):
                        other = resolve(target)
                        if other and other != stem:
                            add(stem, other, "tense",
                                f"Rivals section in {stem} file", stem)
                    continue
                if stripped == "":
                    continue
                in_rival_section = False
            low = stripped.lower()
            if re.search(r"\ball(?:y|ies)\b\s*:", stripped, re.I):
                for target in link_targets(stripped):
                    if target.strip().lower() == "none":
                        continue
                    other = resolve(target)
                    if other and other != stem:
                        add(stem, other, "allied",
                            f"Allies line in {stem} file", stem)
            elif re.search(r"\bpartner\s*:", stripped, re.I):
                for target in link_targets(stripped):
                    other = resolve(target)
                    if other and other != stem:
                        add(stem, other, "allied",
                            f"Partner line in {stem} file", stem)
            elif re.search(r"\brival\b", stripped, re.I) and "[[" in stripped:
                # The rival is the first link after the word "rival" — later
                # links on the same line (aids called, renamed states) are
                # different relations, never rivals.
                tail = re.split(r"\brivals?\b", stripped, maxsplit=1, flags=re.I)[1]
                targets = link_targets(tail)
                if targets:
                    other = resolve(targets[0])
                    if other and other != stem:
                        add(stem, other, "tense",
                            f"Rival line in {stem} file", stem)
            elif re.search(r"\bhostile\b\s*:", stripped, re.I):
                for target in link_targets(stripped):
                    other = resolve(target)
                    if other and other != stem:
                        add(stem, other, "tense",
                            f"Hostile line in {stem} file", stem)
            elif re.search(r"\benemy\s*:", stripped, re.I):
                for target in link_targets(stripped):
                    other = resolve(target)
                    if other and other != stem:
                        add(stem, other, "war",
                            f"Enemy line in {stem} file", stem)
            elif re.search(r"cause\s*:\s*war with", stripped, re.I):
                for target in link_targets(stripped):
                    other = resolve(target)
                    if other and other != stem:
                        add(stem, other, "war",
                            f"War-cause line in {stem} file", stem)
            elif re.search(r"conquered\s+by\s*:", stripped, re.I):
                for target in link_targets(stripped):
                    other = resolve(target)
                    if other and other != stem:
                        add(stem, other, "war",
                            f"Conquered-by line in {stem} file", stem)
        for sent in sentences(body):
            if "[[" not in sent and "warred with" not in sent.lower():
                continue
            linked = [resolve(t) for t in link_targets(sent)]
            linked = [o for o in linked if o and o != stem]
            slow = sent.lower()
            if "civil war" in slow and re.search(r"\b(against|fighting| vs | versus )\b", slow, re.I):
                for other in linked:
                    add(stem, other, "war",
                        f"Civil war against {other} ({stem} file)", stem)
            if re.search(r"\bbeing invaded by\b", sent, re.I):
                for other in linked:
                    add(stem, other, "war",
                        f"Invaded by {other} ({stem} file)", stem)
            elif re.search(r"\binvaded\s+(the\s+)?" + re.escape(stem) + r"\b", sent, re.I):
                # Active voice names the patient ("X invaded the Spasian
                # Teocracy"). A mere same-sentence self mention ("Sua is
                # Venner's outpost — ... it invaded ...") is not evidence.
                for other in linked:
                    add(stem, other, "war",
                        f"Invasion line in {stem} file", stem)
            if re.search(r"\bhostile\b", slow) and not re.search(r"\bnot hostile\b", slow):
                if "hostile" in slow.split("[[")[0].lower() or "hostile" in slow:
                    for other in linked:
                        key = tuple(sorted((stem, other)))
                        prev = edges.get(key)
                        if prev is None:
                            add(stem, other, "tense",
                                f"Hostile relations ({stem} file)", stem)
            if re.search(r"\brivalry with\b", slow):
                for other in linked:
                    key = tuple(sorted((stem, other)))
                    if key not in edges:
                        add(stem, other, "tense",
                            f"Rivalry with {other} ({stem} file)", stem)
            if re.search(r"\bwarred with\b", slow):
                words = set(re.findall(r"[A-Za-z']+", sent))
                for name in nations:
                    first = name.split()[0] if name.split() else ""
                    # Fallback for unlinked old-enemy names ("the dwarves of
                    # Coalsteel"). Skipped when the token is itself a nation
                    # ("the elves of Kobre" must not implicate Kobre).
                    if len(first) >= 5 and first in words and first not in nations \
                            and name != stem:
                        add(stem, name, "war",
                            f"Warred for millennia ({stem} file)", stem)
                for other in linked:
                    add(stem, other, "war",
                        f"Warred with {other} ({stem} file)", stem)

    # --- Event files: Connections markers name both sides. ---
    for f in event_files:
        if f.name == "index.md":
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        m = FM_RE.match(text)
        body = text[m.end():] if m else text
        ev = f.stem
        combatants, parties, against, invaders, conquered, hostile = [], [], [], [], [], []
        # Markers are matched per sentence: wrapped prose lines can carry a
        # Combatants clause plus unrelated links ("the Empire tore itself
        # apart ... The combatants: A and B" must not implicate the Empire).
        for sent in sentences(body):
            s = sent.strip()
            if not s:
                continue
            if re.search(r"\bcombatants\s*:", s, re.I):
                combatants += [r for r in (resolve(t) for t in link_targets(s)) if r]
            elif re.search(r"\bparties\s*:", s, re.I):
                parties += [r for r in (resolve(t) for t in link_targets(s)) if r]
            elif re.search(r"\bagainst\s*:", s, re.I):
                against += [r for r in (resolve(t) for t in link_targets(s)) if r]
            elif re.search(r"\binvader\s*:", s, re.I):
                invaders += [r for r in (resolve(t) for t in link_targets(s)) if r]
            elif re.search(r"\bconquered\s*:", s, re.I):
                conquered += [r for r in (resolve(t) for t in link_targets(s)) if r]
                puppet = re.search(r"\bpuppet\s*:\s*(.+)$", s, re.I)
                if puppet:
                    conquered += [r for r in (resolve(t) for t in link_targets(puppet.group(1))) if r]
            elif re.search(r"\bhostile\b[^:]*:", s, re.I):
                hostile += [r for r in (resolve(t) for t in link_targets(s)) if r]
        for i in range(len(combatants)):
            for j in range(i + 1, len(combatants)):
                add(combatants[i], combatants[j], "war",
                    f"Combatants line in {ev} file", ev)
        for i in range(len(parties)):
            for j in range(i + 1, len(parties)):
                add(parties[i], parties[j], "allied",
                    f"Parties line in {ev} file", ev)
        for p in parties:
            for x in against:
                add(p, x, "tense", f"Against line in {ev} file", ev)
        for v in invaders:
            for c in conquered:
                add(v, c, "war", f"Invasion lines in {ev} file", ev)
            for h in hostile:
                add(v, h, "tense", f"Hostile-since line in {ev} file", ev)
    # Cletas–Venner aid-alliance (Taberis War aftermath names the alliance).
    taberis_war = VAULT / EVENTS / "Dissenbarg/The Taberis War.md"
    if taberis_war.exists():
        try:
            ttext = taberis_war.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            ttext = ""
        if re.search(r"cost of the alliance", ttext, re.I):
            add("Cletas Democracy", "Vennerian Trade Republic", "allied",
                "Aid alliance in The Taberis War file", "The Taberis War")

    factions = sorted({n for key in edges for n in key}, key=str.casefold)
    payload = {
        "source": (NATIONS.as_posix() + "/**/*.md + History/Events/**/*.md"
                   " Connections + wiki-index.json title join"),
        "files_scanned": sum(1 for f in nation_files if f.name != "index.md"),
        "factions": [{"name": n, "path": evidence_url(n)}
                     for n in factions],
        "edges": [{"a": a, "b": b, "state": state, "why": why,
                   "path": evidence_url(ev)}
                  for (a, b), (state, why, ev) in
                  sorted(edges.items(), key=lambda kv: (kv[0][0].casefold(), kv[0][1].casefold()))],
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    counts = {}
    for (_, _), (state, _, _) in edges.items():
        counts[state] = counts.get(state, 0) + 1
    print(f"webs {len(edges)} edges {counts} across {len(factions)} factions "
          f"from {payload['files_scanned']} nation files")


if __name__ == "__main__":
    main()
