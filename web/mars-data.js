import { fetchOfficial, GEOLOGY } from './official.js';

const WMTS = 'https://trek.nasa.gov/tiles/Mars/EQ';
const MOLA = 'https://trek.nasa.gov/mars/trekarcgis/rest/services/mola128_mola64_merge_90Nto90S_SimpleC_clon0/ImageServer';
const STAC = 'https://stac.astrogeology.usgs.gov/api/search';
export const CTX_DEM = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif';
const RADIUS = 3396190;
const DEG = Math.PI / 180;
// Fixed layout of the USGS 20 m CTX product. The TIFF header is verified before reading pixels.
const CTX = { width: 4456, height: 5067, offset: 31092, west: 4329000, north: 1143420, step: 20, hash: '8c1d61425f938e8a59102b5e237fd92979bd8f6f9b73bd03a91bbb1c9297543e' };
const ctxEast = RADIUS * DEG * Math.cos(18.4663 * DEG);
const ctxNorth = RADIUS * DEG;
let verifiedHeader;

export const layers = {
  viking: { id: 'Mars_Viking_MDIM21_ClrMosaic_global_232m', title: 'Viking 全球光学' },
  mola: { id: 'Mars_MGS_MOLA_ClrShade_merge_global_463m', title: 'MOLA 全球地形着色' },
  thermal: { id: 'Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12_clon0_ly', title: 'THEMIS 日间红外' },
  ctx: { id: 'Jezero_CTX_BlockAdj_dd', title: 'Jezero CTX' },
  hirise: { id: 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd', title: 'Jezero HiRISE' },
};

const capabilities = new Map();
const children = (node, name) => Array.from(node.children).filter(child => child.localName === name);
const child = (node, name) => children(node, name)[0];
const values = element => element.textContent.trim().split(/\s+/).map(Number);

export const officialLayerUrl = layer => `${WMTS}/${layer.id}/1.0.0/WMTSCapabilities.xml`;

export function readCapabilities(layer) {
  if (capabilities.has(layer.id)) return capabilities.get(layer.id);
  const promise = fetchOfficial(officialLayerUrl(layer), 'text').then(xml => {
    const contents = new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagNameNS('*', 'Contents')[0];
    if (!contents) throw Error('NASA 未返回有效的瓦片能力文档');
    const resource = child(contents, 'Layer');
    const bbox = child(resource, 'WGS84BoundingBox') ?? child(resource, 'BoundingBox');
    const bounds = [...values(child(bbox, 'LowerCorner')), ...values(child(bbox, 'UpperCorner'))];
    const style = child(child(resource, 'Style'), 'Identifier').textContent;
    const matrix = child(contents, 'TileMatrixSet');
    const matrixName = child(matrix, 'Identifier').textContent;
    const template = children(resource, 'ResourceURL').find(url => url.getAttribute('resourceType') === 'tile')?.getAttribute('template');
    if (!template || !template.startsWith(`${WMTS}/`)) throw Error('NASA 图层缺少可用瓦片地址');
    const levels = children(matrix, 'TileMatrix').map(tile => {
      const number = name => Number(child(tile, name).textContent);
      const [west, north] = values(child(tile, 'TopLeftCorner'));
      const columns = number('MatrixWidth'), rows = number('MatrixHeight'), pixels = number('TileWidth');
      if (west !== -180 || north !== 90 || columns !== rows * 2 || pixels !== 256) throw Error('图层使用了不同的火星瓦片矩阵');
      return { id: child(tile, 'Identifier').textContent, columns, rows, pixels, degrees: 360 / columns };
    });
    if (!levels.length) throw Error('NASA 图层缺少缩放级别');
    return { ...layer, bounds, levels, template: template.replace(/\/\/\{Style}/, '/{Style}'), style, matrixName };
  }).catch(error => { capabilities.delete(layer.id); throw error; });
  capabilities.set(layer.id, promise);
  return promise;
}

export function tilesInView(layer, bbox, scale) {
  const [west, south, east, north] = bbox;
  const [minLon, minLat, maxLon, maxLat] = layer.bounds;
  if (east <= minLon || west >= maxLon || north <= minLat || south >= maxLat) return [];
  const level = layer.levels.find(level => level.degrees * scale <= 365) ?? layer.levels.at(-1);
  const tile = level.degrees;
  const rowStart = Math.max(0, Math.floor((90 - Math.min(north, maxLat)) / tile));
  const rowEnd = Math.min(level.rows - 1, Math.ceil((90 - Math.max(south, minLat)) / tile) - 1);
  const colStart = Math.max(0, Math.floor((180 + Math.max(west, minLon)) / tile));
  const colEnd = Math.min(level.columns - 1, Math.ceil((180 + Math.min(east, maxLon)) / tile) - 1);
  const tiles = [];
  for (let row = rowStart; row <= rowEnd; row++) for (let col = colStart; col <= colEnd; col++) {
    const url = layer.template.replace('{Style}', layer.style).replace('{TileMatrixSet}', layer.matrixName)
      .replace('{TileMatrix}', level.id).replace('{TileRow}', row).replace('{TileCol}', col);
    tiles.push({ url, lon: col * tile - 180, lat: 90 - row * tile, degrees: tile });
  }
  return tiles;
}

function toGeology([lon, lat]) {
  const lambda = (lon - 77.5) * DEG, phi = lat * DEG;
  return [RADIUS * Math.atanh(Math.cos(phi) * Math.sin(lambda)), RADIUS * Math.atan2(Math.tan(phi), Math.cos(lambda))];
}

export function geologyLonLat([x, y]) {
  return [77.5 + Math.atan2(Math.sinh(x / RADIUS), Math.cos(y / RADIUS)) / DEG,
    Math.asin(Math.sin(y / RADIUS) / Math.cosh(x / RADIUS)) / DEG];
}

export async function viewportGeology(bbox, signal) {
  const [west, south, east, north] = bbox;
  const corners = [[west, south], [west, north], [east, south], [east, north]].map(toGeology);
  const [x, y] = [corners.map(c => c[0]), corners.map(c => c[1])];
  const geometry = [Math.min(...x), Math.min(...y), Math.max(...x), Math.max(...y)].map(Math.round).join(',');
  const url = `${GEOLOGY}/query?${new URLSearchParams({ where: '1=1', geometry, geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects', outFields: 'unit,name', returnGeometry: 'true', maxAllowableOffset: 35, f: 'json' })}`;
  const d = await fetchOfficial(url, 'json', signal);
  if (!Array.isArray(d.features)) throw Error('USGS 未返回有效的地质面');
  return { url, partial: Boolean(d.exceededTransferLimit), features: d.features.filter(f => f.geometry?.rings).map(f => ({
    name: f.attributes.name || f.attributes.unit, unit: f.attributes.unit,
    rings: f.geometry.rings.map(ring => ring.map(geologyLonLat)),
  })) };
}

export async function hiRiseProducts(bbox, signal) {
  const url = `${STAC}?${new URLSearchParams({ collections: 'mro_hirise_socet_dtms', bbox: bbox.map(v => v.toFixed(6)).join(','), limit: 12 })}`;
  const d = await fetchOfficial(url, 'json', signal);
  if (!Array.isArray(d.features)) throw Error('USGS 未返回产品列表');
  return { url, features: d.features, more: d.links?.some(link => link.rel === 'next') };
}

export function profilePoints(a, b, count = 24) {
  const vector = ([lon, lat]) => [Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG)];
  const start = vector(a), end = vector(b);
  const radians = Math.acos(Math.max(-1, Math.min(1, start.reduce((sum, v, i) => sum + v * end[i], 0))));
  if (radians < 1e-6 || radians > Math.PI - 1e-5) throw Error('请选择两个不同且非对跖的位置');
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    const weights = [Math.sin((1 - t) * radians), Math.sin(t * radians)];
    const [x, y, z] = start.map((v, i) => weights[0] * v + weights[1] * end[i]);
    return { lonlat: [Math.atan2(y, x) / DEG, Math.atan2(z, Math.hypot(x, y)) / DEG], km: RADIUS * radians * t / 1000 };
  });
}

