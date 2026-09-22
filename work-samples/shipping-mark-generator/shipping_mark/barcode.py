"""Thread-safe barcode image client with in-memory caching.

The remote service is expected to accept a POST field ``skuList`` and return a
ZIP archive that contains a PNG. The client degrades gracefully: any network or
decoding error simply yields ``None`` so report generation never fails because a
single image could not be retrieved.
"""

from __future__ import annotations

import io
import zipfile
from threading import Lock
from typing import Callable, Optional

import requests
from PIL import Image as PILImage

from . import config

_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_ZIP_MAGIC = b"PK\x03\x04"


class BarcodeClient:
    """Fetches and caches barcode images keyed by SKU."""

    def __init__(self, log: Callable[[str], None] = print) -> None:
        self._cache: dict[str, PILImage.Image] = {}
        self._lock = Lock()
        self._log = log

    def get(self, sku: object) -> Optional[PILImage.Image]:
        if not sku or str(sku).strip() == "":
            return None
        key = str(sku).strip()

        with self._lock:
            if key in self._cache:
                return self._cache[key]

        image = self._fetch(key)
        if image is not None:
            with self._lock:
                self._cache[key] = image
        return image

    # ------------------------------------------------------------------ #
    def _fetch(self, sku: str) -> Optional[PILImage.Image]:
        try:
            resp = requests.post(
                config.BARCODE_API_URL,
                data={"skuList": sku},
                timeout=config.BARCODE_TIMEOUT,
            )
            resp.raise_for_status()

            if len(resp.content) < 4 or resp.content[:4] != _ZIP_MAGIC:
                self._log(f"[{sku}] invalid response (not a ZIP archive)")
                return None

            with zipfile.ZipFile(io.BytesIO(resp.content)) as archive:
                names = archive.namelist()
                if not names:
                    return None
                with archive.open(self._pick_png(names, sku)) as member:
                    data = member.read()
            if len(data) >= 8 and data[:8] == _PNG_MAGIC:
                return PILImage.open(io.BytesIO(data))
        except Exception as exc:  # noqa: BLE001 - intentionally broad, log & skip
            self._log(f"[{sku}] barcode error: {exc}")
        return None

    @staticmethod
    def _pick_png(names: list[str], sku: str) -> str:
        sku_lower = sku.lower()
        for name in names:
            if name.lower().endswith(".png") and sku_lower in name.lower():
                return name
        for name in names:
            if name.lower().endswith(".png"):
                return name
        return names[0]
