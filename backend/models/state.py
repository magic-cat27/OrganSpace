"""Organ state data models."""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Indicator:
    """A single physiological indicator."""
    name: str
    value: float
    unit: str
    normal_min: float
    normal_max: float
    description: str = ""

    @property
    def status(self) -> str:
        """Return 'normal', 'high', 'low', or 'critical'."""
        if self.value >= self.normal_max * 1.3 or self.value <= self.normal_min * 0.7:
            return "critical"
        if self.value > self.normal_max:
            return "high"
        if self.value < self.normal_min:
            return "low"
        return "normal"

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "value": self.value,
            "unit": self.unit,
            "normal_min": self.normal_min,
            "normal_max": self.normal_max,
            "status": self.status,
            "description": self.description,
        }


@dataclass
class OrganState:
    """Full state of one organ system."""
    organ_id: str
    organ_name: str
    indicators: dict[str, Indicator] = field(default_factory=dict)
    overall_status: str = "normal"  # normal, stressed, impaired, failing
    narrative: str = ""  # human-readable description of current state

    def get_abnormal_indicators(self) -> list[Indicator]:
        return [i for i in self.indicators.values() if i.status != "normal"]

    def to_dict(self) -> dict:
        return {
            "organ_id": self.organ_id,
            "organ_name": self.organ_name,
            "overall_status": self.overall_status,
            "narrative": self.narrative,
            "indicators": {k: v.to_dict() for k, v in self.indicators.items()},
            "abnormal_count": len(self.get_abnormal_indicators()),
        }
