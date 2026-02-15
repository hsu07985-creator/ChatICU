"""Test text chunker service."""

from app.services.data_services.text_chunker import chunk_documents, chunk_text


def test_chunk_empty_text():
    assert chunk_text("") == []
    assert chunk_text("   ") == []


def test_chunk_short_text():
    text = "Short paragraph."
    chunks = chunk_text(text, chunk_size=1000)
    assert len(chunks) == 1
    assert chunks[0] == "Short paragraph."


def test_chunk_multiple_paragraphs():
    text = "Paragraph one.\n\nParagraph two.\n\nParagraph three."
    chunks = chunk_text(text, chunk_size=30, chunk_overlap=0)
    assert len(chunks) >= 2


def test_chunk_overlap():
    text = ("A" * 100) + "\n\n" + ("B" * 100) + "\n\n" + ("C" * 100)
    chunks = chunk_text(text, chunk_size=150, chunk_overlap=30)
    assert len(chunks) >= 2


def test_chunk_documents_structure():
    documents = [
        {"doc_id": "doc1.txt", "text": "Hello world.\n\nThis is test.", "category": "test"},
        {"doc_id": "doc2.txt", "text": "Another document.", "category": "test"},
    ]
    chunks = chunk_documents(documents, chunk_size=5000)
    assert len(chunks) >= 2
    for c in chunks:
        assert "doc_id" in c
        assert "text" in c
        assert "chunk_index" in c
        assert "category" in c


def test_chunk_long_paragraph():
    long_text = "word " * 500
    chunks = chunk_text(long_text, chunk_size=200, chunk_overlap=50)
    assert len(chunks) > 1
