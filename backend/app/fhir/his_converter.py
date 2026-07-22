"""HIS JSON → ChatICU DB dict converter.

Converts raw HIS API responses (getPatient, getAllMedicine, getLabResult, etc.)
into dicts that can be directly inserted into ChatICU database tables.

Usage:
    from app.fhir.his_converter import HISConverter

    converter = HISConverter(patient_dir="/path/to/patient/50045203")
    patient = converter.convert_patient()
    medications = converter.convert_medications()
    lab_records = converter.convert_lab_data()

This module is a thin backward-compatible facade. The implementation now lives
in the :mod:`app.fhir.his` package, split into focused modules:

  - ``app.fhir.his.roc_time``          — 民國年 (ROC) date/time + id helpers
  - ``app.fhir.his.drug_dictionaries`` — freq/route maps + drug classification
  - ``app.fhir.his.lab_dictionaries``  — lab category map + ECG impression
  - ``app.fhir.his.resources``         — import-time resource loads
  - ``app.fhir.his.snapshot_io``       — filesystem snapshot read + cache
  - ``app.fhir.his.converter``         — the HISConverter orchestrator

All public symbols (HISConverter and the original module-level helpers) remain
importable from this path unchanged.
"""

# Public converter API.
from app.fhir.his.converter import HISConverter

# Re-export the original module-level helpers / constants so existing imports
# (and any monkeypatching tests) continue to resolve against this path.
from app.fhir.his.roc_time import (  # noqa: F401
    _gen_id,
    _normalize_patient_gender,
    _roc_birthday_to_age,
    _roc_to_date,
    _roc_to_datetime,
)
from app.fhir.his.drug_dictionaries import (  # noqa: F401
    _FREQ_MAP,
    _OPD_SW_MAP,
    _ROUTE_MAP,
    _classify_category,
    _classify_san,
    _clean_drug_name,
)
from app.fhir.his.lab_dictionaries import (  # noqa: F401
    _REP_TYPE_TO_CATEGORY,
    _build_ecg_impression,
)
from app.fhir.his.resources import (  # noqa: F401
    _DDI_ALIAS_MAP,
    _DDI_EXCLUSION_SET,
    _FILENAME_ALIASES,
    _FORMULARY_MAP,
    _SITE_CONFIG,
    _load_ddi_alias_map,
    _load_ddi_exclusion_set,
    _load_formulary,
    _load_site_config,
)

__all__ = ["HISConverter"]
