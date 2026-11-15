import * as THREE from './vendor/three.module.min.js';
import { cellOf, cellXY } from './planner.js';

export class TerrainView {
  constructor(host, site, plan, { color = '#83ffd0', atlas = false } = {}) {
    this.host = host;
    this.site = site;
    this.meshStride = 1;
    this.meshResolution = site.step * this.meshStride;
    const size = Math.max(site.cols, site.rows) * site.step;
    const relief = Math.max(1, site.depth.max - site.depth.min);
    this.atlas = atlas;
    this.mode = atlas ? 'relief' : 'optical';
    this.autoScale = atlas ? Math.max(1, Math.min(2, Math.round(0.22 * size / relief * 10) / 10))
      : site.step <= 2 ? 2.5 : 1;
    this.verticalScale = this.autoScale;
    this.meshScale = this.verticalScale;
    this.mid = (site.depth.min + site.depth.max) * 0.5;
    this.size = size;
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
    this.describe();
    host.append(this.badge);
    this.initialDistance = size * 1.33;
    this.distance = this.initialDistance;
    this.angle = 0.64; this.pitch = atlas ? 0.49 : 0.74;
    this.target = new THREE.Vector3();
    this.overview = new THREE.Vector3();
    this.focus = new THREE.Vector3();
    this.follow = true;

    const { geometry, rows, cols } = this.mesh();
    this.rows = rows; this.cols = cols; this.geometry = geometry;
    const surface = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: '#b1947b', side: THREE.DoubleSide }));
    surface.name = 'Measured elevation mesh';
    this.ambient = new THREE.AmbientLight(0xffede1, 1.65);
    this.scene.add(surface, this.ambient);
    this.sun = new THREE.DirectionalLight(0xffe4ce, 2.3);
    this.sun.position.set(0.7, 0.8, 0.4);
    this.scene.add(this.sun);
    this.surface = surface;
    if (atlas) {
      this.textureMix = { value: 0.58 };
      surface.material.onBeforeCompile = shader => {
        shader.uniforms.reliefTextureMix = this.textureMix;
        shader.fragmentShader = 'uniform float reliefTextureMix;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
          #ifdef USE_MAP
            vec4 image = texture2D(map, vMapUv);
            diffuseColor *= mix(vec4(1.0), image, reliefTextureMix);
          #endif
        `);
      };
    }
    this.configureMaterial();
    if (site.id) {
      new THREE.TextureLoader().load(`assets/${site.id}/optical.webp`, texture => {
        if (this.disposed) { texture.dispose(); return; }
        this.applyTexture(texture);
        this.draw();
      });
    }
    const route = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color }));
    route.material.depthTest = false; route.renderOrder = 4;
    this.scene.add(route);
    this.route = route;
    this.crewMarker = document.createElement('span');
    this.crewMarker.className = 'terrain-crew-marker';
    this.crewMarker.setAttribute('aria-hidden', 'true');
    this.crewMarker.hidden = true;
    this.projectedCrew = new THREE.Vector3();
    host.append(this.crewMarker);
    this.stations = new THREE.Group(); this.scene.add(this.stations);
    this.setPlan(plan);
    this.bindPointer();
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(host);
    this.draw();
  }

  describe() {
    this.badge.textContent = `高程网格 ${this.meshResolution} m · 垂直显示 ×${this.verticalScale} · 寻路使用原始高程`;
  }

  configureMaterial() {
    const optical = this.mode === 'optical';
    const { material } = this.surface;
    material.vertexColors = !optical;
    material.map = this.texture ?? null;
    if (this.textureMix) this.textureMix.value = optical ? 1 : 0.58;
    material.color.set(optical && !this.texture ? '#b1947b' : '#ffffff');
    material.needsUpdate = true;
    this.ambient.intensity = optical ? 1.65 : 1.05;
    this.sun.intensity = optical ? 2.3 : 3.1;
    if (!optical) this.sun.position.set(-0.85, 0.38, -0.65);
  }

  applyTexture(texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.texture?.dispose();
    this.texture = texture;
    this.configureMaterial();
  }

  setDisplay(mode, scale) {
    this.mode = mode;
    const next = scale === 'auto' ? this.autoScale : Math.max(1, Math.min(6, Number(scale)));
    const changed = this.verticalScale !== next;
    this.verticalScale = next;
    this.surface.scale.y = this.verticalScale / this.meshScale;
    this.configureMaterial();
    this.describe();
    if (changed) {
      const distance = this.distance;
      this.setPlan(this.plan);
      this.distance = distance;
    }
    if (this.progress) this.update(this.progress, this.light);
    else this.draw();
  }

  setTexture(canvas) { this.applyTexture(new THREE.CanvasTexture(canvas)); this.draw(); }
  setColor(color) { this.route.material.color.set(color); this.draw(); }

  mesh() {
    const { site } = this;
    const step = this.meshStride;
    const axis = count => [...Array.from({ length: Math.ceil((count - 1) / step) }, (_, i) => i * step), count - 1];
    const rows = axis(site.rows), cols = axis(site.cols);
    const count = rows.length * cols.length;
    const positions = new Float32Array(count * 3), uv = new Float32Array(count * 2);
    const colors = this.atlas ? new Float32Array(count * 3) : null;
    const triangles = new Uint32Array((rows.length - 1) * (cols.length - 1) * 6);
    const valid = new Uint8Array(count);
    const low = new THREE.Color('#a07365'), middle = new THREE.Color('#d8a67b'), high = new THREE.Color('#fff1ce');
    const tint = new THREE.Color();
    const span = Math.max(1, site.depth.max - site.depth.min);
    const tex = site.textureWindow ?? { col0: 0, row0: 0, cols: site.cols, rows: site.rows };
    let point = 0, offset = 0;
    for (const row of rows) for (const col of cols) {
      const height = site.height[row * site.cols + col];
      valid[point] = Number.isFinite(height);
      positions[point * 3] = site.left + (col + 0.5) * site.step;
      positions[point * 3 + 1] = valid[point] ? (height - this.mid) * this.meshScale : 0;
      positions[point * 3 + 2] = -site.top + (row + 0.5) * site.step;
      uv[point * 2] = (col + tex.col0 + 0.5) / tex.cols;
      uv[point * 2 + 1] = 1 - (row + tex.row0 + 0.5) / tex.rows;
      if (colors && valid[point]) {
        const value = Math.min(1, Math.max(0, (height - site.depth.min) / span));
        tint.copy(value < 0.5 ? low : middle).lerp(value < 0.5 ? middle : high, value < 0.5 ? value * 2 : value * 2 - 1);
        tint.toArray(colors, point * 3);
      }
      point++;
    }
    for (let row = 0; row < rows.length - 1; row++) for (let col = 0; col < cols.length - 1; col++) {
      const a = row * cols.length + col, b = a + 1, c = a + cols.length, d = c + 1;
      if (valid[a] && valid[c] && valid[b]) { triangles[offset++] = a; triangles[offset++] = c; triangles[offset++] = b; }
      if (valid[b] && valid[c] && valid[d]) { triangles[offset++] = b; triangles[offset++] = c; triangles[offset++] = d; }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(triangles.subarray(0, offset), 1));
    geometry.computeVertexNormals();
    return { geometry, rows, cols };
  }

  heightAt(east, north, fallback) {
    const { site, rows, cols } = this;
    const r = (site.top - north) / site.step - 0.5, c = (east - site.left) / site.step - 0.5;
    const cell = (axis, v) => Math.min(axis.length - 2, Math.max(0, Math.floor(v / axis[1])));
    const y = cell(rows, r), x = cell(cols, c);
    const dx = (c - cols[x]) / (cols[x + 1] - cols[x]), dy = (r - rows[y]) / (rows[y + 1] - rows[y]);
    const z = (row, col) => (site.height[rows[row] * site.cols + cols[col]] - this.mid) * this.verticalScale;
    const value = dx + dy <= 1 ? z(y, x) + dx * (z(y, x + 1) - z(y, x)) + dy * (z(y + 1, x) - z(y, x))
      : z(y + 1, x + 1) + (1 - dx) * (z(y + 1, x) - z(y + 1, x + 1)) + (1 - dy) * (z(y, x + 1) - z(y + 1, x + 1));
    const nearest = this.site.height[Math.max(0, Math.min(site.rows - 1, Math.round(r))) * site.cols + Math.max(0, Math.min(site.cols - 1, Math.round(c)))];
    return Number.isFinite(value) ? value : ((fallback ?? nearest) - this.mid) * this.verticalScale;
  }

  setPlan(plan) {
    this.plan = plan;
    this.route.geometry.dispose();
    this.route.geometry = new THREE.BufferGeometry().setFromPoints(plan.path.map(index => {
      const [e, n] = cellXY(this.site, cellOf(this.site, index));
      return new THREE.Vector3(e, this.heightAt(e, n, this.site.height[index]) + 1.5 * this.verticalScale, -n);
    }));
    if (this.atlas) {
      this.route.geometry.computeBoundingBox();
      const bounds = this.route.geometry.boundingBox;
      const extent = bounds.getSize(new THREE.Vector3());
      bounds.getCenter(this.overview);
      this.initialDistance = Math.max(24 * this.site.step, Math.hypot(extent.x, extent.y, extent.z) * 1.15);
      this.distance = this.initialDistance * (this.follow ? 0.62 : 1.18);
    }
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
      const labelText = index === stops.length - 1 ? '目的地' : `经停 ${index + 1}`;
      ctx.fillText(stop.name === labelText ? labelText : `${labelText} · ${stop.name}`, 256, 41, 490);
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
    this.progress = progress;
    this.light = light;
    const [e, n] = progress.xy;
    const elevation = this.site.height[progress.cell[0] * this.site.cols + progress.cell[1]];
    this.focus.set(e, this.heightAt(e, n, elevation) + 4 * this.verticalScale, -n);
    if (light && this.mode === 'optical') this.sun.position.set(light.sun.east, Math.max(0.08, light.sun.up), -light.sun.north);
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
    this.distance = this.initialDistance * (follow ? 0.69 : this.atlas ? 1.18 : 1);
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
    this.target.copy(this.follow ? this.focus : this.overview);
    camera.position.set(Math.sin(this.angle) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.angle) * Math.cos(this.pitch))
      .multiplyScalar(this.distance).add(this.target);
    camera.lookAt(this.target);
    renderer.render(this.scene, camera);
    this.drawCrewMarker(width, height);
  }

  drawCrewMarker(width, height) {
    if (!this.progress) return;
    // Keep the marker tied to the same terrain point at every zoom level.
    const { x, y, z } = this.projectedCrew.copy(this.focus).project(this.camera);
    const visible = Number.isFinite(x) && Number.isFinite(y) && z >= -1 && z <= 1
      && Math.abs(x) <= 1 && Math.abs(y) <= 1;
    this.crewMarker.hidden = !visible;
    if (visible) {
      this.crewMarker.style.left = `${(x + 1) * width / 2}px`;
      this.crewMarker.style.top = `${(1 - y) * height / 2}px`;
    }
  }

  destroy() {
    this.disposed = true;
    this.observer.disconnect();
    this.texture?.dispose();
    this.scene.traverse(object => {
      object.geometry?.dispose();
      if (object !== this.surface) object.material?.map?.dispose();
      object.material?.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.crewMarker.remove();
    this.badge?.remove();
  }
}
