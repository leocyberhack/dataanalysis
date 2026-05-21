from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class UpdateProfitRequest(BaseModel):
    profit: float


class ApproveOrderRequest(BaseModel):
    profit: Optional[float] = None


class PlanCreateRequest(BaseModel):
    name: Optional[str] = ""
    metric: str
    target_value: Optional[float] = None
    month_targets: Dict[str, float] = Field(default_factory=dict)
    poi_mode: str = "all"
    poi_names: List[str] = Field(default_factory=list)
    months: List[str]
