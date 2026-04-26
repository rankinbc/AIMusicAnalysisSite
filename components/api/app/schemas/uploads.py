from pydantic import BaseModel


class StemMappingProposalDTO(BaseModel):
    file: str
    proposed_role: str
    proposed_als_track: str | None
    confidence: float


class UploadResponse(BaseModel):
    job_id: str
    status: str = "PENDING"
    proposed_mapping: list[StemMappingProposalDTO] | None = None
    als_track_names: list[str] | None = None
