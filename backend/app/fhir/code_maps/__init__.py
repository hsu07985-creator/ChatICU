"""Reference code maps: hospital formulary, RxNorm cache, etc.

CSV files in this directory are the canonical code lookup sources for the
backend. See backend/scripts/build_formulary_csv.py for how drug_formulary.csv
is produced from the hospital formulary spreadsheet.
"""
from pathlib import Path

CODE_MAPS_DIR = Path(__file__).parent
