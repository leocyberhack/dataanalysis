from typing import Optional

from pydantic import BaseModel


class UpdateProfitRequest(BaseModel):
    profit: float


class ApproveOrderRequest(BaseModel):
    profit: Optional[float] = None
