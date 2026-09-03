"""tags index generator (Wave A2): page -> tags from vault frontmatter.

Reads:  <vault>/World/**/*.md  (default C:/Users/pc/Documents/Lore/Lore)
Writes: argv[1] or C:/Users/pc/Documents/worldofgeor/dist/wiki/tags-index.json
Stdlib only. Read-only on the vault. Prints counts.
"""
import json
import pathlib
import re
import sys

VAULT = pathlib.Path(r"C:/Users/pc/Documents/Lore/Lore")
DEFAULT_OUT = pathlib.Path(r"C:/Users/pc/Documents/worldofgeor/dist/wiki/tags-index.json")


def parse_frontmatter_tags(text):
    m = re.match(r"\A---\s*\n(.*?)\n---", text, re.S)
    if not m:
        return []
    fm = m.group(1)
    lines = fm.splitlines()
    idx = next((i for i, l in enumerate(lines) if re.match(r"^tags\s*:", l)), None)
    if idx is None:
        return []
    first = re.sub(r"^tags\s*:\s*", "", lines[idx]).strip()
    tags = []
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
    if tags and tags[0] == "" and first.startswith("["):
        pass
    return [t for t in tags if t]


def main():
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    root = VAULT / "World"
    files = sorted(root.rglob("*.md"))
    tag_pages = {}
    with_tags = 0
    for f in files:
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        tags = parse_frontmatter_tags(text)
        if tags:
            with_tags += 1
        rel = f.relative_to(VAULT).as_posix()
        title = f.stem
        for t in tags:
            tag_pages.setdefault(t, []).append({"title": title, "path": rel})
    items = [
        {"tag": tag, "count": len(pages), "pages": sorted(pages, key=lambda p: p["title"].lower())}
        for tag, pages in sorted(tag_pages.items())
    ]
    payload = {
        "source": "World/**/*.md frontmatter tags",
        "files_scanned": len(files),
        "files_with_tags": with_tags,
        "items": items,
    }
    if not items:
        payload["note"] = "thin source: no frontmatter tags found under World/"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    top = max(items, key=lambda i: i["count"]) if items else {"tag": "-", "count": 0}
    print(f"tags {len(items)} distinct from {len(files)} files ({with_tags} with tags) "
          f"top={top['tag']}x{top['count']} -> {out} {out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
