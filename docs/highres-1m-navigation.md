# 1 m 局部高程裁切

已用 NASA/USGS 的 HiRISE DTM 1 m GeoTIFF，通过 HTTP Range 读取两个 520 × 520 m 任务窗口，生成高程、坡度和质量掩膜。源文件没有整幅下载；每个窗口只读取相交的原始条带。

| 区域 | 栅格 | 有效覆盖 | 高程范围 | 最大坡度 |
| --- | ---: | ---: | ---: | ---: |
| Hawksbill Gap | 1 m | 100% | -2545.55 至 -2467.75 m | 56.52° |
| Neretva Vallis | 1 m | 100% | -2366.17 至 -2295.56 m | 48.03° |

质量掩膜把源文件 nodata 和非物理值排除。构建适配器优先读取 1m 文件；不存在时回退到原有 2 m 文件。A* 会把质量掩膜外的像元当作不可通行，3D 和剖面可以使用同一高程源。

源产品：[USGS/NASA Mars 2020 HiRISE DTM](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif)。复现脚本位于 scripts/build_highres_crops.py，需要项目的 rasterio、tifffile、numpy、pyproj 依赖。完整窗口、SHA-256 和来源记录见 data/highres-1m/manifest.json。

1 m DTM 仍不表示小于 1 m 的岩块、沙地承载力或实时尘埃；它提升了高程和坡度的采样精度，不等于飞行级导航安全。
