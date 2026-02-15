"""Test embedding functions in app.llm."""

import math

from app.llm import embed_texts


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
