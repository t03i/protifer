"""Unit tests for infra/triton/init_models.py hardening (Phase 20).

Tests: SHA256 pre-extract verification, onnx.checker integration,
       idempotence marker, per-artifact error summary, extraction target fix.
"""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Make init_models importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import init_models  # noqa: E402


class TestShaVerification:
    def test_sha_mismatch_aborts_without_extract(self, tmp_path, corrupt_archive):
        """D-11: corrupt download must not leave a file after SHA mismatch."""
        archive_path, wrong_sha = corrupt_archive("fake_model")
        tmp_out = tmp_path / "output.tar.gz"

        # Mock httpx.stream to return the archive bytes
        archive_bytes = archive_path.read_bytes()

        mock_response = MagicMock()
        mock_response.__enter__ = lambda s: s
        mock_response.__exit__ = MagicMock(return_value=False)
        mock_response.raise_for_status = MagicMock()
        mock_response.iter_bytes = MagicMock(return_value=[archive_bytes])

        with patch("init_models.httpx.stream", return_value=mock_response):
            result = init_models.download_and_verify(
                "https://example.com/fake_model-v1.tar.gz", tmp_out, wrong_sha
            )

        assert result is False, "SHA mismatch should return False"
        assert not tmp_out.exists(), "tmp file should be removed on SHA mismatch"

    def test_sha_match_proceeds_to_extract(self, tmp_path, sample_archive):
        """D-11: matching SHA allows the download to succeed."""
        archive_path, correct_sha = sample_archive("fake_model")
        tmp_out = tmp_path / "output.tar.gz"

        archive_bytes = archive_path.read_bytes()

        mock_response = MagicMock()
        mock_response.__enter__ = lambda s: s
        mock_response.__exit__ = MagicMock(return_value=False)
        mock_response.raise_for_status = MagicMock()
        mock_response.iter_bytes = MagicMock(return_value=[archive_bytes])

        with patch("init_models.httpx.stream", return_value=mock_response):
            result = init_models.download_and_verify(
                "https://example.com/fake_model-v1.tar.gz", tmp_out, correct_sha
            )

        assert result is True, "Correct SHA should return True"
        assert tmp_out.exists(), "Output file should exist on SHA match"


class TestSidecarFetch:
    def test_parses_two_space_format(self):
        """Standard sha256sum format: '<64-hex>  <filename>'."""
        sha = "a" * 64
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.text = f"{sha}  fake_model-v1.tar.gz\n"

        with patch("init_models.httpx.get", return_value=mock_response):
            result = init_models.fetch_sidecar_sha256("https://example.com/model.sha256")

        assert result == sha

    def test_parses_one_space_format(self):
        """Resilience: single-space variant should still parse correctly."""
        sha = "b" * 64
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.text = f"{sha} fake_model-v1.tar.gz\n"

        with patch("init_models.httpx.get", return_value=mock_response):
            result = init_models.fetch_sidecar_sha256("https://example.com/model.sha256")

        assert result == sha

    def test_rejects_malformed_hash_length(self):
        """Sidecar with wrong-length hash must raise ValueError.

        WR-03: switched from `assert` to `raise ValueError` so the check
        survives python -O / PYTHONOPTIMIZE=1.
        """
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.text = "too_short  filename.tar.gz\n"

        with patch("init_models.httpx.get", return_value=mock_response):
            with pytest.raises(ValueError, match="Malformed sidecar"):
                init_models.fetch_sidecar_sha256("https://example.com/model.sha256")


class TestIdempotence:
    def test_skip_if_marker_matches(self, tmp_model_repo, monkeypatch):
        """D-13: already-installed artifact with matching marker is skipped."""
        monkeypatch.setattr(init_models, "MODEL_REPO_PATH", tmp_model_repo)

        folder_name = "my_model"
        sha = "c" * 64
        marker_dir = tmp_model_repo / folder_name
        marker_dir.mkdir(parents=True)
        (marker_dir / ".installed-sha256").write_text(sha + "\n")

        assert init_models.is_already_installed(folder_name, sha) is True

    def test_reinstall_if_marker_mismatches(self, tmp_model_repo, monkeypatch):
        """D-13: stale marker (different SHA) triggers re-download."""
        monkeypatch.setattr(init_models, "MODEL_REPO_PATH", tmp_model_repo)

        folder_name = "my_model"
        marker_dir = tmp_model_repo / folder_name
        marker_dir.mkdir(parents=True)
        (marker_dir / ".installed-sha256").write_text("X" * 64 + "\n")

        assert init_models.is_already_installed(folder_name, "Y" * 64) is False

    def test_no_marker_triggers_install(self, tmp_model_repo, monkeypatch):
        """D-13: no marker file means not installed."""
        monkeypatch.setattr(init_models, "MODEL_REPO_PATH", tmp_model_repo)

        folder_name = "my_model"
        (tmp_model_repo / folder_name).mkdir(parents=True)

        assert init_models.is_already_installed(folder_name, "d" * 64) is False


