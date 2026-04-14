"""Test embedding functions in app.llm."""

import math
from unittest.mock import MagicMock, patch

import pytest

from app.config import settings
from app.llm import embed_texts


def _mock_openai_embedding(*args, **kwargs):
    """Return deterministic mock embeddings based on input text."""
    texts = kwargs.get("input", args[1] if len(args) > 1 else [])
    dim = 16
    embeddings = []
    for i, text in enumerate(texts):
        vec = [0.0] * dim
        for j, ch in enumerate(text.encode("utf-8")):
            vec[j % dim] += ch
        norm = math.sqrt(sum(v * v for v in vec))
        if norm > 0:
            vec = [v / norm for v in vec]
        obj = MagicMock()
        obj.embedding = vec
        embeddings.append(obj)
    response = MagicMock()
    response.data = embeddings
    return response


@pytest.fixture(autouse=True)
def _mock_openai(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "test-key")
    # Reset app.llm's cached OpenAI client so other tests can't leak a real
    # client past our patch (see _get_openai_sync() in app/llm.py).
    import app.llm
    monkeypatch.setattr(app.llm, "_openai_sync_client", None)
    with patch("openai.OpenAI") as MockClient:
        MockClient.return_value.embeddings.create.side_effect = _mock_openai_embedding
        yield


def test_embed_texts_returns_vectors():
    texts = ["hello world", "test document"]
    vectors = embed_texts(texts)
    assert len(vectors) == 2
    assert len(vectors[0]) > 0


def test_embed_texts_same_input_same_output():
    v1 = embed_texts(["morphine dosage"])
    v2 = embed_texts(["morphine dosage"])
    assert v1[0] == v2[0]


def test_embed_texts_different_inputs():
    vectors = embed_texts(["pain management", "ventilator settings"])
    assert vectors[0] != vectors[1]


def test_embed_texts_normalized():
    vectors = embed_texts(["test normalization"])
    norm = math.sqrt(sum(v * v for v in vectors[0]))
    assert abs(norm - 1.0) < 0.01


def test_embed_texts_raises_without_api_key(monkeypatch):
    """embed_texts should raise RuntimeError when OPENAI_API_KEY is missing."""
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY is required"):
        embed_texts(["test"])
