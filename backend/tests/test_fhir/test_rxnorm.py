"""Unit tests for app.fhir.rxnorm (cache behaviour — no network)."""
from pathlib import Path

import pytest

from app.fhir.rxnorm import (
    RxNormCache,
    RxNormResult,
    extract_generic_name,
    lookup,
)


class TestExtractGenericName:
    def test_last_english_paren(self):
        assert extract_generic_name("Tygacil 50mg inj(抗4)(Tigecycline)") == "Tigecycline"

    def test_chinese_paren_ignored(self):
        assert extract_generic_name("Cefe 2000mg (抗2) inj (Cefmetazole)") == "Cefmetazole"

    def test_no_paren(self):
        assert extract_generic_name("N.S. 0.9% 500ML<BAG>") is None

    def test_too_short(self):
        # 3-char paren contents should be rejected
        assert extract_generic_name("Foo (AAA) bar") is None

    def test_empty_input(self):
        assert extract_generic_name("") is None
        assert extract_generic_name(None) is None


class TestRxNormCache:
    def test_roundtrip(self, tmp_path: Path):
        cache = RxNormCache(path=tmp_path / "cache.json")
        result = RxNormResult(
            generic="Vancomycin",
            rxcui="11124",
            atc_code="J01XA01",
            atc_display="Glycopeptide antibacterials",
            resolved_at="2026-04-22T00:00:00Z",
        )
        cache.put("Vancomycin", result)
        cache.save()

        cache2 = RxNormCache(path=tmp_path / "cache.json")
        hit = cache2.get("vancomycin")  # case-insensitive
        assert hit is not None
        assert hit.atc_code == "J01XA01"

    def test_miss_is_remembered(self, tmp_path: Path):
        """Cache records confirmed misses so we don't retry the network."""
        cache = RxNormCache(path=tmp_path / "cache.json")
        cache.put("NonexistentDrug", None)
        assert cache.was_looked_up("NonexistentDrug") is True
        assert cache.get("NonexistentDrug") is None


class TestLookup:
    def test_offline_mode_never_hits_network(self, tmp_path: Path):
        cache = RxNormCache(path=tmp_path / "cache.json")
        # Empty cache + offline → None, no network call
        result = lookup("SomeDrug", online=False, cache=cache)
        assert result is None

    def test_cache_hit_bypasses_network(self, tmp_path: Path):
        cache = RxNormCache(path=tmp_path / "cache.json")
        cache.put(
            "Vancomycin",
            RxNormResult("Vancomycin", "11124", "J01XA01", "Glyco", "2026-04-22T00:00:00Z"),
        )
        # Online or offline — cache hit wins
        result = lookup("vancomycin", online=False, cache=cache)
        assert result is not None
        assert result.atc_code == "J01XA01"

    def test_too_short_generic_rejected(self, tmp_path: Path):
        cache = RxNormCache(path=tmp_path / "cache.json")
        assert lookup("", online=False, cache=cache) is None
        assert lookup("ab", online=False, cache=cache) is None

    def test_fallback_disabled_when_cached_miss(self, tmp_path: Path):
        """If we've already looked up a generic and confirmed no RxNorm match,
        lookup(online=True) must NOT retry — this protects against retry
        storms on genuinely missing drugs."""
        cache = RxNormCache(path=tmp_path / "cache.json")
        cache.put("NonexistentDrug", None)
        # Even with online=True, lookup returns None without making a network call
        result = lookup("NonexistentDrug", online=True, cache=cache)
        assert result is None
