"""Tests for password policy (T07) and password history."""

from app.utils.security import (
    check_password_history,
    hash_password,
    validate_password_strength,
    verify_password,
)


def test_validate_password_strength_ok():
    assert validate_password_strength("MyP@ssw0rd!Long") is None


def test_validate_password_too_short():
    err = validate_password_strength("Short1!A")
    assert err is not None
    assert "12" in err


def test_validate_password_no_uppercase():
    err = validate_password_strength("longpassword1!a")
    assert "大寫" in err


def test_validate_password_no_lowercase():
    err = validate_password_strength("LONGPASSWORD1!A")
    assert "小寫" in err


def test_validate_password_no_digit():
    err = validate_password_strength("LongPassword!NoDigit")
    assert "數字" in err


def test_validate_password_no_special():
    err = validate_password_strength("LongPassword1NoSpec")
    assert "特殊字元" in err


def test_check_password_history_match():
    pw = "MyOldP@ssw0rd!!"
    hashed = hash_password(pw)
    assert check_password_history(pw, [hashed]) is True


def test_check_password_history_no_match():
    hashed = hash_password("SomethingElse1!")
    assert check_password_history("TotallyDifferent1!", [hashed]) is False


def test_check_password_history_empty():
    assert check_password_history("AnyP@ssw0rd!!!", []) is False
