PYTHON_BIN ?= ../.venv312/bin/python
SOURCE_DIR ?= ../rag 文本
HOST ?= 0.0.0.0
PORT ?= 8000
RUN_EVAL ?= 1

.PHONY: run quick pipeline ingest ingest-force eval api clinical-golden intent-test

run:
	@PYTHON_BIN="$(PYTHON_BIN)" SOURCE_DIR="$(SOURCE_DIR)" RUN_EVAL="$(RUN_EVAL)" HOST="$(HOST)" PORT="$(PORT)" ./run.sh

quick:
	@PYTHON_BIN="$(PYTHON_BIN)" SOURCE_DIR="$(SOURCE_DIR)" RUN_EVAL="0" HOST="$(HOST)" PORT="$(PORT)" ./run.sh

pipeline:
	@set -a; [ ! -f .env ] || . ./.env; set +a; $(PYTHON_BIN) -m evidence_rag.auto_ingest --source-dir "$(SOURCE_DIR)"
	@set -a; [ ! -f .env ] || . ./.env; set +a; if [ "$(RUN_EVAL)" = "1" ]; then $(PYTHON_BIN) -m evidence_rag.evaluate; fi

ingest:
	@set -a; [ ! -f .env ] || . ./.env; set +a; $(PYTHON_BIN) -m evidence_rag.auto_ingest --source-dir "$(SOURCE_DIR)"

ingest-force:
	@set -a; [ ! -f .env ] || . ./.env; set +a; $(PYTHON_BIN) -m evidence_rag.auto_ingest --source-dir "$(SOURCE_DIR)" --force

eval:
	@set -a; [ ! -f .env ] || . ./.env; set +a; $(PYTHON_BIN) -m evidence_rag.evaluate

api:
	@set -a; [ ! -f .env ] || . ./.env; set +a; $(PYTHON_BIN) -m uvicorn evidence_rag.api:app --host "$(HOST)" --port "$(PORT)"

clinical-golden:
	@set -a; [ ! -f .env ] || . ./.env; set +a; $(PYTHON_BIN) scripts/run_clinical_golden.py

intent-test:
	@set -a; [ ! -f .env ] || . ./.env; set +a; $(PYTHON_BIN) scripts/test_intent_classifier.py
