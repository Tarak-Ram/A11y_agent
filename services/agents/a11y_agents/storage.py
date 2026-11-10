"""Artifact storage behind one interface: local folder (dev) or GCS (prod)."""
from __future__ import annotations

import shutil
from pathlib import Path
from typing import Protocol

from .config import get_settings


class Storage(Protocol):
    def put(self, local_path: str | Path, key: str) -> str: ...


class LocalStorage:
    def __init__(self, root: str):
        self.root = Path(root)

    def put(self, local_path, key):
        dest = self.root / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(local_path, dest)
        return f"/files/{key}"  # served by the API's static handler


class GcsStorage:
    def __init__(self, bucket: str):
        from google.cloud import storage  # lazy: not needed in dev

        self.bucket = storage.Client().bucket(bucket)

    def put(self, local_path, key):
        blob = self.bucket.blob(key)
        blob.upload_from_filename(str(local_path))
        return f"https://storage.googleapis.com/{self.bucket.name}/{key}"


def get_storage() -> Storage:
    s = get_settings()
    if s.storage_driver == "gcs":
        return GcsStorage(s.gcs_bucket)
    return LocalStorage(s.storage_local_dir)
