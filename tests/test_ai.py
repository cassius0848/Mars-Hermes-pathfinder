"""Offline AI boundary checks / 离线 AI 边界检查。"""

from mars_pathfinder.ai.context_builder import build_mission_context
from mars_pathfinder.ai.provider import MockProvider
from mars_pathfinder.ai.retrieval import KeywordRetriever, build_research_corpus


def test_mock_provider_only_selects_known_route():
    context = build_mission_context(
        mission_id="test",
        data_mode="real",
        constraints={"reserve_fraction": 0.25},
        targets=[{"id": "target-a", "source": "USGS"}],
        route_candidates=[{"route_id": "route-a", "planning_cost": 2, "safety_ok": True}],
        data_sources=["NASA MOLA", "USGS SIM 3464"],
        missing_data=["weather"],
    )
    result = MockProvider().recommend(context)
    assert result.route_id == "route-a"
    assert result.citations == ["NASA MOLA", "USGS SIM 3464"]
    assert "weather" in result.missing_data


def test_research_corpus_retrieves_source_text(tmp_path):
    (tmp_path / "source.md").write_text("USGS SIM 3464 Jezero geology", encoding="utf-8")
    chunks = build_research_corpus(tmp_path)
    results = KeywordRetriever(chunks).search("Jezero geology")
    assert results and results[0].metadata["path"] == "source.md"
