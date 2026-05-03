"""Dialect-aware JSONB array containment helper.

PostgreSQL is the production target and supports ``mentioned_roles @>
'["admin"]'`` natively, which is GIN-indexable (see migration 076).

The test suite uses an in-memory SQLite engine with JSONB columns
remapped to JSON; on SQLite the ``@>`` operator does not exist, and
SQLAlchemy's ``JSON.contains([...])`` compiles to a substring LIKE that
only matches single-element JSON arrays. To keep the production query
index-friendly while still passing tests, this helper picks the
correct expression per dialect.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, cast


def to_utc_aware(value: Optional[datetime]) -> Optional[datetime]:
    """Normalize a ``DateTime(timezone=True)`` round-tripped through
    SQLite (which strips tzinfo) back to UTC-aware.

    PG returns aware datetimes; SQLite returns naive ones. Comparison
    against a tz-aware ``datetime.now(timezone.utc)`` would otherwise
    raise ``TypeError: can't compare offset-naive and offset-aware``.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def array_contains_value(column, value: str, dialect_name: str):
    """Return a SQL expression matching rows where ``column`` (a JSON/JSONB
    array) contains ``value`` as one of its elements.

    On PostgreSQL: ``column @> '["value"]'::jsonb`` — index-friendly.
    On SQLite/other: ``cast(column AS text) LIKE '%"value"%'`` — falls
    back to substring matching on the JSON-encoded text. The surrounding
    quotes prevent prefix collisions (e.g. role ``"admin"`` will not
    match a row whose only mention is ``"all_admins"``).
    """
    if dialect_name == "postgresql":
        return column.contains([value])
    return cast(column, String).contains(f'"{value}"')


def array_contains_user_receipt(column, user_id: str, dialect_name: str):
    """Return a SQL expression matching rows where ``column`` (a JSON/JSONB
    array of ``{userId, userName, readAt}`` objects) contains an entry
    for the given ``user_id``.

    Used by TC-W3-T1's per-user team-chat unread model: a message is
    "read by me" iff ``read_by`` contains an object with my userId. The
    PostgreSQL form uses ``@>`` against a single-key probe object so it
    matches regardless of the other fields' values; the SQLite test
    fallback substring-matches the JSON encoding ``"userId": "<id>"``.
    """
    if dialect_name == "postgresql":
        return column.contains([{"userId": user_id}])
    return cast(column, String).contains(f'"userId": "{user_id}"')
