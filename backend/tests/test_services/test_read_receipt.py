"""Unit tests for ``app.utils.read_receipt.append_read_receipt`` (TC-B09 / F-14).

The helper centralizes the dedup contract for ``read_by`` JSONB arrays
on PatientMessage / TeamChatMessage. These tests pin the behaviour the
audit asked for: idempotency on repeated calls, append for new users,
defensive handling of legacy malformed entries.
"""

from datetime import datetime, timezone

from app.utils.read_receipt import append_read_receipt


def test_append_on_empty_list():
    out = append_read_receipt(None, "usr_a", "Alice")
    assert len(out) == 1
    assert out[0]["userId"] == "usr_a"
    assert out[0]["userName"] == "Alice"
    assert "readAt" in out[0]


def test_repeated_call_does_not_duplicate():
    rb = append_read_receipt(None, "usr_a", "Alice")
    rb2 = append_read_receipt(rb, "usr_a", "Alice")
    rb3 = append_read_receipt(rb2, "usr_a", "Alice")
    # 50-person team × 1 message × repeated mark-all-read should not grow.
    assert len(rb3) == 1


def test_different_users_each_get_an_entry():
    rb = append_read_receipt(None, "usr_a", "Alice")
    rb = append_read_receipt(rb, "usr_b", "Bob")
    rb = append_read_receipt(rb, "usr_c", "Carol")
    assert [e["userId"] for e in rb] == ["usr_a", "usr_b", "usr_c"]


def test_does_not_mutate_input():
    rb_in: list = []
    rb_out = append_read_receipt(rb_in, "usr_a", "Alice")
    assert rb_in == []  # caller's reference is untouched
    assert len(rb_out) == 1


def test_refresh_timestamp_updates_existing():
    early = datetime(2026, 1, 1, tzinfo=timezone.utc)
    late = datetime(2026, 6, 1, tzinfo=timezone.utc)
    rb = append_read_receipt(None, "usr_a", "Alice", when=early)
    rb2 = append_read_receipt(rb, "usr_a", "Alice", when=late, refresh_timestamp=True)
    assert len(rb2) == 1
    assert rb2[0]["readAt"] == late.isoformat()


def test_default_no_refresh_keeps_original_timestamp():
    early = datetime(2026, 1, 1, tzinfo=timezone.utc)
    late = datetime(2026, 6, 1, tzinfo=timezone.utc)
    rb = append_read_receipt(None, "usr_a", "Alice", when=early)
    rb2 = append_read_receipt(rb, "usr_a", "Alice", when=late)  # default refresh_timestamp=False
    assert rb2[0]["readAt"] == early.isoformat()


def test_legacy_non_dict_entries_preserved():
    """Defensive: if the column somehow has a malformed entry (e.g., a
    bare string from a legacy import), the helper must not crash and
    must not lose data."""
    legacy = ["just_a_string", {"userId": "usr_b", "userName": "Bob", "readAt": "..."}]
    rb = append_read_receipt(legacy, "usr_a", "Alice")
    assert "just_a_string" in rb
    assert any(isinstance(e, dict) and e.get("userId") == "usr_a" for e in rb)


def test_dict_without_userid_does_not_block_append():
    """If a dict is missing userId, treat it as a foreign entry and
    still append our receipt."""
    rb_in = [{"some_other_key": "value"}]
    rb_out = append_read_receipt(rb_in, "usr_a", "Alice")
    assert len(rb_out) == 2
