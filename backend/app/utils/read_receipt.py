"""Idempotent ``read_by`` append helper.

Several endpoints append a ``{userId, userName, readAt}`` entry to a
JSONB ``read_by`` array when a user marks a message read. The TC-B09
audit (F-14) found that ``notifications.mark-all-read`` was the
single path doing this without dedup, so repeated calls grew the
array unboundedly in a 50-person team. Even the paths that did dedup
each had their own inline copy of the check, drifting subtly over
time.

This module centralizes the contract:
- One receipt per user per message (last-write-wins on ``readAt`` if
  the caller really wants to refresh the timestamp via
  ``refresh_timestamp=True``).
- Defensive against malformed entries: non-dict and missing-userId
  entries are kept as-is to preserve backward compatibility.
"""

from datetime import datetime, timezone
from typing import Any, List, Optional


def append_read_receipt(
    read_by: Optional[List[Any]],
    user_id: str,
    user_name: str,
    when: Optional[datetime] = None,
    *,
    refresh_timestamp: bool = False,
) -> List[Any]:
    """Return a new list with the user's read receipt ensured.

    If ``read_by`` already contains a dict with matching ``userId``:
    - returns the list unchanged when ``refresh_timestamp`` is False
      (default — idempotent, matches the existing dedup contract);
    - updates that entry's ``readAt`` to ``when`` (or now-UTC) when
      ``refresh_timestamp`` is True.

    The input list is not mutated; callers should rebind the column,
    e.g. ``msg.read_by = append_read_receipt(msg.read_by, ...)``.
    """
    rb: List[Any] = list(read_by or [])
    timestamp = (when or datetime.now(timezone.utc)).isoformat()

    for i, entry in enumerate(rb):
        if isinstance(entry, dict) and entry.get("userId") == user_id:
            if refresh_timestamp:
                rb[i] = {**entry, "readAt": timestamp, "userName": user_name}
            return rb

    rb.append({
        "userId": user_id,
        "userName": user_name,
        "readAt": timestamp,
    })
    return rb