export async function molaProfile(a, b, signal) {
  const track = profilePoints(a, b);
  const geometry = JSON.stringify({ points: track.map(point => point.lonlat.map(v => +v.toFixed(6))), spatialReference: { wkid: 104905 } });
  const url = `${MOLA}/getSamples?${new URLSearchParams({ geometry, geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true', f: 'json' })}`;
  const result = await fetchOfficial(url, 'json', signal);
  if (!Array.isArray(result.samples)) throw Error('NASA 未返回 MOLA 高程样本');
  for (const item of result.samples) {
    const value = item.value == null || item.value === '' ? NaN : Number(item.value);
    if (Number.isFinite(value) && value > -20000 && value < 30000 && track[item.locationId]) track[item.locationId].z = value;
  }
  return { url, track };
}

export function molaExport(bbox) {
  const [west, south, east, north] = bbox;
  const scale = 512 / Math.max(east - west, north - south);
  const size = [east - west, north - south].map(span => Math.max(1, Math.round(span * scale))).join(',');
  const params = { bbox: bbox.map(v => v.toFixed(6)).join(','), bboxSR: 104905, imageSR: 104905,
    size, format: 'tiff', pixelType: 'F32', interpolation: 'RSP_Bilinear', f: 'image' };
  return `${MOLA}/exportImage?${new URLSearchParams(params)}`;
}

