"""Reference-asset provenance checks / 参考素材溯源检查。"""

from pathlib import Path

from mars_pathfinder.data.loaders import load_route_reference


def test_curiosity_route_reference_has_attribution():
    reference = load_route_reference(Path('data/raw/references/curiosity_mount_sharp_path.json'))
    assert reference.mission.startswith('Curiosity')
    assert 'HiRISE' in reference.data_sources
    assert reference.role.startswith('historical')
