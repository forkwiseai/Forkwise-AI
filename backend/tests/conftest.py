"""Every test run gets a fresh data folder, so rows written by one run (spending, invoices, seen transfers) cannot
make the next run fail. Set before any app module is imported."""
import os
import sys
import tempfile
from pathlib import Path

os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="forkwise-test-")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
