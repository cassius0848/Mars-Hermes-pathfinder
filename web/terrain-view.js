import * as THREE from './vendor/three.module.min.js';
import { cellOf, cellXY } from './planner.js';

export class TerrainView {
  constructor(host, site, plan, { color = '#83ffd0' } = {}) {
    this.host = host;
    this.site = site;
    const size = Math.max(site.cols, site.rows) * site.step;
    this.markerLift = Math.max(4, size / 170);
    this.mid = (site.depth.min + site.depth.max) * 0.5;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#231e1b');
    this.scene.fog = new THREE.Fog('#231e1b', size * 1.8, size * 3.5);
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, size * 5);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.domElement.setAttribute('aria-label', '有路线和队员位置的三维火星地形');
    host.append(this.renderer.domElement);
    this.initialDistance = size * 1.33;
    this.distance = this.initialDistance;
    this.angle = 0.64; this.pitch = 0.74;
    this.target = new THREE.Vector3(0, 0, 0);
    this.focus = this.target.clone();
    this.follow = true;

    const { geometry, rows, cols } = this.mesh();
    this.rows = rows; this.cols = cols; this.geometry = geometry;
    const surface = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: '#b1947b', side: THREE.DoubleSide }));
    this.scene.add(surface, new THREE.AmbientLight(0xffe3c8, 1.65));
    this.sun = new THREE.DirectionalLight(0xffe4ce, 2.3);
    this.sun.position.set(0.7, 0.8, 0.4);
    this.scene.add(this.sun);
    this.surface = surface;
    if (site.id) this.applyTexture(new THREE.TextureLoader().load(`assets/${site.id}/optical.webp`, () => this.draw()));
    const route = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color }));
    route.material.depthTest = false; route.renderOrder = 4;
    this.scene.add(route);
    this.route = route;
    const marker = new THREE.Mesh(new THREE.SphereGeometry(Math.max(2.5, this.markerLift * 0.9), 16, 12), new THREE.MeshBasicMaterial({ color: '#ffd6a1' }));
    marker.material.depthTest = false; marker.renderOrder = 5;
    this.scene.add(marker); this.marker = marker;
    this.setPlan(plan);
    this.bindPointer();
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(host);
    this.draw();
  }

  applyTexture(texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const { material } = this.surface;
    material.map?.dispose();
    material.map = texture;
    material.color.set('#ffffff');
    material.needsUpdate = true;
  }

  setTexture(canvas) {
    this.applyTexture(new THREE.CanvasTexture(canvas));
    this.draw();
  }

  setColor(color) {
    this.route.material.color.set(color);
  }

  mesh() {
    const { site } = this;
    const step = Math.max(1, Math.ceil(Math.max(site.rows, site.cols) / 230));
    const axis = count => [...Array.from({ length: Math.ceil((count - 1) / step) }, (_, i) => i * step), count - 1];
    const rows = axis(site.rows), cols = axis(site.cols);
    const positions = [], uv = [], triangles = [], valid = [];
    for (const row of rows) for (const col of cols) {
      const [east, north] = cellXY(site, [row, col]);
      const elevation = site.height[row * site.cols + col];
      valid.push(Number.isFinite(elevation));
      positions.push(east, valid.at(-1) ? elevation - this.mid : 0, -north);
      uv.push((col + 0.5) / site.cols, 1 - (row + 0.5) / site.rows);
    }
    for (let row = 0; row < rows.length - 1; row++) for (let col = 0; col < cols.length - 1; col++) {
      const a = row * cols.length + col, b = a + 1, c = a + cols.length, d = c + 1;
      if (valid[a] && valid[c] && valid[b]) triangles.push(a, c, b);
      if (valid[b] && valid[c] && valid[d]) triangles.push(b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(triangles);
    geometry.computeVertexNormals();
    return { geometry, rows, cols };
  }

  heightAt(east, north, fallback) {
    const { site, rows, cols } = this;
    const r = (site.top - north) / site.step - 0.5, c = (east - site.left) / site.step - 0.5;
    const cell = (axis, v) => Math.min(axis.length - 2, Math.max(0, Math.floor(v / axis[1])));
    const y = cell(rows, r), x = cell(cols, c);
    const dx = (c - cols[x]) / (cols[x + 1] - cols[x]), dy = (r - rows[y]) / (rows[y + 1] - rows[y]);
    const z = (row, col) => site.height[rows[row] * site.cols + cols[col]] - this.mid;
    const value = dx + dy <= 1 ? z(y, x) + dx * (z(y, x + 1) - z(y, x)) + dy * (z(y + 1, x) - z(y, x))
      : z(y + 1, x + 1) + (1 - dx) * (z(y + 1, x) - z(y + 1, x + 1)) + (1 - dy) * (z(y, x + 1) - z(y + 1, x + 1));
    return Number.isFinite(value) ? value : fallback - this.mid;
  }

  setPlan(plan) {
    this.route.geometry.dispose();
    this.route.geometry = new THREE.BufferGeometry().setFromPoints(plan.path.map(index => {
      const [e, n] = cellXY(this.site, cellOf(this.site, index));
      return new THREE.Vector3(e, this.heightAt(e, n, this.site.height[index]) + this.markerLift * 0.35, -n);
    }));
    this.draw();
  }

  update(progress, light) {
    if (!progress) return;
    const [e, n] = progress.xy;
    const elevation = this.site.height[progress.cell[0] * this.site.cols + progress.cell[1]];
    this.marker.position.set(e, this.heightAt(e, n, elevation) + this.markerLift, -n);
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
  }
}
