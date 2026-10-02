"""Configuração das ferramentas locais."""

from __future__ import annotations

from tkinter import filedialog

import customtkinter as ctk

from config.workspace import (WorkspaceError, WorkspaceSettings,
                              open_firawmerge, save_workspace_settings)
from ui import theme


class WorkspaceDialog(ctk.CTkToplevel):
    def __init__(self, parent, settings: WorkspaceSettings, on_save) -> None:
        super().__init__(parent)
        self.title("Ferramentas locais")
        self.geometry("740x330")
        self.minsize(650, 310)
        self.transient(parent)
        self.grab_set()
        self._on_save = on_save
        self.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(self, text="Ferramentas locais", font=ctk.CTkFont(size=20, weight="bold"))\
            .grid(row=0, column=0, columnspan=3, sticky="w", padx=20, pady=(20, 4))
        ctk.CTkLabel(self, text="A IDE e o FirawMerge usam apenas pastas e arquivos escolhidos neste PC.",
                     text_color=theme.TEXT_SECONDARY, anchor="w")\
            .grid(row=1, column=0, columnspan=3, sticky="ew", padx=20, pady=(0, 18))

        self._merge = self._field(2, "FirawMerge (.exe)", settings.firawmerge_exe,
                                 "Detectado automaticamente quando vazio", browse=True)
        self._strigoi = self._field(3, "Firawynix Workspace IDE (.exe)", settings.strigoi_exe,
                                   "Detectado automaticamente quando vazio", browse=True)
        self._error = ctk.CTkLabel(self, text="", text_color=("#cf222e", "#ff6b6b"), anchor="w", wraplength=690)
        self._error.grid(row=4, column=0, columnspan=3, sticky="ew", padx=20, pady=(14, 4))
        actions = ctk.CTkFrame(self, fg_color="transparent")
        actions.grid(row=5, column=0, columnspan=3, sticky="e", padx=20, pady=(8, 20))
        ctk.CTkButton(actions, text="Cancelar", command=self.destroy, fg_color=theme.NEUTRAL,
                      hover_color=theme.NEUTRAL_HOVER, text_color=theme.TEXT, width=100).pack(side="left", padx=5)
        ctk.CTkButton(actions, text="Salvar", command=self._save, width=100).pack(side="left", padx=5)
        self.after(50, self.focus_force)

    def _field(self, row: int, label: str, value: str, placeholder: str, *, browse: bool = False):
        ctk.CTkLabel(self, text=label, anchor="w", width=145).grid(row=row, column=0, sticky="w", padx=(20, 8), pady=9)
        entry = ctk.CTkEntry(self, placeholder_text=placeholder)
        entry.insert(0, value)
        entry.grid(row=row, column=1, sticky="ew", padx=(0, 8), pady=9)
        if browse:
            ctk.CTkButton(self, text="Procurar…", width=90,
                          command=lambda: self._browse(entry)).grid(row=row, column=2, padx=(0, 20), pady=9)
        return entry

    def _browse(self, entry) -> None:
        filename = filedialog.askopenfilename(parent=self, title="Escolha o executável do aplicativo",
                                              filetypes=[("Aplicativo Windows", "*.exe")])
        if filename:
            entry.delete(0, "end")
            entry.insert(0, filename)

    def _save(self) -> None:
        settings = WorkspaceSettings(self._merge.get(), self._strigoi.get())
        try:
            save_workspace_settings(settings)
        except (WorkspaceError, OSError) as exc:
            self._error.configure(text=str(exc))
            return
        self._on_save(settings)
        self.destroy()


class LocalMergeDialog(ctk.CTkToplevel):
    """Passa somente arquivos/pastas locais escolhidos ao FirawMerge."""

    def __init__(self, parent, settings: WorkspaceSettings, on_open) -> None:
        super().__init__(parent)
        self.title("Comparação local")
        self.geometry("770x350")
        self.minsize(680, 330)
        self.transient(parent)
        self.grab_set()
        self._settings = settings
        self._on_open = on_open
        self.grid_columnconfigure(1, weight=1)
        ctk.CTkLabel(self, text="Comparar no FirawMerge", font=ctk.CTkFont(size=20, weight="bold"))\
            .grid(row=0, column=0, columnspan=3, sticky="w", padx=20, pady=(20, 4))
        ctk.CTkLabel(self, text="Escolha dois ou três itens locais para comparar no computador.",
                     text_color=theme.TEXT_SECONDARY).grid(row=1, column=0, columnspan=3, sticky="w", padx=20)
        self._kind = ctk.CTkOptionMenu(self, values=["Arquivos", "Pastas"], width=120)
        self._kind.grid(row=2, column=0, sticky="w", padx=20, pady=(16, 5))
        self._entries = []
        for row in range(3, 6):
            ctk.CTkLabel(self, text=f"Item {row - 2}").grid(row=row, column=0, sticky="w", padx=20, pady=5)
            entry = ctk.CTkEntry(self, placeholder_text="Caminho local")
            entry.grid(row=row, column=1, sticky="ew", padx=(0, 8), pady=5)
            self._entries.append(entry)
            ctk.CTkButton(self, text="Procurar…", width=90,
                          command=lambda e=entry: self._browse(e)).grid(row=row, column=2, padx=(0, 20), pady=5)
        self._error = ctk.CTkLabel(self, text="", text_color=("#cf222e", "#ff6b6b"), anchor="w")
        self._error.grid(row=6, column=0, columnspan=3, sticky="ew", padx=20, pady=(10, 0))
        ctk.CTkButton(self, text="Comparar", command=self._open).grid(row=7, column=2, padx=20, pady=(5, 16))

    def _browse(self, entry) -> None:
        chosen = (filedialog.askopenfilename(parent=self) if self._kind.get() == "Arquivos"
                  else filedialog.askdirectory(parent=self))
        if chosen:
            entry.delete(0, "end")
            entry.insert(0, chosen)

    def _open(self) -> None:
        paths = [entry.get().strip() for entry in self._entries if entry.get().strip()]
        if len(paths) < 2:
            self._error.configure(text="Escolha pelo menos dois itens locais.")
            return
        try:
            open_firawmerge(self._settings, *paths)
        except WorkspaceError as exc:
            self._error.configure(text=str(exc))
            return
        self._on_open()
        self.destroy()
