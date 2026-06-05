"""Unit tests for preflight_nvidia() in init_models.py (Phase 22 D-18).

Contract pinned by this Wave 0 test file; implementation lands in Plan 02.

preflight_nvidia() contract:
  - REQUIRE_NVIDIA=false or unset → returns None, logs "skipping NVIDIA preflight"
  - REQUIRE_NVIDIA=true + shutil.which('nvidia-smi') is None → sys.exit(2)
  - REQUIRE_NVIDIA=true + subprocess.run returncode != 0 → sys.exit(2)
  - REQUIRE_NVIDIA=true + subprocess.run returncode == 0 → returns None, logs "NVIDIA preflight OK"
"""
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# Make init_models importable — same pattern as test_init_models.py.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import init_models  # noqa: E402


class TestPreflightNvidia:
    """D-18: REQUIRE_NVIDIA env gate on nvidia-smi probe."""

    def test_require_false_skips(self, monkeypatch, caplog):
        """REQUIRE_NVIDIA=false → no exit, logs skip message."""
        monkeypatch.setenv("REQUIRE_NVIDIA", "false")
        # Should not raise SystemExit or any other exception.
        init_models.preflight_nvidia()
        # Log message contains 'skipping' for the false/staging path.
        assert any("skipping" in record.message.lower() for record in caplog.records), (
            f"Expected log message containing 'skipping'; got {[r.message for r in caplog.records]}"
        )

    def test_require_unset_skips(self, monkeypatch):
        """REQUIRE_NVIDIA unset → behaves as false (default)."""
        monkeypatch.delenv("REQUIRE_NVIDIA", raising=False)
        # Should not raise.
        init_models.preflight_nvidia()

    def test_require_true_missing_binary_exits_2(self, monkeypatch):
        """REQUIRE_NVIDIA=true + nvidia-smi absent → sys.exit(2)."""
        monkeypatch.setenv("REQUIRE_NVIDIA", "true")
        with patch("init_models.shutil.which", return_value=None):
            with pytest.raises(SystemExit) as exc_info:
                init_models.preflight_nvidia()
        assert exc_info.value.code == 2, (
            f"Expected exit code 2 on missing nvidia-smi; got {exc_info.value.code}"
        )

    def test_require_true_binary_ok_passes(self, monkeypatch):
        """REQUIRE_NVIDIA=true + nvidia-smi returns 0 → no exit."""
        monkeypatch.setenv("REQUIRE_NVIDIA", "true")
        # Build a minimal CompletedProcess-like mock.
        mock_result = type("R", (), {"returncode": 0, "stdout": "NVIDIA A10\n", "stderr": ""})()
        with patch("init_models.shutil.which", return_value="/usr/bin/nvidia-smi"), \
             patch("init_models.subprocess.run", return_value=mock_result):
            # Should not raise.
            init_models.preflight_nvidia()

    def test_require_true_binary_rc_nonzero_exits_2(self, monkeypatch):
        """REQUIRE_NVIDIA=true + nvidia-smi returns rc != 0 → sys.exit(2)."""
        monkeypatch.setenv("REQUIRE_NVIDIA", "true")
        mock_result = type("R", (), {"returncode": 9, "stdout": "", "stderr": "driver err"})()
        with patch("init_models.shutil.which", return_value="/usr/bin/nvidia-smi"), \
             patch("init_models.subprocess.run", return_value=mock_result):
            with pytest.raises(SystemExit) as exc_info:
                init_models.preflight_nvidia()
        assert exc_info.value.code == 2

    def test_require_true_case_insensitive(self, monkeypatch):
        """REQUIRE_NVIDIA=TRUE (uppercase) → same behavior as true."""
        monkeypatch.setenv("REQUIRE_NVIDIA", "TRUE")
        with patch("init_models.shutil.which", return_value=None):
            with pytest.raises(SystemExit) as exc_info:
                init_models.preflight_nvidia()
        assert exc_info.value.code == 2

    def test_require_true_subprocess_is_called_with_query_args(self, monkeypatch):
        """REQUIRE_NVIDIA=true → subprocess.run invoked with nvidia-smi --query-gpu=name."""
        monkeypatch.setenv("REQUIRE_NVIDIA", "true")
        mock_result = type("R", (), {"returncode": 0, "stdout": "NVIDIA A10\n", "stderr": ""})()
        with patch("init_models.shutil.which", return_value="/usr/bin/nvidia-smi"), \
             patch("init_models.subprocess.run", return_value=mock_result) as mock_run:
            init_models.preflight_nvidia()
        assert mock_run.called, "subprocess.run should be called on the true path"
        call_args = mock_run.call_args[0][0]
        assert call_args[0] == "nvidia-smi"
        assert "--query-gpu=name" in call_args, (
            f"Expected --query-gpu=name in nvidia-smi args; got {call_args}"
        )
