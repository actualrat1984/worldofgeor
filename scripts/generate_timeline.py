"""timeline index generator (Wave A2): events from World/Dates/Complete Timeline.md.

Reads:  <vault>/World/Dates/Complete Timeline.md (default vault C:/Users/pc/Documents/Lore/Lore)
Writes: argv[1] or C:/Users/pc/Documents/worldofgeor/dist/wiki/timeline-index.json
Stdlib only. Read-only on the vault. Prints counts. Never invents lore:
only table rows present in the source file are emitted.
"""
import json
import pathlib
import re
import sys

VAULT = pathlib.Path(r"C:/Users/pc/Documents/Lore/Lore")
SOURCE = pathlib.Path("World/Dates/Complete Timeline.md")
DEFAULT_OUT = pathlib.Path(r"C:/Users/pc/Documents/worldofgeor/dist/wiki/timeline-index.json")
PRESENT_YEAR = "597 AGD"


def strip_links(text):
    text = re.sub(r"\[\[([^|\]]+)\|([^\]]+)\]\]", r"\2", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
    return text.strip()


def sort_key(date_raw):
    """Numeric sort: BGD -> negative, AGD -> positive, Year 0 -> 0. Approximate (~, ranges use first number)."""
    d = date_raw.replace(",", "")
    m = re.search(r"-?\d+", d)
    n = int(m.group(0)) if m else 0
    if re.search(r"\bBGD\b", d):
        return -n
    if re.search(r"\bAGD\b", d):
        return n
    return 0  # Year 0


def split_row(line):
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    return cells


def is_sep(cells):
    return all(c and set(c) <= set("-: ") for c in cells)


def main():
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    src = VAULT / SOURCE
    lines = src.read_text(encoding="utf-8").splitlines()
    section = ""
    events, ages, phases = [], [], []
    for line in lines:
        s = line.strip()
        if s.startswith("## "):
            section = s.strip("# ").strip()
            continue
        if not (s.startswith("|") and s.endswith("|")):
            continue
        cells = split_row(s)
        if is_sep(cells):
            continue
        if cells[0].lower() in ("date", "age", "phase"):
            continue
        if section.startswith("BGD ERA"):
            era = "BGD"
            events.append({"era": era, "date": cells[0], "event": strip_links(cells[1]),
                           "sort": sort_key(cells[0])})
        elif section.startswith("YEAR 0"):
            events.append({"era": "Year 0", "date": cells[0], "event": strip_links(cells[1]), "sort": 0})
        elif section.startswith("AGD ERA"):
            events.append({"era": "AGD", "date": cells[0], "event": strip_links(cells[1]),
                           "sort": sort_key(cells[0])})
        elif "AGES OF" in section:
            ages.append({"age": cells[0], "range": cells[1], "trait": strip_links(cells[2])})
        elif "SHADOW PLAN" in section:
            phases.append({"phase": cells[0], "range": cells[1], "activity": strip_links(cells[2])})
    events.sort(key=lambda e: e["sort"])
    for e in events:
        del e["sort"]
    payload = {
        "source": SOURCE.as_posix(),
        "present_year": PRESENT_YEAR,
        "ages": ages,
        "events": events,
        "shadow_plan_phases": phases,
    }
    if not events:
        payload["note"] = "thin source: no event rows parsed from Complete Timeline.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    n_bgd = sum(1 for e in events if e["era"] == "BGD")
    n_agd = sum(1 for e in events if e["era"] == "AGD")
    print(f"timeline {len(events)} events (BGD {n_bgd}, Year0 {sum(1 for e in events if e['era'] == 'Year 0')}, "
          f"AGD {n_agd}) + {len(ages)} ages + {len(phases)} phases -> {out} {out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
