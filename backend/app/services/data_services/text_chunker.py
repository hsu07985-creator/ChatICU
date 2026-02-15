"""Text chunker — splits documents into overlapping chunks."""

from __future__ import annotations


def chunk_text(
    text: str,
    chunk_size: int = 1500,
    chunk_overlap: int = 200,
) -> list[str]:
    """Split text into overlapping chunks by character count.

    Uses paragraph boundaries when possible, falls back to
    sentence/character boundaries for long paragraphs.

    Args:
        text: Full document text.
        chunk_size: Target characters per chunk (~500 tokens at 3 chars/token).
        chunk_overlap: Overlap characters between consecutive chunks.

    Returns:
        List of text chunks.
    """
    if not text.strip():
        return []

    # Split into paragraphs first
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    chunks = []
    current_chunk: list[str] = []
    current_length = 0

    for para in paragraphs:
        para_len = len(para)

        # If single paragraph exceeds chunk_size, split it further
        if para_len > chunk_size:
            # Flush current chunk first
            if current_chunk:
                chunks.append("\n\n".join(current_chunk))
                current_chunk = []
                current_length = 0

            # Split long paragraph by sentences
            sub_chunks = _split_long_text(para, chunk_size, chunk_overlap)
            chunks.extend(sub_chunks)
            continue

        # If adding this paragraph exceeds chunk_size, flush
        if current_length + para_len + 2 > chunk_size and current_chunk:
            chunk_text_str = "\n\n".join(current_chunk)
            chunks.append(chunk_text_str)

            # Keep overlap: take last portion of current chunk
            overlap_text = chunk_text_str[-chunk_overlap:] if chunk_overlap > 0 else ""
            if overlap_text:
                current_chunk = [overlap_text]
                current_length = len(overlap_text)
            else:
                current_chunk = []
                current_length = 0

        current_chunk.append(para)
        current_length += para_len + 2

    # Flush remaining
    if current_chunk:
        chunks.append("\n\n".join(current_chunk))

    return chunks


def _split_long_text(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    """Split a long text block by sentence boundaries."""
    # Try splitting by common sentence endings
    import re
    sentences = re.split(r'(?<=[.!?。！？])\s+', text)

    if len(sentences) <= 1:
        # No sentence boundaries found — split by character
        return _split_by_chars(text, chunk_size, chunk_overlap)

    chunks = []
    current = []
    current_len = 0

    for sentence in sentences:
        s_len = len(sentence)
        if current_len + s_len + 1 > chunk_size and current:
            chunk_str = " ".join(current)
            chunks.append(chunk_str)
            overlap_text = chunk_str[-chunk_overlap:] if chunk_overlap > 0 else ""
            current = [overlap_text] if overlap_text else []
            current_len = len(overlap_text)

        current.append(sentence)
        current_len += s_len + 1

    if current:
        chunks.append(" ".join(current))

    return chunks


def _split_by_chars(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    """Last resort: split by character count."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start = end - chunk_overlap
    return chunks


def chunk_documents(documents: list[dict], chunk_size: int = 1500, chunk_overlap: int = 200) -> list[dict]:
    """Chunk a list of documents into indexed chunks.

    Args:
        documents: List from document_loader.load_documents().
        chunk_size: Characters per chunk.
        chunk_overlap: Overlap characters.

    Returns:
        [{"doc_id": str, "text": str, "chunk_index": int, "category": str}, ...]
    """
    all_chunks = []
    for doc in documents:
        text_chunks = chunk_text(doc["text"], chunk_size, chunk_overlap)
        for i, chunk in enumerate(text_chunks):
            all_chunks.append({
                "doc_id": doc["doc_id"],
                "text": chunk,
                "chunk_index": i,
                "category": doc.get("category", "uncategorized"),
            })
    return all_chunks
