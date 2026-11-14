import * as THREE from './vendor/three.module.min.js';
import { cellOf, cellXY } from './planner.js';

export class TerrainView {
  constructor(host, site, plan) {
    this.host = host;
    this.site = site;
    this.meshStride = site.regional
      ? Math.max(1, Math.ceil(Math.sqrt((site.rows * site.cols) / 180000)))
      : 1;
    this.meshResolution = site.step * this.meshStride;
    this.verticalScale = site.step <= 2 ? 2.5 : 1.6;
    const size = site.cols * site.step;
    this.mid = (site.depth.min + site.depth.max) * 0.5;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#231e1b');
    this.scene.fog = new THREE.Fog('#231e1b', size * 1.8, size * 3.5);
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, size * 5);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.domElement.setAttribute('aria-label', '有路线和队员位置的三维火星地形');
    host.append(this.renderer.domElement);
    this.badge = document.createElement('div');
    this.badge.className = 'terrain-quality';
    this.badge.textContent = `3D 网格 ${this.meshResolution} m · 垂直显示 ×${this.verticalScale}；路线计算使用原始 ${site.step} m 高程`;
    host.append(this.badge);
    this.initialDistance = size * 1.33;
    this.distance = this.initialDistance;
    this.angle = 0.64; this.pitch = 0.74;
    this.target = new THREE.Vector3(0, 0, 0);
    this.focus = this.target.clone();
    this.follow = true;

