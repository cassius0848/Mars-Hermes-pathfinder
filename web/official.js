import { project } from './planner.js';

const GEOLOGY = 'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Jezero_FeatureServiceFromPro/FeatureServer/8';
const WAYPOINTS = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json';
const WMTS = 'https://trek.nasa.gov/tiles/Mars/EQ';
const HI = 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd';
const CTX = 'Jezero_CTX_BlockAdj_dd';
const DEG = Math.PI / 180;
const RADIUS = 3396190;

function fetchOfficial(url, format) {
  return fetch(url, { signal: AbortSignal.timeout(12000), credentials: 'omit' }).then(response => {
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    return response[format]();
  });
}

export function trekTile(site, [lon, lat]) {
  const level = site.regional ? 9 : 16;
  const normalized = (lon + 180) % 360 - 180;
  const tileDegrees = 360 / 2 ** (level + 1);
  const col = Math.floor((normalized + 180) / tileDegrees);
  const row = Math.floor((90 - lat) / tileDegrees);
  return `${WMTS}/${site.regional ? CTX : HI}/1.0.0/default/default028mm/${level}/${row}/${col}.png`;
}

export function geologyQuery([lon, lat], radius) {
  const phi = lat * DEG, delta = (lon - 77.5) * DEG;
  const x = RADIUS * Math.atanh(Math.cos(phi) * Math.sin(delta));
  const y = RADIUS * Math.atan2(Math.tan(phi), Math.cos(delta));
  const query = new URLSearchParams({ where: '1=1', geometry: [x - radius, y - radius, x + radius, y + radius].map(Math.round).join(','),
    geometryType: 'esriGeometryEnvelope', spatialRel: 'esriSpatialRelIntersects', outFields: 'unit,name', returnGeometry: 'false', f: 'json' });
  return `${GEOLOGY}/query?${query}`;
}

export async function queryOfficial(site, lonlat) {
  const tileUrl = trekTile(site, lonlat);
  const radius = site.regional ? 1000 : 250;
  const geologyUrl = geologyQuery(lonlat, radius);
  const [tile, geology, rover] = await Promise.allSettled([
    fetchOfficial(tileUrl, 'blob').then(async blob => {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close();
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const visible = data.some((value, i) => i % 4 === 3 && value > 0);
      return { visible, size: [canvas.width, canvas.height] };
    }),
    fetchOfficial(geologyUrl, 'json').then(data => {
      if (!Array.isArray(data.features)) throw Error('USGS 未返回地质要素');
      return [...new Set(data.features.map(f => f.attributes.name || f.attributes.unit).filter(Boolean))];
    }),
    fetchOfficial(`${WAYPOINTS}?view=mars-pathfinder`, 'json')
      .then(data => ({ data, archived: false }))
      .catch(() => fetchOfficial('assets/rover-waypoints.json', 'json').then(data => ({ data, archived: true })))
      .then(({ data, archived }) => {
      const [x, y] = project(site, lonlat);
      let nearest;
      for (const point of data.features.filter(f => f.geometry?.type === 'Point')) {
        const [e, n] = project(site, point.geometry.coordinates);
        const distance = Math.hypot(x - e, y - n);
        if (!nearest || distance < nearest.distance) nearest = { distance, sol: point.properties.sol, rmc: point.properties.RMC };
      }
      return { nearest, archived };
    }),
  ]);
  return { tile, geology, rover, tileUrl, geologyUrl, roverUrl: WAYPOINTS, radius };
}
