from pydantic import BaseModel


class UploadResponse(BaseModel):
    job_id: str