    const { geometry, rows, cols } = this.mesh();
    this.rows = rows; this.cols = cols; this.geometry = geometry;
    const texture = new THREE.TextureLoader().load(`assets/${site.id}/optical.webp`, () => this.draw());
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const surface = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide }));
    surface.name = 'HiRISE height mesh';
    this.scene.add(surface, new THREE.AmbientLight(0xffe3c8, 1.65));
    this.sun = new THREE.DirectionalLight(0xffe4ce, 2.3);
    this.sun.position.set(0.7, 0.8, 0.4);
    this.scene.add(this.sun);
    this.surface = surface;
    const route = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#83ffd0' }));
    route.material.depthTest = false; route.renderOrder = 4;
    this.scene.add(route);
    this.route = route;
    const marker = new THREE.Mesh(new THREE.SphereGeometry(Math.max(2.5, size / 170), 16, 12), new THREE.MeshBasicMaterial({ color: '#ffd6a1' }));
    marker.material.depthTest = false; marker.renderOrder = 5;
    this.scene.add(marker); this.marker = marker;
    this.stations = new THREE.Group(); this.scene.add(this.stations);
    this.setPlan(plan);
    this.bindPointer();
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(host);
    this.draw();
  }

  mesh() {
    const { site } = this;
    const step = this.meshStride;
    const axis = count => [...Array.from({ length: Math.ceil((count - 1) / step) }, (_, i) => i * step), count - 1];
    const rows = axis(site.rows), cols = axis(site.cols);
    const positions = [], uv = [], triangles = [];
    for (const row of rows) for (const col of cols) {
      const [east, north] = cellXY(site, [row, col]);
      positions.push(east, (site.height[row * site.cols + col] - this.mid) * this.verticalScale, -north);
      uv.push((col + 0.5) / site.cols, 1 - (row + 0.5) / site.rows);
    }
    for (let row = 0; row < rows.length - 1; row++) for (let col = 0; col < cols.length - 1; col++) {
      const a = row * cols.length + col, b = a + 1, c = a + cols.length, d = c + 1;
      triangles.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(triangles);
    geometry.computeVertexNormals();
    return { geometry, rows, cols };
  }

  heightAt(east, north) {
    const { site, rows, cols } = this;
    const r = (site.top - north) / site.step - 0.5, c = (east - site.left) / site.step - 0.5;
    const cell = (axis, v) => Math.min(axis.length - 2, Math.max(0, Math.floor(v / axis[1])));
    const y = cell(rows, r), x = cell(cols, c);
    const dx = (c - cols[x]) / (cols[x + 1] - cols[x]), dy = (r - rows[y]) / (rows[y + 1] - rows[y]);
    const z = (row, col) => (site.height[rows[row] * site.cols + cols[col]] - this.mid) * this.verticalScale;
    return dx + dy <= 1 ? z(y, x) + dx * (z(y, x + 1) - z(y, x)) + dy * (z(y + 1, x) - z(y, x))
      : z(y + 1, x + 1) + (1 - dx) * (z(y + 1, x) - z(y + 1, x + 1)) + (1 - dy) * (z(y, x + 1) - z(y + 1, x + 1));
  }

  setPlan(plan) {
    this.route.geometry.dispose();
    this.route.geometry = new THREE.BufferGeometry().setFromPoints(plan.path.map(index => {
      const [e, n] = cellXY(this.site, cellOf(this.site, index));
      return new THREE.Vector3(e, this.heightAt(e, n) + 1.5 * this.verticalScale, -n);
    }));
    for (const object of [...this.stations.children]) {
      object.geometry?.dispose(); object.material?.map?.dispose(); object.material?.dispose(); this.stations.remove(object);
    }
    const stops = plan.visits.filter(visit => !visit.returnLeg);
    stops.forEach((stop, index) => {
      const [e, n] = cellXY(this.site, cellOf(this.site, stop.cell)), y = this.heightAt(e, n);
      const marker = new THREE.Mesh(new THREE.SphereGeometry(Math.max(2, this.site.step * 1.5), 10, 8), new THREE.MeshBasicMaterial({ color: '#ffd095', depthTest: false }));
      marker.position.set(e, y + 2 * this.verticalScale, -n); marker.renderOrder = 5; this.stations.add(marker);
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 64;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#211b18dd'; ctx.fillRect(0, 0, 512, 64);
      ctx.fillStyle = '#ffe3bd'; ctx.font = '24px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(`${index === stops.length - 1 ? '目的地' : `经停 ${index + 1}`} · ${stop.name}`, 256, 41, 490);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
      const width = Math.max(34, this.site.cols * this.site.step / 12);
      label.scale.set(width, width / 8, 1); label.position.set(e, y + 10 * this.verticalScale, -n); label.renderOrder = 6;
      this.stations.add(label);
    });
    this.draw();
  }

  update(progress, light) {
    if (!progress) return;
    const [e, n] = progress.xy;
    this.marker.position.set(e, this.heightAt(e, n) + 4 * this.verticalScale, -n);
    this.focus.copy(this.marker.position);
    if (light) this.sun.position.set(light.sun.east, Math.max(0.08, light.sun.up), -light.sun.north);
    this.draw();
  }

  bindPointer() {
    const canvas = this.renderer.domElement;
    let last;
    canvas.addEventListener('pointerdown', e => { last = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointerup', () => { last = null; });
    canvas.addEventListener('pointercancel', () => { last = null; });
    canvas.addEventListener('pointermove', e => {
      if (!last) return;
      this.angle -= (e.clientX - last[0]) * 0.008;
      this.pitch = Math.min(1.5, Math.max(0.18, this.pitch + (e.clientY - last[1]) * 0.008));
      last = [e.clientX, e.clientY]; this.draw();
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.distance = Math.min(this.initialDistance * 2.3, Math.max(this.initialDistance * 0.13, this.distance * Math.exp(e.deltaY * 0.001)));
      this.draw();
    }, { passive: false });
  }

  setFollow(follow) {
    this.follow = follow;
    this.distance = follow ? this.initialDistance * 0.69 : this.initialDistance;
    this.draw();
  }

  draw() {
    if (!this.host.clientWidth || this.disposed) return;
    const { camera, renderer, host } = this;
    const { clientWidth: width, clientHeight: height } = host;
    if (!height) return;
    const pixelRatio = renderer.getPixelRatio();
    if (Math.abs(renderer.domElement.width - width * pixelRatio) > 1 || Math.abs(renderer.domElement.height - height * pixelRatio) > 1) renderer.setSize(width, height, false);
    camera.aspect = width / height; camera.updateProjectionMatrix();
    this.target.copy(this.follow ? this.focus : new THREE.Vector3());
    camera.position.set(Math.sin(this.angle) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.angle) * Math.cos(this.pitch))
      .multiplyScalar(this.distance).add(this.target);
    camera.lookAt(this.target);
    renderer.render(this.scene, camera);
  }

  destroy() {
    this.disposed = true;
    this.observer.disconnect();
    this.scene.traverse(object => {
      object.geometry?.dispose();
      object.material?.map?.dispose();
      object.material?.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.badge?.remove();
  }
}

