"""canon import packs runner (Wave H18): re-run every wiki index generator.

Default (import): runs each pack's generator, writing fresh indexes to
dist/wiki/ (the import tool's job). Vault stays read-only; generators are
stdlib-only and take argv[1] as their output path.

  python scripts/import-packs.py

--check: regenerates every pack into a temp dir and deep-diffs against the
committed dist/wiki indexes. NEVER writes dist/. Exits nonzero with
per-pack count diffs on any mismatch (vault drift, never force-green).

  python scripts/import-packs.py --check

Stdlib only.
"""

import json
import pathlib
import subprocess
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parent.parent
PACKS_DIR = REPO / "scripts" / "packs"


def load_packs():
    packs = []
    for path in sorted(PACKS_DIR.glob("*.pack.json")):
        pack = json.loads(path.read_text(encoding="utf-8"))
        for key in ("name", "generator", "output", "reads", "description", "counts"):
            if key not in pack:
                raise SystemExit(f"pack {path.name} missing required field: {key}")
        packs.append(pack)
    # dependency order: a pack listed in another pack's "after" runs later
    order = {p["name"]: i for i, p in enumerate(packs)}
    packs.sort(key=lambda p: (max([order.get(d, -1) for d in p.get("after", [])] + [-1]) + 1, order[p["name"]]))
    return packs


def run_generator(pack, out_path):
    gen = REPO / pack["generator"]
    result = subprocess.run(
        [sys.executable, str(gen), str(out_path)],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"FAIL {pack['name']}: generator exited {result.returncode}")
        print(result.stderr.strip()[-2000:])
        return False
    if result.stdout.strip():
        print("  " + result.stdout.strip().splitlines()[-1])
    return True


def extract_counts(data, keys):
    """Count semantics shared with tests/import-packs.test.mjs: a top-level
    list counts as 'items'; a dict key counts its list/dict length; a
    missing key counts 0; any other scalar counts as-is."""
    counts = {}
    for key in keys:
        if isinstance(data, list):
            counts[key] = len(data) if key == "items" else 0
            continue
        value = data.get(key) if isinstance(data, dict) else None
        if isinstance(value, (list, dict)):
            counts[key] = len(value)
        elif value is None:
            counts[key] = 0
        else:
            counts[key] = value
    return counts


def cmd_import(packs):
    failed = []
    for pack in packs:
        out = REPO / pack["output"]
        print(f"import {pack['name']}: {pack['generator']} -> {pack['output']}")
        if not run_generator(pack, out):
            failed.append(pack["name"])
            continue
        fresh = json.loads(out.read_text(encoding="utf-8"))
        print(f"  counts: {json.dumps(extract_counts(fresh, pack['counts']), sort_keys=True)}")
    if failed:
        print(f"IMPORT FAILED: {', '.join(failed)}")
        return 1
    print(f"imported {len(packs)} packs -> dist/wiki")
    return 0


def cmd_check(packs):
    failed = []
    with tempfile.TemporaryDirectory(prefix="import-packs-") as tmp:
        for pack in packs:
            committed_path = REPO / pack["output"]
            tmp_path = pathlib.Path(tmp) / pathlib.Path(pack["output"]).name
            print(f"check {pack['name']}: {pack['generator']}")
            if not run_generator(pack, tmp_path):
                failed.append(pack["name"])
                continue
            try:
                fresh = json.loads(tmp_path.read_text(encoding="utf-8"))
            except OSError as exc:
                print(f"  FAIL {pack['name']}: no fresh output ({exc})")
                failed.append(pack["name"])
                continue
            try:
                committed = json.loads(committed_path.read_text(encoding="utf-8"))
            except OSError:
                print(f"  FAIL {pack['name']}: committed index missing at {pack['output']}")
                failed.append(pack["name"])
                continue
            if fresh == committed:
                print(f"  ok {pack['name']}: counts {json.dumps(extract_counts(fresh, pack['counts']), sort_keys=True)} match")
            else:
                failed.append(pack["name"])
                new_counts = extract_counts(fresh, pack["counts"])
                old_counts = extract_counts(committed, pack["counts"])
                diffs = {k: {"committed": old_counts[k], "reimported": new_counts[k]}
                         for k in pack["counts"] if old_counts[k] != new_counts[k]}
                print(f"  FAIL {pack['name']}: re-import differs from {pack['output']}")
                print(f"  count diffs: {json.dumps(diffs, sort_keys=True) or '(counts equal, payload differs)'}")
    if failed:
        print(f"CHECK FAILED: {len(failed)}/{len(packs)} packs differ: {', '.join(failed)}")
        print("Vault drifted — update the vault or the committed indexes, never force counts green.")
        return 1
    print(f"check ok: all {len(packs)} packs re-import clean against committed indexes")
    return 0


def main():
    packs = load_packs()
    if not packs:
        print("no packs found in scripts/packs/")
        return 1
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        return cmd_check(packs)
    if len(sys.argv) > 1:
        print(f"usage: {pathlib.Path(sys.argv[0]).name} [--check]")
        return 2
    return cmd_import(packs)


if __name__ == "__main__":
    raise SystemExit(main())