export async function fetchMolaTerrain(bbox, signal) {
  const size = [Math.ceil((bbox[2] - bbox[0]) * 64), Math.ceil((bbox[3] - bbox[1]) * 64)].map(v => Math.max(4, v));
  const params = { bbox: bbox.join(','), bboxSR: 104905, imageSR: 104905, size: size.join(','),
    adjustAspectRatio: 'false', format: 'tiff', pixelType: 'F32', interpolation: 'RSP_Bilinear', f: 'image' };
  const url = `${MOLA}/exportImage?${new URLSearchParams(params)}`;
  const bytes = await fetchOfficial(url, 'arrayBuffer', signal);
  const tiff = new DataView(bytes);
  if (tiff.byteLength < 8 || tiff.getUint32(0, true) !== 0x002a4949) throw Error('NASA 未返回有效的 MOLA TIFF');
  const ifd = tiff.getUint32(4, true), tags = new Map();
  try {
    for (let i = 0; i < tiff.getUint16(ifd, true); i++) {
      const entry = ifd + 2 + i * 12;
      const type = tiff.getUint16(entry + 2, true), count = tiff.getUint32(entry + 4, true);
      const width = { 3: 2, 4: 4, 12: 8 }[type];
      if (!width) continue;
      const offset = count * width <= 4 ? entry + 8 : tiff.getUint32(entry + 8, true);
      if (count * width > tiff.byteLength - offset) throw Error();
      const read = { 3: 'getUint16', 4: 'getUint32', 12: 'getFloat64' }[type];
      tags.set(tiff.getUint16(entry, true), Array.from({ length: count }, (_, j) => tiff[read](offset + j * width, true)));
    }
    const first = tag => tags.get(tag)?.[0];
    const width = first(256), height = first(257);
    const tileWidth = first(322), tileHeight = first(323), offsets = tags.get(324), lengths = tags.get(325);
    if (first(258) !== 32 || first(259) !== 1 || first(277) !== 1 || first(339) !== 3
      || !width || !height || width > 512 || height > 512 || !tileWidth || !tileHeight) throw Error();
    const [dx, dy] = tags.get(33550), [x, y, , originX, originY] = tags.get(33922);
    const lon = originX - x * dx, lat = originY + y * dy;
    if (![lon, lat, dx, dy].every(Number.isFinite) || !(dx > 0 && dy > 0)) throw Error();
    const across = Math.ceil(width / tileWidth);
    const values = new Float32Array(width * height);
    for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
      const tile = Math.floor(r / tileHeight) * across + Math.floor(c / tileWidth);
      const pos = ((r % tileHeight) * tileWidth + c % tileWidth) * 4;
      if (!(pos + 4 <= lengths[tile])) throw Error();
      const z = tiff.getFloat32(offsets[tile] + pos, true);
      values[r * width + c] = z > -20000 && z < 30000 ? z : NaN;
    }
    return { url, values, width, height, lon, lat, dLon: width * dx, dLat: height * dy };
  } catch {
    throw Error('NASA MOLA 高程文件的布局无法识别，请稍后重试。');
  }
}

