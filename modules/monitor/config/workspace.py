"""Ferramentas locais do monitor."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

from config.settings import app_base_dir, user_config_dir


class WorkspaceError(Exception):
    """Uma integração não está configurada ou não pôde ser iniciada."""


@dataclass(frozen=True)
class WorkspaceSettings:
    firawmerge_exe: str = ""
    strigoi_exe: str = ""


def settings_path() -> Path:
    return user_config_dir() / "workspace.json"


def load_workspace_settings(path: Path | None = None) -> WorkspaceSettings:
    path = path or settings_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return WorkspaceSettings()
    except (OSError, json.JSONDecodeError) as exc:
        raise WorkspaceError(f"Não foi possível ler {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise WorkspaceError(f"Configuração inválida em {path}.")
    return WorkspaceSettings(
        firawmerge_exe=str(data.get("firawmerge_exe", "")).strip(),
        strigoi_exe=str(data.get("strigoi_exe", "")).strip(),
    )


def _save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def save_workspace_settings(settings: WorkspaceSettings, path: Path | None = None) -> None:
    _save_json(path or settings_path(), asdict(WorkspaceSettings(
        firawmerge_exe=settings.firawmerge_exe.strip(), strigoi_exe=settings.strigoi_exe.strip())))


def _existing_exe(configured: str, candidates: list[Path]) -> Path | None:
    if configured:
        chosen = Path(configured).expanduser()
        if chosen.suffix.lower() != ".exe":
            raise WorkspaceError(f"Selecione um executável .exe: {chosen}")
        return _local_path(configured, directory=False)
    return next((candidate for candidate in candidates if candidate.is_file()), None)


def find_firawmerge(settings: WorkspaceSettings) -> Path | None:
    base = app_base_dir()
    home = Path.home()
    workspace_root = Path(__file__).resolve().parents[3]
    releases = sorted((workspace_root / "modules" / "firawmerge" / "release").glob("FirawMerge-*-x64.exe"), reverse=True)
    releases.extend(sorted((home / "FirawMerge" / "release").glob("FirawMerge-*-x64.exe"), reverse=True))
    return _existing_exe(settings.firawmerge_exe, [base / "tools" / "FirawMerge.exe", *releases])


def find_strigoi(settings: WorkspaceSettings) -> Path | None:
    base = app_base_dir()
    home = Path.home()
    workspace_root = Path(__file__).resolve().parents[3]
    source = home / "Downloads" / "strigoi-main" / "strigoi-main"
    return _existing_exe(settings.strigoi_exe, [
        base / "tools" / "Strigoi" / "Strigoi.exe",
        workspace_root / "modules" / "ide" / "dist" / "win-unpacked" / "Strigoi.exe",
        source / "dist" / "win-unpacked" / "Strigoi.exe",
        home / "AppData" / "Local" / "Programs" / "Strigoi" / "Strigoi.exe",
    ])


def _start(exe: Path, *args: str) -> None:
    if sys.platform != "win32":
        raise WorkspaceError("Os módulos locais estão disponíveis no Windows.")
    try:
        subprocess.Popen([str(exe), *args], cwd=str(exe.parent), close_fds=True)
    except OSError as exc:
        raise WorkspaceError(f"Não foi possível iniciar {exe.name}: {exc}") from exc


def _local_path(value: str, *, directory: bool | None = None) -> Path:
    """Evita UNC e unidades de rede antes mesmo de consultar a existência."""
    chosen = Path(value).expanduser()
    if sys.platform == "win32":
        import ctypes

        absolute = chosen.absolute()
        if str(absolute).startswith(("\\\\", "//")) or not absolute.drive:
            raise WorkspaceError("Escolha um caminho em um disco local, não uma pasta de rede.")
        drive_root = absolute.drive + "\\"
        if ctypes.windll.kernel32.GetDriveTypeW(drive_root) != 3:  # DRIVE_FIXED
            raise WorkspaceError("Escolha um caminho em um disco local, não uma unidade de rede.")
    if directory is True and not chosen.is_dir():
        raise WorkspaceError(f"Pasta local não encontrada: {chosen}")
    if directory is False and not chosen.is_file():
        raise WorkspaceError(f"Arquivo local não encontrado: {chosen}")
    if directory is None and not chosen.exists():
        raise WorkspaceError(f"Item local não encontrado: {chosen}")
    return chosen.resolve()


def open_firawmerge(settings: WorkspaceSettings, *paths: str) -> None:
    exe = find_firawmerge(settings)
    if exe is None:
        raise WorkspaceError("FirawMerge não encontrado. Selecione o executável portátil em Integrações.")
    if not 2 <= len(paths) <= 3:
        raise WorkspaceError("Selecione dois ou três arquivos ou pastas locais.")
    selected = [_local_path(p) for p in paths]
    if any(p.is_dir() != selected[0].is_dir() for p in selected[1:]):
        raise WorkspaceError("Compare arquivos com arquivos ou pastas com pastas.")
    _start(exe, *(str(p) for p in selected))


def open_strigoi(settings: WorkspaceSettings, folder: str | None = None) -> None:
    exe = find_strigoi(settings)
    if exe is None:
        raise WorkspaceError("Firawynix Workspace IDE não encontrada. Compile ou instale a IDE e informe seu executável em Integrações.")
    if folder:
        _start(exe, str(_local_path(folder, directory=True)))
    else:
        _start(exe)
