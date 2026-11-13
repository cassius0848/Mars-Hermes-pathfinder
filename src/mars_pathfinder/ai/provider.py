"""Provider boundary and offline MockProvider / provider 边界与离线模拟器。"""

from __future__ import annotations

from typing import Protocol

from mars_pathfinder.ai.guardrails import validate_recommendation
from mars_pathfinder.ai.schemas import MissionContext, Recommendation


class AIProvider(Protocol):
    """Provider interface to replace with DeepSeek later."""

    def recommend(self, context: MissionContext) -> Recommendation:
        ...


class MockProvider:
    """Deterministic offline assistant; never calls an external API.

    离线、确定性的任务助手；不调用外部 API，只用于接口和 UI 验证。
    """

    def recommend(self, context: MissionContext) -> Recommendation:
        feasible = [route for route in context.route_candidates if route.get("safety_ok")]
        if not feasible:
            feasible = list(context.route_candidates)
        if not feasible:
            raise ValueError("no route candidates available")
        selected = min(feasible, key=lambda route: float(route.get("planning_cost", float("inf"))))
        payload = {
            "route_id": selected["route_id"],
            "recommendation": "Select the lowest-cost validated candidate; verify missing data before execution.",
            "reasons": [
                f"Route is evaluated against the declared EVA constraints.",
                f"Planning cost is {selected.get('planning_cost', 'unknown')}.",
            ],
            "risks": [
                "This offline provider does not infer weather or radiation observations.",
            ],
            "citations": context.data_sources,
            "missing_data": context.missing_data,
        }
        return validate_recommendation(payload, context)
