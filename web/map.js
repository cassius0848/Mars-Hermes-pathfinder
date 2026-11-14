import { cellXY, cellOf, geographic, indexOf } from './planner.js';

const colors = { start: '#a8dbb2', goal: '#ffc18d', science: '#f6d477', crew: '#ffefc0', route: '#7de3bd', rover: '#f6c197' };

export class MissionMap {
  constructor(canvas, onPick) {
    this.canvas = canvas;
    this.onPick = onPick;
    this.ctx = canvas.getContext('2d');
    this.images = new Map();
    this.rover = true;
    new ResizeObserver(() => this.draw()).observe(canvas);
    canvas.addEventListener('click', event => {
      const rect = canvas.getBoundingClientRect();
      this.pick(event.clientX - rect.left, event.clientY - rect.top);
    });
    canvas.addEventListener('pointermove', event => {
      const rect = canvas.getBoundingClientRect();
      this.cursor = this.xyFromScreen(event.clientX - rect.left, event.clientY - rect.top);
      this.draw();
    });
    canvas.addEventListener('pointerleave', () => { this.cursor = null; this.draw(); });
    canvas.addEventListener('keydown', event => this.keyboard(event));
  }

  setSite(site) {
    this.site = site;
    this.layer = 'optical';
    this.view = [site.left + site.cols * site.step / 2, site.top - site.rows * site.step / 2];
    this.factor = 1;
    this.cursor = null;
    this.data = {};
    this.draw();
  }

  setLayer(layer) { this.layer = layer; this.draw(); }

  zoom(multiplier) {
    if (!this.site) return;
    if (multiplier === 1) {
      this.view = [this.site.left + this.site.cols * this.site.step / 2, this.site.top - this.site.rows * this.site.step / 2];
      this.factor = 1;
    } else {
      if (multiplier > 1 && this.cursor && this.factor < 5) this.view = this.cursor;
      this.factor = Math.min(5, Math.max(1, this.factor * multiplier));
      if (this.factor === 1) return this.zoom(1);
    }
    this.draw();
  }

