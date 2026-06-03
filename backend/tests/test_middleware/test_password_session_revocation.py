"""Regression (br-1): a password change/reset/admin-set must revoke every session
issued before it. token_predates_password_change is the gate used by both
get_current_user and the /refresh endpoint."""
from datetime import datetime, timezone, timedelta

from app.middleware.auth import token_predates_password_change


class _U:
    def __init__(self, changed):
        self.password_changed_at = changed


def test_token_issued_after_password_change_is_not_revoked():
    now = datetime.now(timezone.utc)
    user = _U(now - timedelta(minutes=5))  # password changed before token issued
    assert token_predates_password_change({"iat": int(now.timestamp())}, user) is False


def test_token_issued_before_password_change_is_revoked():
    now = datetime.now(timezone.utc)
    user = _U(now + timedelta(minutes=5))  # password changed AFTER token issued
    assert token_predates_password_change({"iat": int(now.timestamp())}, user) is True


def test_same_second_login_not_falsely_revoked():
    """iat is floored to whole seconds; a sub-second password_changed_at in the
    same second must NOT revoke a freshly-minted token (change -> immediate login)."""
    now = datetime.now(timezone.utc)
    user = _U(now.replace(microsecond=900_000))
    assert token_predates_password_change({"iat": int(now.timestamp())}, user) is False


def test_no_password_changed_at_never_revokes():
    now = datetime.now(timezone.utc)
    assert token_predates_password_change({"iat": int(now.timestamp())}, _U(None)) is False


def test_missing_iat_never_revokes():
    now = datetime.now(timezone.utc)
    assert token_predates_password_change({}, _U(now)) is False
