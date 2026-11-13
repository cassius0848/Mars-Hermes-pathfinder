"""API-independent AI boundary / 不依赖 API 的 AI 边界。"""

from .provider import MockProvider
from .schemas import MissionContext, Recommendation

__all__ = ["MissionContext", "MockProvider", "Recommendation"]