class TestOnnxChecker:
    def test_no_model_onnx_passes_with_reason(self, tmp_model_repo, monkeypatch):
        """D-12: ensemble/tokenizer dirs with no model.onnx skip gracefully."""
        monkeypatch.setattr(init_models, "MODEL_REPO_PATH", tmp_model_repo)

        folder_name = "ensemble_model"
        model_dir = tmp_model_repo / folder_name / "1"
        model_dir.mkdir(parents=True)
        # No model.onnx — only config.pbtxt
        (tmp_model_repo / folder_name / "config.pbtxt").write_text("name: ensemble_model\n")

        ok, reason = init_models.validate_onnx_if_present(folder_name)

        assert ok is True
        assert "no model.onnx" in reason

    def test_invalid_onnx_returns_error(self, tmp_model_repo, monkeypatch):
        """D-12: garbage bytes in model.onnx trigger checker failure."""
        monkeypatch.setattr(init_models, "MODEL_REPO_PATH", tmp_model_repo)

        folder_name = "bad_model"
        model_dir = tmp_model_repo / folder_name / "1"
        model_dir.mkdir(parents=True)
        # Write garbage bytes — not a valid ONNX proto
        (model_dir / "model.onnx").write_bytes(b"\x00\x01\x02garbage content")

        ok, reason = init_models.validate_onnx_if_present(folder_name)

        assert ok is False
        assert reason.startswith("onnx.checker:") or reason.startswith("unexpected:")


class TestExtractionTarget:
    def test_extracts_to_model_repo_root_not_version_subdir(
        self, tmp_model_repo, sample_archive
    ):
        """Regression test for 20-RESEARCH.md §Summary finding #1.

        Archives are rooted at {folder_name}/, so extraction must target MODEL_REPO_PATH.
        Extracting to a version subdir would produce double-nesting:
        MODEL_REPO_PATH/{folder}/1/{folder}/config.pbtxt (wrong)
        MODEL_REPO_PATH/{folder}/config.pbtxt (correct)
        """
        archive_path, _sha = sample_archive("fake_model")

        result = init_models.extract_archive(archive_path, tmp_model_repo)

        assert result is True
        # Correct layout: MODEL_REPO_PATH/fake_model/config.pbtxt
        assert (tmp_model_repo / "fake_model" / "config.pbtxt").exists(), (
            "config.pbtxt should be at model_repo/fake_model/config.pbtxt (not double-nested)"
        )
        assert (tmp_model_repo / "fake_model" / "1" / "model.txt").exists(), (
            "model.txt should be at model_repo/fake_model/1/model.txt"
        )
        # Negative: ensure double-nesting does NOT exist
        assert not (tmp_model_repo / "fake_model" / "1" / "fake_model").exists(), (
            "Double-nesting fake_model/1/fake_model/ must NOT exist"
        )


class TestErrorSummary:
    def test_summary_lists_all_failures(self, caplog):
        """D-15: print_error_summary emits one row per ArtifactError."""
        import logging

        errors = [
            init_models.ArtifactError(
                folder="vespag", stage="sha_mismatch", cause="expected abc, got def"
            ),
            init_models.ArtifactError(
                folder="seth", stage="onnx_checker", cause="onnx.checker: Node 'X' error"
            ),
            init_models.ArtifactError(
                folder="tmbed", stage="download", cause="timeout"
            ),
        ]

        with caplog.at_level(logging.ERROR, logger="init_models"):
            init_models.print_error_summary(errors)

        log_text = "\n".join(caplog.messages)
        assert "vespag" in log_text
        assert "seth" in log_text
        assert "tmbed" in log_text
        assert "ARTIFACT FAILURE SUMMARY" in log_text

    def test_empty_errors_no_summary(self, caplog):
        """D-15: empty error list produces no log output."""
        import logging

        with caplog.at_level(logging.ERROR, logger="init_models"):
            init_models.print_error_summary([])

        assert len(caplog.records) == 0, "No log records should be emitted for empty errors"
