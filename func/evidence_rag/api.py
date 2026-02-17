"""FastAPI app for evidence-first RAG."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException

from .schemas import (
    ClinicalQueryRequest,
    ClinicalQueryResponse,
    DoseCalculateRequest,
    DoseCalculateResponse,
    IngestRequest,
    IngestResponse,
    InteractionCheckRequest,
    InteractionCheckResponse,
    QueryRequest,
    QueryResponse,
    SourceChunkResponse,
)
from .service import EvidenceRAGService


app = FastAPI(title="Evidence-First Medical RAG API", version="0.1.0")
service = EvidenceRAGService()


@app.get("/health")
def health() -> dict:
    return service.health()


@app.get("/rules/manifest")
def rules_manifest() -> dict:
    return service.clinical_rule_snapshot()


@app.post("/rules/reload")
def rules_reload() -> dict:
    return service.reload_clinical_rules()


@app.post("/ingest", response_model=IngestResponse)
def ingest(req: IngestRequest) -> IngestResponse:
    summary = service.ingest(source_dir=req.source_dir, recursive=req.recursive)
    return IngestResponse(
        status="ok",
        files_total=summary["files_total"],
        files_success=summary["files_success"],
        files_failed=summary["files_failed"],
        chunks_total=summary["chunks_total"],
        report_path=summary["report_path"],
    )


@app.post("/query", response_model=QueryResponse)
def query(req: QueryRequest) -> QueryResponse:
    result = service.query(
        question=req.question,
        top_k=req.top_k,
        topic_filter=req.topic_filter,
    )
    payload = result.to_dict()
    return QueryResponse(**payload)


@app.post("/dose/calculate", response_model=DoseCalculateResponse)
def dose_calculate(req: DoseCalculateRequest) -> DoseCalculateResponse:
    payload = service.dose_calculate(req.model_dump())
    return DoseCalculateResponse(**payload)


@app.post("/interactions/check", response_model=InteractionCheckResponse)
def interactions_check(req: InteractionCheckRequest) -> InteractionCheckResponse:
    payload = service.interaction_check(req.model_dump())
    return InteractionCheckResponse(**payload)


@app.post("/clinical/query", response_model=ClinicalQueryResponse)
def clinical_query(req: ClinicalQueryRequest) -> ClinicalQueryResponse:
    payload = service.clinical_query(req.model_dump())
    return ClinicalQueryResponse(**payload)


@app.get("/sources/{chunk_id}", response_model=SourceChunkResponse)
def sources(chunk_id: str) -> SourceChunkResponse:
    row = service.source_by_chunk_id(chunk_id)
    if not row:
        raise HTTPException(status_code=404, detail="chunk_id not found")
    return SourceChunkResponse(
        chunk_id=row["chunk_id"],
        source_file=row["source_file"],
        page=row["page"],
        topic=row["topic"],
        text=row["text"],
        metadata=row.get("metadata", {}),
    )
