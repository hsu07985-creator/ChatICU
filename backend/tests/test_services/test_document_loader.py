"""Test document loader service."""

import os
import tempfile

from app.services.data_services.document_loader import load_documents


def test_load_empty_directory():
    with tempfile.TemporaryDirectory() as tmpdir:
        docs = load_documents(tmpdir)
        assert docs == []


def test_load_nonexistent_directory():
    docs = load_documents("/nonexistent/path/abc123")
    assert docs == []


def test_load_txt_files():
    with tempfile.TemporaryDirectory() as tmpdir:
        subdir = os.path.join(tmpdir, "category_a")
        os.makedirs(subdir)
        with open(os.path.join(subdir, "test.txt"), "w") as f:
            f.write("Hello world, this is a test document.")

        docs = load_documents(tmpdir)
        assert len(docs) == 1
        assert docs[0]["doc_id"] == "category_a/test.txt"
        assert docs[0]["category"] == "category_a"
        assert "Hello world" in docs[0]["text"]


def test_skips_hidden_files():
    with tempfile.TemporaryDirectory() as tmpdir:
        with open(os.path.join(tmpdir, ".hidden"), "w") as f:
            f.write("hidden")
        with open(os.path.join(tmpdir, "visible.txt"), "w") as f:
            f.write("visible")

        docs = load_documents(tmpdir)
        assert len(docs) == 1
        assert docs[0]["doc_id"] == "visible.txt"
