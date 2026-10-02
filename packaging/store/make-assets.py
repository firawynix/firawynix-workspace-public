"""Gera os tamanhos exigidos pelo manifesto a partir do ícone do Monitor."""

from pathlib import Path
import sys

from PIL import Image

source = Path(sys.argv[1])
destination = Path(sys.argv[2])
destination.mkdir(parents=True, exist_ok=True)
with Image.open(source) as icon:
    for name, size in (("StoreLogo.png", 50), ("Square150x150Logo.png", 150), ("Square44x44Logo.png", 44)):
        icon.resize((size, size), Image.Resampling.LANCZOS).save(destination / name)
