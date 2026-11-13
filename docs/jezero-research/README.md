# Jezero 研究资料与方案

火星 Jezero 陨石坑西部三角洲 Hawksbill Gap 的两轮研究归档，供 OrionX 队友审阅和复现。任务区约 520 × 520 米，科学目标为 Swift Run 与 Hazeltop 两处露头。

## 方案和数据

| 入口 | 内容 |
| --- | --- |
| [技术审阅方案](技术审阅方案.md) | 最新方案。含官方取数示例、数据配准、二维和三维、多目标寻路、离线发布、持续学习与验收。 |
| [早期实施方案](实施方案.md) | 第一轮数据核验、试算结果和最初的实现建议。用于追溯早期决策。 |
| [资源清单](资源清单.md) | NASA、JPL、USGS 和 PDS 的产品来源、原始链接、尺度和署名。 |
| [raw](raw/) | Mars Trek 瓦片、服务元数据、USGS 地质要素、毅力号照片和航点、参考素材。 |
| [derived](derived/) | 高程、配套正射、热红外、坡度和地质裁片，以及[路线预览](derived/jezero-terrain-route-preview.png)和[地形试算结果](derived/validation.json)。 |
| [probes](probes/) | 第二轮补充的数值 MOLA 样片、MEDA 小样和源链接。 |
| [SHA-256 清单](sha256.txt) | 本目录文件的校验值。 |

后续设计以[技术审阅方案](技术审阅方案.md)为准。第二轮在六处地物上测得 Mars Trek 瓦片与现有 HiRISE 配套正射的相对偏移约 31–33 米。局部导航采用同一立体产品的正射和高程，Mars Trek 用于区域浏览。早期预览来自实际地形和模拟任务参数，发布前还要核验站点位置、障碍和环境条件。

完整版采样报告及其署名见 [NASA PDS 原始报告](https://pds-geosciences.wustl.edu/missions/mars2020/Mars%202020%20Initial%20Reports%20Volume%202%20Release%202.pdf)。原始交付 ZIP 保存在本地，GitHub 目录可直接浏览和下载各项数据。

## 复现

在已安装 NumPy、SciPy、Matplotlib、Pillow、Rasterio、PyProj 和 Shapely 2.1+ 的 Python 环境中，从本目录运行以下命令。命令会更新 `derived` 中的输出。建议先在副本中执行，保留归档结果。

```sh
python prepare_context.py
python verify_site.py
```

联网时可用 `python crop_sources.py dtm ortho thermal` 重新从 USGS COG 读取源裁片。地形试算可在本地使用已有裁片复现。
