"""CLI entrypoint for evidence-first RAG."""

from __future__ import annotations

import argparse
import json

from .service import EvidenceRAGService


def main() -> int:
    parser = argparse.ArgumentParser(description="Evidence-first medical RAG CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)

    ing = sub.add_parser("ingest", help="Ingest and index corpus")
    ing.add_argument("--source-dir", default=None)
    ing.add_argument("--no-recursive", action="store_true")

    qry = sub.add_parser("query", help="Run a query")
    qry.add_argument("question")
    qry.add_argument("--top-k", type=int, default=8)
    qry.add_argument("--topic", action="append", default=None)

    args = parser.parse_args()
    svc = EvidenceRAGService()

    if args.cmd == "ingest":
        out = svc.ingest(source_dir=args.source_dir, recursive=not args.no_recursive)
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0

    if args.cmd == "query":
        out = svc.query(question=args.question, top_k=args.top_k, topic_filter=args.topic)
        print(json.dumps(out.to_dict(), ensure_ascii=False, indent=2))
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())