export function ctxWindow([west, south, east, north]) {
  const column = lon => (lon * ctxEast - CTX.west) / CTX.step;
  const row = lat => (CTX.north - lat * ctxNorth) / CTX.step;
  const left = Math.max(0, Math.floor(column(west))), right = Math.min(CTX.width, Math.ceil(column(east)));
  const top = Math.max(0, Math.floor(row(north))), bottom = Math.min(CTX.height, Math.ceil(row(south)));
  if (left >= right || top >= bottom) return null;
  return { left, top, width: right - left, height: bottom - top,
    lon: (CTX.west + left * CTX.step) / ctxEast, lat: (CTX.north - top * CTX.step) / ctxNorth,
    dLon: (right - left) * CTX.step / ctxEast, dLat: (bottom - top) * CTX.step / ctxNorth };
}

export const ctxBounds = [CTX.west / ctxEast, (CTX.north - CTX.height * CTX.step) / ctxNorth,
  (CTX.west + CTX.width * CTX.step) / ctxEast, CTX.north / ctxNorth];

async function ctxBytes(first, last, signal) {
  const url = `${CTX_DEM}?atlas-range=${first}-${last}`;
  const timeout = AbortSignal.timeout(13000);
  const response = await fetch(url, { headers: { Range: `bytes=${first}-${last}` }, credentials: 'omit',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (response.status !== 206) { await response.body?.cancel(); throw Error('USGS 未返回指定范围的高程字节'); }
  const contentRange = response.headers.get('Content-Range');
  if (contentRange && contentRange !== `bytes ${first}-${last}/90345300`) throw Error('USGS 高程字节范围发生变化');
  const data = await response.arrayBuffer();
  if (data.byteLength !== last - first + 1) throw Error('USGS 高程切片不完整');
  return data;
}

export async function fetchCtxTerrain(window, signal) {
  verifiedHeader ??= ctxBytes(0, CTX.offset - 1).then(async bytes => {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== CTX.hash) throw Error('USGS 高程文件版本发生变化');
  }).catch(error => { verifiedHeader = null; throw error; });
  await verifiedHeader;
  signal.throwIfAborted();
  const rowBytes = CTX.width * 4;
  const values = new Float32Array(window.width * window.height);
  let min = Infinity, max = -Infinity, valid = 0;
  let nextRow = 0;
  async function readRows() {
    while (nextRow < window.height) {
      signal?.throwIfAborted();
      const row = nextRow;
      nextRow += 28;
      const rows = Math.min(28, window.height - row);
      const first = CTX.offset + (window.top + row) * rowBytes;
      const last = first + (rows - 1) * rowBytes + (window.left + window.width) * 4 - 1;
      const bytes = await ctxBytes(first, last, signal);
      const source = new DataView(bytes);
      for (let y = 0; y < rows; y++) for (let x = 0; x < window.width; x++) {
        const z = source.getFloat32(y * rowBytes + (window.left + x) * 4, true);
        const good = Number.isFinite(z) && z > -20000 && z < 30000;
        values[(row + y) * window.width + x] = good ? z : NaN;
        if (good) { min = Math.min(min, z); max = Math.max(max, z); valid++; }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, Math.ceil(window.height / 28)) }, readRows));
  return { ...window, values, min, max, valid };
}
