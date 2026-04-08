from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import logging
import re
import sys
from pathlib import Path
from threading import Lock
from typing import Any, Optional

from app.config import settings

logger = logging.getLogger(__name__)

_RISK_TO_SEVERITY = {
    "X": "contraindicated",
    "D": "major",
    "C": "moderate",
    "B": "minor",
    "A": "minor",
}

_SEVERITY_PRIORITY = {
    "contraindicated": 5,
    "major": 4,
    "moderate": 3,
    "minor": 2,
    "unknown": 1,
}

_DOSAGE_RE = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|kg|ml|mL|l|L|iu|u|%|amp|vial|tab|cap|inj)\b",
    flags=re.IGNORECASE,
)
_BRACKET_RE = re.compile(r"[\[\(（【<＜].*?[\]\)）】>＞]")
_BRACKET_PATTERNS = [
    re.compile(r"\(([^()]{2,160})\)"),
    re.compile(r"（([^（）]{2,160})）"),
    re.compile(r"\[([^\[\]]{2,160})\]"),
    re.compile(r"【([^【】]{2,160})】"),
]
_TOKEN_CLEAN_RE = re.compile(
    r"\b(?:inj|tab|cap|solution|soln|susp|oph|cream|gel|ointment|drop|drops|bag|plastic|point|sr|xr|xl|od|f\.?c\.?|點滴|軟袋|外用|口服液|注射液|乳膏)\b",
    flags=re.IGNORECASE,
)
_TOKEN_SPLIT_RE = re.compile(r"[+/、,;|=&]+")
_HAS_LETTER_RE = re.compile(r"[A-Za-z\u4E00-\u9FFF]")
_SPACE_RE = re.compile(r"\s+")

_ALIAS_RULES: list[tuple[re.Pattern[str], list[str]]] = [
    (re.compile(r"\bn\.?\s*s\.?\b", re.IGNORECASE), ["Sodium Chloride"]),
    (re.compile(r"\bnormal\s*saline\b", re.IGNORECASE), ["Sodium Chloride"]),
    (re.compile(r"\bkcl\b", re.IGNORECASE), ["Potassium Chloride"]),
    (re.compile(r"pot\.?\s*chloride", re.IGNORECASE), ["Potassium Chloride"]),
    (re.compile(r"\bbokey\b", re.IGNORECASE), ["Aspirin"]),
    (re.compile(r"\bu-?ca(?:\s*d)?\b", re.IGNORECASE), ["Calcitriol"]),
    (re.compile(r"\bxigduo\b", re.IGNORECASE), ["Dapagliflozin", "MetFORMIN"]),
    (re.compile(r"\bgalvus\s*met\b", re.IGNORECASE), ["Vildagliptin", "MetFORMIN"]),
    (re.compile(r"\bamaryl\s*m\b", re.IGNORECASE), ["Glimepiride", "MetFORMIN"]),
    (re.compile(r"\bryzodeg\b", re.IGNORECASE), ["Insulin Degludec", "Insulin Aspart"]),
    (re.compile(r"\bco[\s\-]*diovan\b", re.IGNORECASE), ["Valsartan", "Hydrochlorothiazide"]),
    (re.compile(r"\bexforge\s*hct\b", re.IGNORECASE), ["Amlodipine", "Valsartan", "Hydrochlorothiazide"]),
    (re.compile(r"\bunasyn\b", re.IGNORECASE), ["Ampicillin", "Sulbactam"]),
    (re.compile(r"\bcuram\b", re.IGNORECASE), ["Amoxicillin", "Clavulanate"]),
    (re.compile(r"\bamoclav\b", re.IGNORECASE), ["Amoxicillin", "Clavulanate"]),
    (re.compile(r"\bbrosym\b", re.IGNORECASE), ["Cefoperazone", "Sulbactam"]),
    (re.compile(r"pseudo.*lora", re.IGNORECASE), ["Pseudoephedrine", "Loratadine"]),
    (re.compile(r"losartan\+hct", re.IGNORECASE), ["Losartan", "Hydrochlorothiazide"]),
    (re.compile(r"\btmp[\s/\-]*smx\b", re.IGNORECASE), ["Trimethoprim", "Sulfamethoxazole"]),
    (re.compile(r"\bbactrim\b", re.IGNORECASE), ["Trimethoprim", "Sulfamethoxazole"]),
    (re.compile(r"\bseptrin\b", re.IGNORECASE), ["Trimethoprim", "Sulfamethoxazole"]),
    (re.compile(r"\bbaktar\b", re.IGNORECASE), ["Trimethoprim", "Sulfamethoxazole"]),
    (re.compile(r"撲菌特", re.IGNORECASE), ["Trimethoprim", "Sulfamethoxazole"]),
]


