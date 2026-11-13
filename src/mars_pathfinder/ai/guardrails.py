"""AI output validation / AI 输出校验。"""

from typing import Any

from mars_pathfinder.ai.schemas import MissionContext, Recommendation


def validate_recommendation(payload: dict[str, Any], context: MissionContext) -> Recommendation:
    """Validate route ID, explanations, and provenance before display.

    在展示前校验路线 ID、解释字段和数据溯源，防止模型推荐不存在的路线。
    """

    route_ids = {str(route.get("route_id")) for route in context.route_candidates}
    route_id = str(payload.get("route_id", ""))
    if route_id not in route_ids:
        raise ValueError(f"AI returned unknown route_id: {route_id}")
    reasons = [str(item) for item in payload.get("reasons", []) if str(item).strip()]
    risks = [str(item) for item in payload.get("risks", []) if str(item).strip()]
    citations = [str(item) for item in payload.get("citations", []) if str(item).strip()]
    if not reasons:
        raise ValueError("AI recommendation must include at least one reason")
    return Recommendation(
        route_id=route_id,
        recommendation=str(payload.get("recommendation", "")),
        reasons=reasons,
        risks=risks,
        citations=citations,
        missing_data=[str(item) for item in payload.get("missing_data", context.missing_data)],
    )