  keyboard(event) {
    if (!this.site) return;
    const step = this.site.step * (event.shiftKey ? 10 : 1);
    const shift = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[event.key];
    if (!shift && !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    this.cursor ??= [...this.view];
    if (shift) this.cursor = this.cursor.map((value, i) => value + shift[i]);
    else this.pick(...this.screen(this.cursor));
    this.draw();
  }

  screen([x, y]) { return [(x - this.view[0]) * this.scale + this.w / 2, (this.view[1] - y) * this.scale + this.h / 2]; }

  xyFromScreen(x, y) {
    if (!this.site) return null;
    return [this.view[0] + (x - this.w / 2) / this.scale, this.view[1] - (y - this.h / 2) / this.scale];
  }

  pick(x, y) {
    if (!this.site) return;
    const [east, north] = this.xyFromScreen(x, y), site = this.site;
    const cell = [Math.floor((site.top - north) / site.step), Math.floor((east - site.left) / site.step)];
    if (indexOf(site, cell) < 0) return;
    this.onPick(cell, [east, north]);
  }

  draw() {
    if (!this.site || !this.ctx) return;
    const { canvas, ctx, site } = this;
    this.w = canvas.clientWidth; this.h = canvas.clientHeight;
    if (!this.w || !this.h) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const pxWidth = Math.round(this.w * dpr), pxHeight = Math.round(this.h * dpr);
    if (canvas.width !== pxWidth || canvas.height !== pxHeight) { canvas.width = pxWidth; canvas.height = pxHeight; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1d1c1a'; ctx.fillRect(0, 0, this.w, this.h);
    this.scale = Math.min(this.w / site.cols, this.h / site.rows) / site.step * this.factor;
    const width = site.cols * site.step * this.scale, height = site.rows * site.step * this.scale;
    const [left, top] = this.screen([site.left, site.top]);
    ctx.save();
    ctx.beginPath();
    if (site.regional) {
      const [x, y] = this.screen([0, 0]);
      ctx.arc(x, y, 40000 * this.scale, 0, Math.PI * 2);
    } else ctx.rect(left, top, width, height);
    ctx.clip();
    const path = `assets/${site.id}/${this.layer === 'light' ? 'optical' : this.layer}.webp`;
    if (!this.images.has(path)) {
      const source = new Image();
      this.images.set(path, source);
      source.onload = () => this.draw();
      source.src = path;
    }
    const img = this.images.get(path);
    if (img.naturalWidth) {
      ctx.imageSmoothingEnabled = this.layer !== 'thermal' && this.layer !== 'geology';
      ctx.drawImage(img, left, top, width, height);
    }
    const { plan, light, start, stops = [], closures = [], progress } = this.data;
    if (this.layer === 'light' && light) {
      ctx.fillStyle = '#191a2db8';
      const pixel = site.step * light.stride * this.scale;
      for (let row = 0; row < light.rows; row++) for (let col = 0; col < light.cols; col++) {
        if (!light.mask[row * light.cols + col]) ctx.fillRect(left + col * pixel, top + row * pixel, pixel + 0.5, pixel + 0.5);
      }
    }
    if (this.rover) this.line(site.rovers, colors.rover, 1.5, [3, 5]);
    if (site.regional) {
      for (const target of site.targets) {
        const [x, y] = this.screen(cellXY(site, target.cell));
        ctx.strokeStyle = '#8fdcb0df'; ctx.lineWidth = 1.5;
        const size = Math.max(12, (target.site === 'hawksbill' ? 520 : 1120) * this.scale);
        ctx.strokeRect(x - size / 2, y - size / 2, size, size);
      }
    }
    if (plan) {
      const points = plan.path.map(i => cellXY(site, cellOf(site, i)));
      this.line(points, '#1a2420e6', 7);
      this.line(points, colors.route, 3.5);
    }
    for (const { cell, radius } of closures) {
      const [x, y] = this.screen(cellXY(site, cell));
      ctx.beginPath(); ctx.arc(x, y, Math.max(4, radius * this.scale), 0, Math.PI * 2);
      ctx.fillStyle = '#af4b417a'; ctx.fill(); ctx.strokeStyle = '#ffab97'; ctx.lineWidth = 2; ctx.stroke();
    }
    for (const target of site.targets) {
      if (target.reference) {
        const [x, y] = this.screen(target.reference);
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#a6d6f0'; ctx.lineWidth = 1.75; ctx.stroke();
      }
      if (!(plan && stops.some(s => s.name === target.name))) {
        const science = target.task || target.reference || target.image;
        if (science) this.scienceMarker(cellXY(site, target.cell), target.name.split(' · ')[0]);
        else this.marker(cellXY(site, target.cell), target.name.split(' · ')[0], colors.goal, 3);
      }
    }
    if (start) this.marker(cellXY(site, start), '出发地', colors.start);
    stops.forEach((stop, i) => this.marker(cellXY(site, stop.cell), stops.length === 1 ? '目的地' : `停靠 ${i + 1}`, colors.goal));
    if (progress) this.marker(progress.xy, '模拟队员', colors.crew, 7);
    if (this.cursor && canvas === document.activeElement) {
      const [x, y] = this.screen(this.cursor);
      ctx.strokeStyle = '#fff0ce'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); ctx.stroke();
    }
    ctx.restore();
    this.annotations();
  }

  line(points, color, width, dash = []) {
    const ctx = this.ctx;
    ctx.beginPath(); let first = true;
    for (const point of points) {
      if (!point) { first = true; continue; }
      const [x, y] = this.screen(point);
      if (first) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      first = false;
    }
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
  }

  scienceMarker(xy, title) {
    const [x, y] = this.screen(xy), ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = colors.science;
    ctx.strokeStyle = '#33291b';
    ctx.lineWidth = 1.5;
    ctx.fillRect(-5, -5, 10, 10);
    ctx.strokeRect(-5, -5, 10, 10);
    ctx.restore();
    ctx.font = '600 12px system-ui'; ctx.textAlign = x > this.w * 0.72 ? 'right' : 'left';
    const labelX = x + (ctx.textAlign === 'left' ? 10 : -10);
    ctx.lineWidth = 3; ctx.strokeStyle = '#272321'; ctx.fillStyle = '#fff1d9';
    ctx.strokeText(`科学点 · ${title}`, labelX, y - 8); ctx.fillText(`科学点 · ${title}`, labelX, y - 8);
  }

  marker(xy, title, color, radius = 5) {
    const [x, y] = this.screen(xy), ctx = this.ctx;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#1b211d'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = '12px system-ui'; ctx.textAlign = x > this.w * 0.72 ? 'right' : 'left';
    const labelX = x + (ctx.textAlign === 'left' ? 9 : -9);
    ctx.lineWidth = 3; ctx.strokeStyle = '#272321'; ctx.fillStyle = '#fff1d9';
    ctx.strokeText(title, labelX, y - 7); ctx.fillText(title, labelX, y - 7);
  }

  annotations() {
    const ctx = this.ctx;
    const tick = [10000, 5000, 1000, 500, 100, 50, 25, 10].find(value => value * this.scale < 95) ?? 10;
    const bar = Math.max(14, tick * this.scale);
    ctx.fillStyle = '#211e1be6'; ctx.fillRect(13, this.h - 46, bar + 20, 31);
    ctx.fillStyle = '#f7dec1'; ctx.fillRect(23, this.h - 24, bar, 2);
    ctx.font = '11px system-ui'; ctx.textAlign = 'left';
    ctx.fillText(tick >= 1000 ? `${tick / 1000} km` : `${tick} m`, 23, this.h - 29);
    ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('N ↑', this.w - 22, this.h - 23);
    if (this.cursor && document.activeElement === this.canvas) {
      const [lon, lat] = geographic(this.site, this.cursor);
      ctx.font = '11px system-ui'; ctx.textAlign = 'center';
      ctx.fillStyle = '#211e1be8'; ctx.fillRect(this.w / 2 - 75, this.h - 34, 150, 20);
      ctx.fillStyle = '#f7dec1'; ctx.fillText(`${lon.toFixed(4)}°E  ${lat.toFixed(4)}°N`, this.w / 2, this.h - 20);
    }
  }
}

export function profileChart(canvas, site, plan, progress) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width = rect.width * dpr; canvas.height = 110 * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const { width } = rect;
  ctx.font = '11px system-ui';
  if (!plan) { ctx.fillStyle = '#ac9b8b'; ctx.fillText('计算路线后显示沿线高程', 12, 56); return; }
  const heights = plan.path.map(index => site.height[index]);
  const min = heights.reduce((a, b) => Math.min(a, b)), max = heights.reduce((a, b) => Math.max(a, b));
  const x = distance => 58 + distance / plan.distance * (width - 73);
  const y = z => 86 - (z - min) / Math.max(1, max - min) * 63;
  ctx.strokeStyle = '#55453a'; ctx.fillStyle = '#beab97';
  for (const z of [min, max]) {
    ctx.beginPath(); ctx.moveTo(58, y(z)); ctx.lineTo(width - 15, y(z)); ctx.stroke(); ctx.fillText(`${z.toFixed(0)} m`, 1, y(z));
  }
  ctx.beginPath(); heights.forEach((z, i) => ctx.lineTo(x(plan.lengths[i]), y(z)));
  ctx.strokeStyle = colors.route; ctx.lineWidth = 2; ctx.stroke();
  if (progress) { ctx.fillStyle = colors.crew; ctx.fillRect(x(progress.distance) - 1, 18, 2, 68); }
  ctx.fillStyle = '#beab97'; ctx.textAlign = 'right';
  ctx.fillText(plan.distance < 1000 ? `${plan.distance.toFixed(0)} m` : `${(plan.distance / 1000).toFixed(2)} km`, width - 14, 106);
}
