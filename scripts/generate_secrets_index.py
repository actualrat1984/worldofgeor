"""secrets index generator (Wave H10): article URL -> hidden-passage count.

Reads (never the vault):
  dist/wiki/**/index.html          built wiki articles (MkDocs output)

Writes:
  argv[1] or dist/wiki/secrets-index.json
  { "/wiki/Article/Path/": <secret count> } — counts only, ZERO secret
  bytes. Only articles with >= 1 <div class="geor-secret"> block appear;
  geor-secret-gm notes are never counted (they never leave the server).

Stdlib only. Deterministic (sorted keys). Served gated behind the /wiki/
auth prefix like search-extra-index.json — no new public surface.

Optional argv[2] (or GEOR_SECRETS_WIKI env) overrides the wiki input dir,
so node --test can run this against a fixture.
"""

import json
import os
import pathlib
import re
import sys

REPO = pathlib.Path(r"C:/Users/pc/Documents/worldofgeor")
DEFAULT_WIKI = REPO / "dist" / "wiki"
DEFAULT_OUT = REPO / "dist" / "wiki" / "secrets-index.json"

DIV_RE = re.compile(r"<div\b([^>]*)>", re.IGNORECASE)
CLASS_RE = re.compile(r"""\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""", re.IGNORECASE)


def count_secrets(html):
    """Count geor-secret blocks, excluding geor-secret-gm notes."""
    total = 0
    for match in DIV_RE.finditer(html):
        attrs = match.group(1) or ""
        class_match = CLASS_RE.search(attrs)
        classes = (class_match.group(1) or class_match.group(2) or class_match.group(3) or ""
                   if class_match else "").split()
        if "geor-secret" in classes and "geor-secret-gm" not in classes:
            total += 1
    return total


def main():
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    wiki = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else pathlib.Path(
        os.environ.get("GEOR_SECRETS_WIKI", str(DEFAULT_WIKI)))
    if not wiki.exists():
        print("wiki not built yet, skip secrets index")
        return
    index = {}
    pages = 0
    for html_file in sorted(wiki.rglob("index.html")):
        parent = str(html_file.relative_to(wiki).parent).replace("\\", "/")
        url = "/wiki/" + parent + "/" if parent != "." else "/wiki/"
        try:
            text = html_file.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        pages += 1
        count = count_secrets(text)
        if count > 0:
            index[url] = count
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(index, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                   encoding="utf-8")
    print(f"secrets-index {len(index)} articles with secrets "
          f"({pages} pages scanned) -> {out} {out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
