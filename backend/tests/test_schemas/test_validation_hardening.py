import pytest
from pydantic import ValidationError

from app.schemas.admin import AdviceRecordCreate, UserCreate
from app.schemas.clinical import AIChatRequest, RAGQueryRequest
from app.schemas.message import MessageCreate


def test_user_create_rejects_invalid_username_chars():
    with pytest.raises(ValidationError):
        UserCreate(
            name="測試使用者",
            username="bad username",
            password="StrongPass123!",
            email="tester@example.com",
            role="admin",
            unit="ICU",
        )


def test_user_create_rejects_invalid_email():
    with pytest.raises(ValidationError):
        UserCreate(
            name="測試使用者",
            username="tester_1",
            password="StrongPass123!",
            email="bad-email",
            role="admin",
            unit="ICU",
        )


def test_message_create_rejects_invalid_message_type():
    with pytest.raises(ValidationError):
        MessageCreate(content="hello", messageType="invalid-type")


def test_advice_record_rejects_bad_code_format():
    with pytest.raises(ValidationError):
        AdviceRecordCreate(
            patientId="pat_001",
            adviceCode="BAD",
            adviceLabel="test",
            category="1. 建議處方",
            content="test content",
        )


def test_rag_query_rejects_top_k_out_of_range():
    with pytest.raises(ValidationError):
        RAGQueryRequest(question="what is guideline", top_k=21)


def test_ai_chat_rejects_empty_message():
    with pytest.raises(ValidationError):
        AIChatRequest(message="")
