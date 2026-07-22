from scripts.sync_his_snapshots_serial import SYNC_SCHEMA_VERSION, classify


def test_sync_state_reimports_when_mapping_version_changes() -> None:
    assert SYNC_SCHEMA_VERSION == "2026-07-22.10"
    current = {
        "snapshot_id": "20260721_204616",
        "normalized_hash": "same-hash",
        "schema_version": SYNC_SCHEMA_VERSION,
    }
    assert classify(current, "20260721_204616", "same-hash", force=False) == "unchanged"
    assert classify(current, "20260722_000000", "same-hash", force=False) == "timestamp-only"
    assert classify({**current, "schema_version": "old"}, "20260721_204616", "same-hash", force=False) == "changed"
    assert classify({"snapshot_id": "20260721_204616", "normalized_hash": "same-hash"}, "20260721_204616", "same-hash", force=False) == "changed"
