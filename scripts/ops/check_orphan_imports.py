#!/usr/bin/env python3
"""Orphan named-import gate for src/ (D1, 2026-07-20).

tsconfig has no noUnusedLocals and eslint's no-unused-vars is off, so an
import left behind when code moves to a sibling module is caught by
nothing — build tree-shakes it away silently. This flags any named import
binding whose identifier appears exactly once in the file (the import
itself), i.e. genuinely unused.

Conservative by design: the once-only rule avoids false positives from
partial-name matches. Default imports and namespace imports are ignored
(rarely orphaned, and harder to disambiguate).

Usage:
    python3 scripts/ops/check_orphan_imports.py           # report + exit 1 if any
    python3 scripts/ops/check_orphan_imports.py --fix     # remove them in place
"""
import re
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "src"
IMPORT_RE = re.compile(r"^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['\"][^'\"]+['\"];?", re.M | re.S)


def _binding_name(part: str) -> str:
    part = part.replace("type ", "").strip()
    return part.split(" as ")[-1].strip()


def orphans_in(text: str):
    """Return list of (full_part, binding_name) that occur only once (the import)."""
    found = []
    for m in IMPORT_RE.finditer(text):
        for raw in m.group(1).split(","):
            part = raw.strip()
            if not part:
                continue
            name = _binding_name(part)
            if not name:
                continue
            if len(re.findall(r"\b" + re.escape(name) + r"\b", text)) == 1:
                found.append((part, name))
    return found


def fix_file(path: Path) -> int:
    text = path.read_text()
    removed = 0

    def repl(m: re.Match) -> str:
        nonlocal removed
        stmt = m.group(0)
        parts = [p.strip() for p in m.group(1).split(",") if p.strip()]
        kept = []
        for p in parts:
            if len(re.findall(r"\b" + re.escape(_binding_name(p)) + r"\b", text)) == 1:
                removed += 1
            else:
                kept.append(p)
        if not kept:
            return "\x00"  # whole import removed; sentinel line dropped below
        prefix = stmt[: stmt.index("{")]
        suffix = stmt[stmt.index("}") + 1:]
        return f"{prefix}{{ {', '.join(kept)} }}{suffix}"

    new = IMPORT_RE.sub(repl, text)
    new = "\n".join(l for l in new.split("\n") if l != "\x00")
    if removed:
        path.write_text(new)
    return removed


def main() -> int:
    fix = "--fix" in sys.argv
    total = 0
    for path in sorted(SRC.rglob("*.tsx")) + sorted(SRC.rglob("*.ts")):
        if fix:
            n = fix_file(path)
            if n:
                print(f"fixed {n}: {path.relative_to(SRC.parent)}")
                total += n
        else:
            found = orphans_in(path.read_text())
            if found:
                print(f"{path.relative_to(SRC.parent)}: {[n for _, n in found]}")
                total += len(found)
    if fix:
        print(f"\nremoved {total} orphan import(s)")
        return 0
    if total:
        print(f"\nFAIL: {total} orphan import(s) — run: python3 scripts/ops/check_orphan_imports.py --fix")
        return 1
    print("OK: no orphan named imports")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
