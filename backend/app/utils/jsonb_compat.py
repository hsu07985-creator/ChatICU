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

from sqlalchemy import String, cast


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
