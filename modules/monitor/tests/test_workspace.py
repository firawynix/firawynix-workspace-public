"""Validação das ferramentas locais do workspace."""

from pathlib import Path

import pytest

from config import settings as config_settings
from config.settings import parse_config
from config.workspace import (WorkspaceError, WorkspaceSettings, find_firawmerge,
                              load_workspace_settings, open_firawmerge, open_strigoi,
                              save_workspace_settings)
from core.monitor import MonitorManager


def test_settings_roundtrip_does_not_create_credentials(tmp_path):
    path = tmp_path / "workspace.json"
    settings = WorkspaceSettings("C:/Merge.exe", "C:/Strigoi.exe")
    save_workspace_settings(settings, path)
    assert load_workspace_settings(path) == settings
    assert "password" not in path.read_text(encoding="utf-8")


def test_explicit_missing_merge_exe_is_reported(tmp_path):
    with pytest.raises(WorkspaceError, match="Arquivo local não encontrado"):
        find_firawmerge(WorkspaceSettings(firawmerge_exe=str(tmp_path / "missing.exe")))


def test_explicit_merge_exe_is_used(tmp_path):
    exe = tmp_path / "Merge.exe"
    exe.write_bytes(b"MZ")
    assert find_firawmerge(WorkspaceSettings(firawmerge_exe=str(exe))) == Path(exe)


def test_merge_passes_only_selected_local_paths(tmp_path, monkeypatch):
    exe = tmp_path / "Merge.exe"
    exe.write_bytes(b"MZ")
    left, right = tmp_path / "left.txt", tmp_path / "right.txt"
    left.write_text("left")
    right.write_text("right")
    calls = []
    monkeypatch.setattr("config.workspace._start", lambda *args: calls.append(args))
    open_firawmerge(WorkspaceSettings(firawmerge_exe=str(exe)), str(left), str(right))
    assert calls == [(exe, str(left), str(right))]


def test_strigoi_opens_only_explicit_local_folder(tmp_path, monkeypatch):
    exe = tmp_path / "Strigoi.exe"
    exe.write_bytes(b"MZ")
    folder = tmp_path / "project"
    folder.mkdir()
    calls = []
    monkeypatch.setattr("config.workspace._start", lambda *args: calls.append(args))
    open_strigoi(WorkspaceSettings(strigoi_exe=str(exe)), str(folder))
    assert calls == [(exe, str(folder.resolve()))]


def test_merge_rejects_mixed_file_and_folder(tmp_path, monkeypatch):
    exe = tmp_path / "Merge.exe"
    exe.write_bytes(b"MZ")
    source = tmp_path / "source.txt"
    source.write_text("data")
    calls = []
    monkeypatch.setattr("config.workspace._start", lambda *args: calls.append(args))
    with pytest.raises(WorkspaceError, match="arquivos com arquivos"):
        open_firawmerge(WorkspaceSettings(firawmerge_exe=str(exe)), str(source), str(tmp_path))
    assert calls == []


def test_merge_rejects_unc_before_any_file_lookup(monkeypatch, tmp_path):
    exe = tmp_path / "Merge.exe"
    exe.write_bytes(b"MZ")
    monkeypatch.setattr("config.workspace._start", lambda *args: pytest.fail("process started"))
    with pytest.raises(WorkspaceError, match="disco local"):
        open_firawmerge(WorkspaceSettings(firawmerge_exe=str(exe)), r"\\server\share\a.txt", str(tmp_path))


def test_empty_workspace_starts_without_ssh_workers():
    config = parse_config({"servers": []})
    manager = MonitorManager(config)
    try:
        manager.start()
        assert manager.server_names == []
        assert manager.monitors == {}
    finally:
        manager.stop()


def test_first_run_creates_empty_config_without_servers(tmp_path, monkeypatch):
    target = tmp_path / "servers.json"
    monkeypatch.setattr(config_settings, "config_search_paths", lambda explicit=None: [target])
    monkeypatch.setattr(config_settings, "user_config_dir", lambda: tmp_path)
    monkeypatch.delenv(config_settings.CONFIG_ENV_VAR, raising=False)
    assert config_settings.find_or_create_config() == target
    assert config_settings.load_config(target).servers == ()
