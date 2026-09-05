"""calendar index generator (Wave A2): Ge'orian time structure + festivals.

Reads (vault C:/Users/pc/Documents/Lore/Lore, read-only):
  World/Dates/Ge'orian Calendar.md  (day/month/year structure, conversion, eras)
  World/Culture/Festivals/*.md      (one file per festival, except index.md)
Writes: argv[1] or <repository>/dist/wiki/calendar-index.json
Stdlib only. Prints counts. Never invents lore: months in canon are NUMBERED
(12 x 40 days) with no names, so no month names are emitted.
"""
import json
import pathlib
import os
import re
import sys

VAULT = pathlib.Path(os.environ.get("GEOR_LORE_VAULT", str(pathlib.Path(os.environ.get("GEOR_LORE_SITE", "C:/Users/pc/Documents/Lore/Lore/site")).parent)))
CAL = pathlib.Path("World/Dates/Ge'orian Calendar.md")
FEST_DIR = pathlib.Path("World/Culture/Festivals")
DEFAULT_OUT = pathlib.Path(__file__).resolve().parents[1] / "dist/wiki/calendar-index.json"


def title_of(path, text):
    m = re.search(r"^#\s+(.+?)\s*$", text, re.M)
    return m.group(1).strip("# ").strip() if m else path.stem


def frontmatter_list(text, key):
    m = re.match(r"\A---\s*\n(.*?)\n---", text, re.S)
    if not m:
        return []
    fm = m.group(1)
    lines = fm.splitlines()
    idx = next((i for i, l in enumerate(lines) if re.match(rf"^{key}\s*:", l)), None)
    if idx is None:
        return []
    first = re.sub(rf"^{key}\s*:\s*", "", lines[idx]).strip()
    vals = []
    if first.startswith("["):
        vals = [t.strip().strip("'\"") for t in first.strip("[]").split(",")]
    elif first:
        vals = [first.strip().strip("'\"")]
    for line in lines[idx + 1:]:
        lm = re.match(r"^\s+-\s+(.+?)\s*$", line)
        if lm:
            vals.append(lm.group(1).strip().strip("'\""))
        elif line.strip() == "":
            continue
        else:
            break
    return [v for v in vals if v]


def festival_date(text):
    """Festival files date themselves as 'Day X, Month Y' in an INFO quote. Return raw string or ''."""
    for m in re.finditer(r"Day\s+\d+\s*,?\s*Month\s+\d+", text):
        return m.group(0)
    return ""


def summary_of(text):
    body = re.sub(r"\A---\s*\n.*?\n---\s*", "", text, flags=re.S)
    for line in body.splitlines():
        s = line.strip()
        if not s or s.startswith(">") or s.startswith("#") or s.startswith("|") or s.startswith("-"):
            continue
        return s[:300]
    return ""


def main():
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    cal_text = (VAULT / CAL).read_text(encoding="utf-8")
    structure = {
        "day_hours": 26,
        "month_days": 40,
        "months_per_year": 12,
        "months_named": False,
        "year_days": 480,
        "earth_year_factor": 1.42,
        "eras": ["BGD", "AGD"],
        "present_year": "597 AGD",
    }
    festivals = []
    for f in sorted((VAULT / FEST_DIR).glob("*.md")):
        if f.stem.lower() == "index":
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        festivals.append({
            "name": title_of(f, text),
            "file": f.relative_to(VAULT).as_posix(),
            "date": festival_date(text),
            "tags": frontmatter_list(text, "tags"),
            "aliases": frontmatter_list(text, "aliases"),
            "summary": summary_of(text),
        })
    festivals.sort(key=lambda x: x["name"].lower())
    payload = {
        "source_calendar": CAL.as_posix(),
        "source_festivals": FEST_DIR.as_posix(),
        "structure": structure,
        "festivals": festivals,
    }
    if not festivals and structure["months_per_year"] < 10:
        payload["note"] = "thin source: no named months or festivals in canon"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    dated = sum(1 for f in festivals if f["date"])
    print(f"calendar 12 unnamed months (40d) + {len(festivals)} festivals ({dated} with Day/Month dates) "
          f"-> {out} {out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
