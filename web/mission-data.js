import { t as uiText } from './locale.js';
export const missionData = [
  {
    id: 'terrain',
    name: uiText("地形 / 坡度"),
    role: uiText("A* 路线、坡度阈值、返航和高程剖面"),
    status: uiText("已接入"),
    source: 'https://trek.nasa.gov/mars/',
  },
  {
    id: 'optical',
    name: uiText("光学影像"),
    role: uiText("识别岩石、沟槽、露头和路线障碍"),
    status: uiText("已接入"),
    source: 'https://trek.nasa.gov/mars/',
  },
  {
    id: 'thermal',
    name: uiText("热学 / THEMIS"),
    role: uiText("区域热环境背景和任务时段比较"),
    status: uiText("已接入"),
    source: 'https://stac.astrogeology.usgs.gov/docs/data/mars/themis_controlled_mosaics/',
  },
  {
    id: 'geology',
    name: uiText("地质 / SIM 3464"),
    role: uiText("科学目标、地质单元和风险解释"),
    status: uiText("已接入"),
    source: 'https://pubs.usgs.gov/publication/sim3464',
  },
  {
    id: 'spectral',
    name: uiText("光谱 / 化学 · CRISM"),
    role: uiText("后续识别黏土、硫酸盐和其他矿物目标"),
    status: uiText("官方目录已链接，尚未栅格化"),
    source: 'https://pds-geosciences.wustl.edu/missions/mro/crism.htm',
  },
  {
    id: 'atmosphere',
    name: uiText("大气 / MEDA"),
    role: uiText("气温、气压、风和尘埃的任务背景"),
    status: uiText("Jezero 历史样本可用"),
    source: 'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html',
  },
  {
    id: 'radiation',
    name: uiText("辐射 / RAD"),
    role: uiText("辐射环境参考和任务约束入口"),
    status: uiText("官方数据已链接，尚未进入路线代价"),
    source: 'https://data.nasa.gov/dataset/mars-science-laboratory-msl-radiation-assessment-detector-rad-level-2-observation-dosimetr',
  },
];
