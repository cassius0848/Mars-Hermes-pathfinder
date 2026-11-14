export const craterSources = {
  jezero: {
    label: 'Jezero',
    resolution: '2 m local / 100 m regional packages',
    status: '米级规划包已随项目提供',
    links: [
      { label: 'NASA Mars Trek', url: 'https://trek.nasa.gov/mars/', note: '在线图层与坐标' },
      { label: 'USGS/JPL CTX 20 m DEM', url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif', note: '区域走廊底图' },
    ],
  },
  gale: {
    label: 'Gale',
    resolution: 'USGS merged DEM 1 m · 原始约 3.6 GB',
    status: '官方源已确认，待裁切为本地规划包',
    links: [
      { label: 'USGS 产品页', url: 'https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m', note: '产品说明与元数据' },
      { label: '下载 1 m DEM', url: 'https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif', note: '3.6 GB GeoTIFF' },
      { label: 'NASA Mars Trek', url: 'https://trek.nasa.gov/mars/', note: '光学/热学在线图层' },
    ],
  },
  endeavour: {
    label: 'Endeavour',
    resolution: 'HiRISE DTM 1.01 m · 原始约 675 MB',
    status: '官方源已确认，待裁切为本地规划包',
    links: [
      { label: 'NASA/HiRISE 产品页', url: 'https://hirise.lpl.arizona.edu/dtm/dtm.php?ID=ESP_018701_1775', note: 'Western Rim DTM' },
      { label: '下载 DTM 原文件', url: 'https://hirise.lpl.arizona.edu/PDS/DTM/ESP/ORB_018700_018799/ESP_018701_1775_ESP_018846_1775/DTEEC_018701_1775_018846_1775_U01.IMG', note: '675 MB IMG' },
      { label: 'NASA Mars Trek', url: 'https://trek.nasa.gov/mars/', note: '轨道影像与全球底图' },
    ],
  },
  eberswalde: {
    label: 'Eberswalde',
    resolution: 'HiRISE DTM 1 m · 原始约 412 MB',
    status: '官方源已确认，待裁切为本地规划包',
    links: [
      { label: 'NASA/HiRISE 产品页', url: 'https://hirise.lpl.arizona.edu/dtm/dtm.php?ID=PSP_001336_1560', note: 'Delta Structure DTM' },
      { label: '下载 DTM 原文件', url: 'https://hirise.lpl.arizona.edu/PDS/DTM/PSP/ORB_001300_001399/PSP_001336_1560_PSP_001534_1560/DTEEC_001336_1560_001534_1560_U01.IMG', note: '412 MB IMG' },
      { label: 'NASA Mars Trek', url: 'https://trek.nasa.gov/mars/', note: '轨道影像与全球底图' },
    ],
  },
};
