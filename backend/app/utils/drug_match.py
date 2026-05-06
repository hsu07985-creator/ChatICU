"""Drug-name matching utilities with word-boundary protection.

Replaces the legacy `ILIKE '%X%'` / bidirectional substring approach that
leaked superstring drug names (e.g. `methylprednisolone` rows being matched
when the query was `prednisolone`).

Two flavors of word-boundary pattern are exposed:

* ``word_boundary_pattern`` — for PostgreSQL POSIX regex (uses ``\\m`` /
  ``\\M``). Pair with SQLAlchemy ``Column.op("~*")(pattern)``.
* ``_word_pattern`` — internal helper that mirrors ``word_boundary_pattern``
  but uses Python's ``\\b`` for use with the standard ``re`` module.

Both helpers are *conditional on head/tail*: if the drug name begins or ends
with a non-word character (e.g. ``Prednisolone (Systemic)`` ending in ``)``),
the corresponding boundary anchor is dropped — otherwise the pattern would
never match the name itself.
"""

from __future__ import annotations

import re


def _is_word_char(ch: str) -> bool:
    """True for ASCII word chars: letter, digit, or underscore."""
    return ch.isalnum() or ch == "_"


def word_boundary_pattern(name: str) -> str:
    """Build a PostgreSQL POSIX regex pattern with conditional word boundaries.

    Examples::

        word_boundary_pattern("prednisolone")
            -> r"\\mprednisolone\\M"           # excludes methylprednisolone
        word_boundary_pattern("Prednisolone (Systemic)")
            -> r"\\mPrednisolone\\ \\(Systemic\\)"   # tail ')' is non-word, no \\M
        word_boundary_pattern("5-Fluorouracil")
            -> r"\\m5\\-Fluorouracil\\M"

    Returns an empty string for empty input so callers can gate on truthiness.
    """
    if not name:
        return ""
    escaped = re.escape(name)
    head = r"\m" if _is_word_char(name[0]) else ""
    tail = r"\M" if _is_word_char(name[-1]) else ""
    return f"{head}{escaped}{tail}"


def _word_pattern(name: str) -> str:
    """Same shape as ``word_boundary_pattern`` but for Python ``re`` (\\b)."""
    if not name:
        return ""
    escaped = re.escape(name)
    head = r"\b" if _is_word_char(name[0]) else ""
    tail = r"\b" if _is_word_char(name[-1]) else ""
    return f"{head}{escaped}{tail}"


def word_match(a: str, b: str) -> bool:
    """Bidirectional word-boundary substring match.

    Replaces the legacy ``a in b or b in a`` idiom. Returns True iff:

      * ``a == b`` (short-circuit, also handles empty-string edge cases when
        both are empty, though we treat empty as no-match below), OR
      * ``a`` appears in ``b`` at word boundaries (head/tail conditional), OR
      * ``b`` appears in ``a`` at word boundaries (head/tail conditional).

    Both directions are intentionally kept so user input ``"Prednisolone
    (Systemic)"`` still matches a DB row ``"Prednisolone"`` and vice versa.
    """
    if not a or not b:
        return False
    if a == b:
        return True
    pa = _word_pattern(a)
    pb = _word_pattern(b)
    if pa and re.search(pa, b) is not None:
        return True
    if pb and re.search(pb, a) is not None:
        return True
    return False