class DrugGraphBridge:
    """Optional bridge to local DrugData graph.

    The bridge is best-effort:
    - if disabled or unavailable, callers can safely fallback to DB queries
    - graph loading is lazy and performed once
    """

    def __init__(self) -> None:
        self._lock = Lock()
        self._graph: Any | None = None
        self._load_attempted = False

    @staticmethod
    def _hash_id(prefix: str, parts: list[str]) -> str:
        raw = "|".join([prefix, *parts]).encode("utf-8", "ignore")
        return f"{prefix}_{hashlib.sha1(raw).hexdigest()[:12]}"

    @staticmethod
    def _clean_query(raw: str) -> str:
        text = (raw or "").strip()
        if not text:
            return ""
        text = _BRACKET_RE.sub(" ", text)
        text = text.replace('"', " ").replace("'", " ")
        text = _DOSAGE_RE.sub(" ", text)
        text = _TOKEN_CLEAN_RE.sub(" ", text)
        text = _SPACE_RE.sub(" ", text).strip(" -_/+,;:.")
        return text

    @classmethod
    def _build_query_candidates(cls, raw: str) -> list[str]:
        text = (raw or "").strip()
        if not text:
            return []
        candidates: list[str] = []
        seen: set[str] = set()

        cls._add_candidate(candidates, seen, text)
        for alias in cls._expand_aliases(text):
            cls._add_candidate(candidates, seen, alias)

        cleaned = cls._clean_query(text)
        cls._add_candidate(candidates, seen, cleaned)

        for chunk in cls._extract_bracket_chunks(text):
            cls._add_candidate(candidates, seen, chunk)
            for token in cls._split_tokens(chunk):
                cls._add_candidate(candidates, seen, token)

        for token in cls._split_tokens(cleaned or text):
            cls._add_candidate(candidates, seen, token)

        # Second pass: apply alias expansion on generated tokens.
        for token in list(candidates):
            for alias in cls._expand_aliases(token):
                cls._add_candidate(candidates, seen, alias)

        return candidates[:40]

    @staticmethod
    def _extract_bracket_chunks(raw: str) -> list[str]:
        chunks: list[str] = []
        seen: set[str] = set()
        text = str(raw or "")
        for pattern in _BRACKET_PATTERNS:
            for match in pattern.findall(text):
                chunk = _SPACE_RE.sub(" ", str(match or "").strip())
                if not chunk:
                    continue
                key = chunk.lower()
                if key in seen:
                    continue
                seen.add(key)
                chunks.append(chunk)
        return chunks

    @staticmethod
    def _split_tokens(text: str) -> list[str]:
        tokens: list[str] = []
        if not text:
            return tokens
        source = re.sub(r"\b(?:and|with)\b", " ", text, flags=re.IGNORECASE)
        for part in _TOKEN_SPLIT_RE.split(source):
            token = _SPACE_RE.sub(" ", part).strip(" \"'`-_/+,;:.()[]{}<>")
            if not token:
                continue
            if not _HAS_LETTER_RE.search(token):
                continue
            tokens.append(token)
        return tokens

    @staticmethod
    def _add_candidate(candidates: list[str], seen: set[str], value: str | None) -> None:
        token = _SPACE_RE.sub(" ", str(value or "").strip()).strip(" \"'`-_/+,;:.()[]{}<>")
        if len(token) < 2:
            return
        if not _HAS_LETTER_RE.search(token):
            return
        key = token.lower()
        if key in seen:
            return
        seen.add(key)
        candidates.append(token)

    @staticmethod
    def _expand_aliases(text: str) -> list[str]:
        if not text:
            return []
        out: list[str] = []
        lowered = text.lower()
        for pattern, targets in _ALIAS_RULES:
            if pattern.search(lowered):
                out.extend(targets)
        return out

    @staticmethod
    def _is_high_confidence_fuzzy_match(candidate: str, matched: str, score: float) -> bool:
        cand = candidate.lower().strip()
        hit = matched.lower().strip()
        if not cand or not hit:
            return False
        if cand == hit:
            return True
        if score >= 0.92:
            return True
        if score >= 0.84 and (cand in hit or hit in cand):
            return True
        head = cand.split()[0] if cand.split() else cand
        return bool(score >= 0.82 and len(head) >= 5 and hit.startswith(head))

    def _resolve_candidate_with_fuzzy(self, graph: Any, candidate: str) -> str | None:
        exact = getattr(graph, "drugs_normalized", {}).get(candidate.lower())
        if exact:
            return str(exact)
        fuzzy_search = getattr(graph, "fuzzy_search", None)
        if not callable(fuzzy_search):
            return None
        try:
            matches = fuzzy_search(candidate, threshold=0.55) or []
        except Exception:
            return None
        if not matches:
            best_name = None
        else:
            best_name, best_score = matches[0]
            if self._is_high_confidence_fuzzy_match(candidate, str(best_name), float(best_score)):
                return str(best_name)

        # Keep a permissive fallback for recall, but silence graph CLI prints.
        find_drug = getattr(graph, "find_drug", None)
        if callable(find_drug):
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    fallback = find_drug(candidate, interactive=False)
            except Exception:
                fallback = None
            if fallback:
                return str(fallback)
        return None

    def _load_graph_locked(self) -> None:
        if self._graph is not None:
            return
        if not settings.DRUG_GRAPH_ENABLED:
            return

        script_path = Path(settings.DRUG_GRAPH_SCRIPT_PATH).expanduser().resolve()
        data_root = Path(settings.DRUG_GRAPH_DATA_ROOT).expanduser().resolve()
        if not script_path.exists():
            logger.warning("[INTG][PHARMACY] Drug graph script missing: %s", script_path)
            return
        if not data_root.exists():
            logger.warning("[INTG][PHARMACY] Drug graph data root missing: %s", data_root)
            return

        module_name = "_chaticu_drug_graph_rag_bridge"
        try:
            spec = importlib.util.spec_from_file_location(module_name, str(script_path))
            if spec is None or spec.loader is None:
                logger.warning("[INTG][PHARMACY] Failed to import drug graph module from %s", script_path)
                return
            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)
            graph_cls = getattr(module, "DrugInteractionGraph", None)
            if graph_cls is None:
                logger.warning("[INTG][PHARMACY] DrugInteractionGraph not found in %s", script_path)
                return
            graph = graph_cls(str(data_root))
            graph.build_graph()
            self._graph = graph
            logger.info("[INTG][PHARMACY] Loaded DrugData graph from %s", data_root)
        except Exception as exc:
            logger.warning("[INTG][PHARMACY] Failed to initialize DrugData graph: %s", exc)

    def _get_graph(self) -> Any | None:
        if self._graph is not None:
            return self._graph
        with self._lock:
            if not self._load_attempted:
                self._load_attempted = True
                self._load_graph_locked()
        return self._graph

    def _resolve_drug_name(self, graph: Any, raw: str) -> str | None:
        candidates = self._build_query_candidates(raw)
        for candidate in candidates:
            matched = self._resolve_candidate_with_fuzzy(graph, candidate)
            if matched:
                return str(matched)
        return None

    def is_ready(self) -> bool:
        return self._get_graph() is not None

    def resolve_drug(self, raw: str) -> str | None:
        graph = self._get_graph()
        if graph is None:
            return None
        return self._resolve_drug_name(graph, raw)

    @staticmethod
    def _footnotes_to_reference(parsed_body: Any) -> str:
        footnotes = getattr(parsed_body, "footnotes", None)
        if not isinstance(footnotes, list):
            return ""
        cleaned = [str(x).strip() for x in footnotes if str(x).strip()]
        return " | ".join(cleaned[:3])

    def _interaction_to_api_row(self, interaction: Any) -> dict[str, Any]:
        risk = str(getattr(interaction, "risk_level", "") or "").upper()
        severity = _RISK_TO_SEVERITY.get(risk, "unknown")
        parsed = getattr(interaction, "parsed_body", None)
        summary = str(getattr(parsed, "summary", "") or "")
        management = str(getattr(parsed, "patient_management", "") or "")
        discussion = str(getattr(parsed, "discussion", "") or "")
        references = self._footnotes_to_reference(parsed)
        source_file = str(getattr(interaction, "source_file", "") or "")
        title = str(getattr(interaction, "title", "") or "")
        drug1 = str(getattr(interaction, "drug1", "") or "")
        drug2 = str(getattr(interaction, "drug2", "") or "")
        row_id = self._hash_id("graphint", [drug1.lower(), drug2.lower(), risk, title.lower()])
        return {
            "id": row_id,
            "drug1": drug1,
            "drug2": drug2,
            "severity": severity,
            "mechanism": discussion or summary,
            "clinicalEffect": summary,
            "management": management,
            "references": references or source_file,
            "source": "drug_graph",
            "riskLevel": risk,
            "title": title,
            "sourceFile": source_file,
        }

    def search_interactions(
        self,
        *,
        drug_a: str,
        drug_b: str | None,
        page: int,
        limit: int,
    ) -> list[dict[str, Any]]:
        graph = self._get_graph()
        if graph is None:
            return []

        resolved_a = self._resolve_drug_name(graph, drug_a)
        if not resolved_a:
            return []

        rows: list[dict[str, Any]] = []
        seen_ids: set[str] = set()

        if drug_b:
            resolved_b = self._resolve_drug_name(graph, drug_b)
            if not resolved_b:
                return []
            report = graph.check_drugs([resolved_a, resolved_b])
            for item in report.interactions:
                row = self._interaction_to_api_row(item)
                if row["id"] in seen_ids:
                    continue
                seen_ids.add(row["id"])
                rows.append(row)
        else:
            neighbors = list(graph.G.successors(resolved_a))
            for neighbor in neighbors:
                edge_data = graph.G.get_edge_data(resolved_a, neighbor) or {}
                for _key, attr in edge_data.items():
                    if attr.get("relation") != "INTERACTS_WITH":
                        continue
                    parsed = graph.parse_body(attr.get("body", ""))

                    class _SimpleInteraction:
                        pass

                    wrapped = _SimpleInteraction()
                    wrapped.drug1 = resolved_a
                    wrapped.drug2 = neighbor
                    wrapped.risk_level = attr.get("risk", "Unknown")
                    wrapped.title = attr.get("title", "")
                    wrapped.parsed_body = parsed
                    wrapped.source_file = attr.get("source", "")
                    row = self._interaction_to_api_row(wrapped)
                    if row["id"] in seen_ids:
                        continue
                    seen_ids.add(row["id"])
                    rows.append(row)

        rows.sort(
            key=lambda r: (
                -_SEVERITY_PRIORITY.get(str(r.get("severity", "unknown")).lower(), 0),
                str(r.get("drug2", "")).lower(),
                str(r.get("title", "")).lower(),
            )
        )
        offset = (page - 1) * limit
        return rows[offset: offset + limit]

    def _resolve_compat_name(self, graph: Any, raw: str) -> str | None:
        """Resolve a drug name against the Y-site compatibility matrix names.

        The interaction graph nodes use short names (e.g. 'Amiodarone') while
        the compatibility matrix uses full salt names (e.g. 'Amiodarone HCl').
        This method first tries the interaction graph resolver, then falls back
        to fuzzy-matching directly against the compatibility matrix drug names.
        """
        # 1. Try standard interaction-graph resolution first
        resolved = self._resolve_drug_name(graph, raw)
        compat_dict = getattr(graph, "y_site_compatibility", {})
        if not compat_dict:
            return resolved

        # Collect all unique drug names from the compatibility matrix keys
        compat_names: set[str] = set()
        for pair_key in compat_dict:
            if isinstance(pair_key, tuple) and len(pair_key) == 2:
                compat_names.update(pair_key)

        # 2. If resolved name already matches a compat name, use it directly
        if resolved and resolved.lower() in compat_names:
            return resolved

        # 3. Otherwise, fuzzy-match raw input against compat matrix names
        from difflib import SequenceMatcher
        candidates = self._build_query_candidates(raw)
        best_match = None
        best_score = 0.0
        for candidate in candidates:
            cl = candidate.lower()
            # Exact match
            if cl in compat_names:
                return candidate
            # Substring match (e.g. 'amiodarone' in 'amiodarone hcl')
            for cn in compat_names:
                if cl in cn or cn in cl:
                    ratio = SequenceMatcher(None, cl, cn).ratio()
                    if ratio > best_score:
                        best_score = ratio
                        best_match = cn
            # Fuzzy match
            for cn in compat_names:
                ratio = SequenceMatcher(None, cl, cn).ratio()
                if ratio > best_score:
                    best_score = ratio
                    best_match = cn

        if best_score >= 0.55 and best_match:
            # Find the original-cased name from the compat result objects
            for pair_key, compat_obj in compat_dict.items():
                for name_part in (getattr(compat_obj, "drug1", ""), getattr(compat_obj, "drug2", "")):
                    if name_part.lower() == best_match:
                        return name_part
            return best_match

        return resolved

    def check_compatibility(
        self,
        *,
        drug_a: str,
        drug_b: str,
        solution: str | None,
    ) -> dict[str, Any] | None:
        graph = self._get_graph()
        if graph is None:
            return None

        resolved_a = self._resolve_compat_name(graph, drug_a)
        resolved_b = self._resolve_compat_name(graph, drug_b)
        if not resolved_a or not resolved_b:
            return None

        compat = graph.get_compatibility(resolved_a, resolved_b)
        if compat is None:
            return None

        # sheet_name is a department (e.g. '一般內科'), NOT an IV solution.
        # Y-site compatibility is solution-agnostic; do not filter by solution.
        sheet_name = str(getattr(compat, "sheet_name", "") or "")

        status = str(getattr(compat, "status", "") or "")
        row_id = self._hash_id("graphcomp", [resolved_a.lower(), resolved_b.lower(), status, sheet_name.lower()])
        label = {"C": "相容", "I": "不相容", "-": "無資料"}.get(status, status)
        compatible_value: Optional[bool] = True if status == "C" else False if status == "I" else None
        return {
            "id": row_id,
            "drug1": str(getattr(compat, "drug1", resolved_a)),
            "drug2": str(getattr(compat, "drug2", resolved_b)),
            "solution": solution or "none",
            "compatible": compatible_value,
            "timeStability": None,
            "notes": str(getattr(compat, "status_description", "") or ""),
            "references": str(getattr(compat, "source_file", "") or ""),
            "source": "drug_graph",
            "status": status,
            "result": status,
            "label": label,
            "department": sheet_name,
        }


drug_graph_bridge = DrugGraphBridge()
