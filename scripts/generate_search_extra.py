"""search-extra index generator (Wave G4): atlas pins + timeline events for search.

Reads (never the vault):
  public/atlas.html                 const pins = { world/grimmel/erisdar: [...] }
  dist/wiki/timeline-index.json     { events: [{ era, date, event }] }
Writes:
  argv[1] or dist/wiki/search-extra-index.json
  [{ kind: 'pin'|'event', title, url, detail, date? }]
Stdlib only. Deterministic (source order, dedup pins by url keep-first).
Never invents lore: pins keep their real atlas urls, events link to /timeline,
[[wikilink]] markup is stripped to plain text.
"""
import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]
ATLAS = REPO / "public" / "atlas.html"
TIMELINE = REPO / "dist" / "wiki" / "timeline-index.json"
DEFAULT_OUT = REPO / "dist" / "wiki" / "search-extra-index.json"
TIMELINE_URL = "/timeline"
FOLIOS = ("world", "grimmel", "erisdar")


def extract_pins_literal(text):
    """Return the {...} source of the `const pins = {...};` literal via brace matching."""
    anchor = text.find("const pins = {")
    if anchor < 0:
        raise ValueError("const pins = {...} not found in atlas.html")
    start = text.find("{", anchor)
    depth = 0
    in_str = None
    escaped = False
    for pos in range(start, len(text)):
        ch = text[pos]
        if in_str:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == in_str:
                in_str = None
            continue
        if ch in ("'", '"', "`"):
            in_str = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:pos + 1]
    raise ValueError("unterminated pins literal in atlas.html")


def js_string(chunk, key):
    m = re.search(key + r"\s*:\s*'((?:[^'\\]|\\.)*)'", chunk)
    if not m:
        return None
    return m.group(1).replace("\\'", "'").replace("\\\\", "\\")


def parse_pins(literal):
    pins = []
    for folio in FOLIOS:
        m = re.search(r"\b" + folio + r"\s*:\s*\[", literal)
        if not m:
            continue
        start = m.end()
        depth = 1
        in_str = None
        escaped = False
        pos = start
        while pos < len(literal) and depth > 0:
            ch = literal[pos]
            if in_str:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == in_str:
                    in_str = None
            elif ch in ("'", '"', "`"):
                in_str = ch
            elif ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
            pos += 1
        body = literal[start:pos - 1]
        for chunk in re.findall(r"\{[^{}]*\}", body):
            name = js_string(chunk, "name")
            detail = js_string(chunk, "detail")
            url = js_string(chunk, "url")
            if name and url:
                pins.append({"name": name, "detail": detail or "", "url": url})
    return pins


def strip_links(text):
    text = re.sub(r"\[\[([^|\]]+)\|([^\]]+)\]\]", r"\2", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
    text = text.replace("[[", "").replace("]]", "")
    return " ".join(text.split())


def main():
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    atlas_html = ATLAS.read_text(encoding="utf-8")
    pins = parse_pins(extract_pins_literal(atlas_html))
    timeline = json.loads(TIMELINE.read_text(encoding="utf-8"))
    events = timeline.get("events", [])

    rows = []
    seen_urls = set()
    for pin in pins:
        if not pin["url"].startswith("/wiki/") or pin["url"] in seen_urls:
            continue
        seen_urls.add(pin["url"])
        rows.append({"kind": "pin", "title": pin["name"],
                     "url": pin["url"], "detail": pin["detail"]})
    pin_count = len(rows)
    for entry in events:
        text = strip_links(str(entry.get("event", "")))
        date = str(entry.get("date", "")).strip()
        era = str(entry.get("era", "")).strip()
        if not text:
            continue
        context = " · ".join(part for part in (era, date) if part)
        rows.append({"kind": "event", "title": text, "url": TIMELINE_URL,
                     "detail": context, "date": date})

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"search-extra {pin_count} pins + {len(rows) - pin_count} events "
          f"= {len(rows)} rows -> {out} {out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
