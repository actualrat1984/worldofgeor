"""gazetteer index generator (Wave C3b): nations from World/Nations/**/*.md.

Reads:  <vault>/World/Nations/**/*.md (default vault C:/Users/pc/Documents/Lore/Lore)
Joins:  C:/Users/pc/Documents/worldofgeor/public/wiki-index.json by title match
Writes: argv[1] or C:/Users/pc/Documents/worldofgeor/dist/wiki/gazetteer-index.json
Stdlib only. Read-only on the vault. Prints counts. Never invents lore:
only frontmatter region/status/tags present in the source file are emitted
(region falls back to the wiki URL's <Region> segment, else omitted).
"""
import json
import pathlib
import re
import sys

VAULT = pathlib.Path(r"C:/Users/pc/Documents/Lore/Lore")
NATIONS = pathlib.Path("World/Nations")
WIKI_INDEX = pathlib.Path(r"C:/Users/pc/Documents/worldofgeor/public/wiki-index.json")
DEFAULT_OUT = pathlib.Path(r"C:/Users/pc/Documents/worldofgeor/dist/wiki/gazetteer-index.json")


def parse_frontmatter(text):
    m = re.match(r"\A---\s*\n(.*?)\n---", text, re.S)
    if not m:
        return {}, []
    fm = m.group(1)
    lines = fm.splitlines()
    tags = []
    idx = next((i for i, l in enumerate(lines) if re.match(r"^tags\s*:", l)), None)
    if idx is not None:
        first = re.sub(r"^tags\s*:\s*", "", lines[idx]).strip()
        if first.startswith("["):
            tags = [t.strip().strip("'\"") for t in first.strip("[]").split(",")]
        elif first:
            tags = [first.strip().strip("'\"")]
        for line in lines[idx + 1:]:
            lm = re.match(r"^\s+-\s+(.+?)\s*$", line)
            if lm:
                tags.append(lm.group(1).strip().strip("'\""))
            elif line.strip() == "":
                continue
            else:
                break
        tags = [t for t in tags if t]
    scalars = {}
    for key in ("region", "status"):
        sm = re.search(r"^" + key + r"\s*:\s*(.+?)\s*$", fm, re.M)
        if sm:
            value = sm.group(1).strip().strip("'\"")
            if value and value != "[]":
                scalars[key] = value
    return scalars, tags


def region_from_url(url):
    # URL shape: /wiki/World/Nations/<Region>/<Nation>/...
    parts = (url or "").split("/")
    if len(parts) >= 5 and parts[1] == "wiki" and parts[2] == "World" and parts[3] == "Nations":
        return parts[4] or None
    return None


def main():
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    root = VAULT / NATIONS
    files = sorted(root.rglob("*.md"))
    try:
        wiki_index = json.loads(WIKI_INDEX.read_text(encoding="utf-8"))
    except OSError:
        wiki_index = []
    rows = wiki_index if isinstance(wiki_index, list) else wiki_index.get("pages", wiki_index.get("items", []))
    by_title = {}
    by_folded = {}
    for entry in rows:
        if not isinstance(entry, dict):
            continue
        title = entry.get("title")
        url = entry.get("url")
        if not isinstance(title, str) or not isinstance(url, str):
            continue
        if title not in by_title:
            by_title[title] = url
        folded = title.casefold()
        if folded not in by_folded:
            by_folded[folded] = url
    entries = []
    matched = 0
    for f in files:
        if f.name == "index.md":
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        name = f.stem
        scalars, tags = parse_frontmatter(text)
        url = by_title.get(name, by_folded.get(name.casefold(), ""))
        if url:
            matched += 1
        region = scalars.get("region") or region_from_url(url)
        entry = {"name": name, "region": region or "", "path": url}
        if scalars.get("status"):
            entry["status"] = scalars["status"]
        if tags:
            entry["tags"] = tags
        entries.append(entry)
    # drop the vault index.md files themselves; keep every nation file even
    # when no wiki URL joined (path "" renders as plain text, never a link).
    entries.sort(key=lambda e: e["name"].casefold())
    with_url = matched
    payload = {
        "source": (NATIONS.as_posix() + "/**/*.md + wiki-index.json title join"),
        "files_scanned": len(files),
        "entries": entries,
    }
    if not entries:
        payload["note"] = "thin source: no nation files found under World/Nations/"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    regions = sorted({e["region"] for e in entries if e["region"]})
    print(f"gazetteer {len(entries)} nations ({with_url} with wiki URLs, "
          f"{len(regions)} regions) from {len(files)} files -> {out} {out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
