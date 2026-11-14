# 经典陨石坑数据包

完整米级 A* 需要每个局部区域同时有高程 DEM、派生坡度、可用影像和覆盖/质量说明。当前项目的 Jezero、Hawksbill Gap、Neretva Vallis 已经把这些数据裁切为可随网页发布的本地包；Gale、Endeavour、Eberswalde 目前缺少的是本地裁切包，不是路线算法。

## 已确认的官方源

| 区域 | 官方产品 | 分辨率 | 原始大小 | 入口 |
| --- | --- | ---: | ---: | --- |
| Gale | USGS / NASA MSL Gale Merged DEM v3 | 1 m | 约 3.6 GB | [产品页](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m) · [GeoTIFF](https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif) |
| Endeavour | NASA/HiRISE Western Rim DTM | 1.01 m | 约 675 MB | [产品页](https://hirise.lpl.arizona.edu/dtm/dtm.php?ID=ESP_018701_1775) · [IMG](https://hirise.lpl.arizona.edu/PDS/DTM/ESP/ORB_018700_018799/ESP_018701_1775_ESP_018846_1775/DTEEC_018701_1775_018846_1775_U01.IMG) |
| Eberswalde | NASA/HiRISE Delta Structure DTM | 1 m | 约 412 MB | [产品页](https://hirise.lpl.arizona.edu/dtm/dtm.php?ID=PSP_001336_1560) · [IMG](https://hirise.lpl.arizona.edu/PDS/DTM/PSP/ORB_001300_001399/PSP_001336_1560_PSP_001534_1560/DTEEC_001336_1560_001534_1560_U01.IMG) |

这些产品来源于比赛要求中列出的 NASA Mars Trek、NASA/HiRISE 和 USGS Astrogeology 资源体系。HiRISE 产品页明确标出约 1 m/pixel 的空间尺度；Gale 产品页将 1 m DEM 标为 MSL 工程/科学地形产品。

## 为什么没有直接把原始文件提交到 GitHub

三个原始产品合计超过 4 GB，且不同产品的投影、文件格式和覆盖范围不同。直接把它们放进网页包会让评委无法快速打开，也会让 Git 历史和部署包失控。正确流程是：

1. 下载或按 HTTP Range 读取一个官方产品；
2. 核对 PDS/GeoTIFF 头、CRS、nodata、空间范围和 SHA-256；
3. 在产品覆盖内裁切一个约 0.5–2 km 的任务区；
4. 派生坡度和质量掩膜；
5. 把经过核验的 elevation.bin、slope.bin、影像和 manifest.json 放入 web/assets/<site>；
6. 通过现有 A*、预算、候选路线和导航回放跑回归测试。

在完成第 2–4 步前，不能把全局 MOLA 或在线剖面当成米级步行 DEM。在线地图现在会显示这些官方源链接，供评委核验。

## 建议的裁切任务区

- **Gale**：Curiosity 着陆区和 Mount Sharp 北部，先做 0.5–1 km 步行包；产品覆盖约 1 m DEM，但整幅文件很大。
- **Endeavour**：Opportunity 曾考察的西侧/北侧边缘，使用 Western Rim DTM。
- **Eberswalde**：三角洲结构及其东/西缘，使用 Delta Structure DTM；可再补充 Eberswalde Deposits DTM。

完整产品目录仍保留在 [NASA HiRISE DTM catalog](https://www.uahirise.org/hiwish/maps/dtms.jsp) 和 [NASA Mars Trek](https://trek.nasa.gov/mars/)。
