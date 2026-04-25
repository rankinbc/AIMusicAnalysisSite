import uuid
from pathlib import Path
from typing import Protocol

import aiofiles
from fastapi import UploadFile

from ..config import settings

CHUNK_SIZE = 1024 * 1024  # 1 MB


class StorageBackend(Protocol):
    async def save(self, file: UploadFile, prefix: str = "") -> str: ...
    def get_path(self, key: str) -> Path: ...


class LocalStorage:
    def __init__(self, upload_dir: Path):
        self.upload_dir = upload_dir
        upload_dir.mkdir(parents=True, exist_ok=True)

    async def save(self, file: UploadFile, prefix: str = "") -> str:
        """Chunk-reads UploadFile in 1 MB pieces — never calls file.read() in one shot."""
        file_id = str(uuid.uuid4())
        safe_name = Path(file.filename or "upload").name
        key = f"{file_id}_{prefix}{safe_name}"
        dest = self.upload_dir / key
        async with aiofiles.open(dest, "wb") as f:
            while True:
                chunk = await file.read(CHUNK_SIZE)
                if not chunk:
                    break
                await f.write(chunk)
        return key

    def get_path(self, key: str) -> Path:
        return self.upload_dir / key


def get_storage() -> LocalStorage:
    return LocalStorage(settings.UPLOAD_DIR)
