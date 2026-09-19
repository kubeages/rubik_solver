// Animated 3D cube (three.js). Cubies are reset to their home position after
// every turn and the stickers are repainted from the colour array, so no
// rotation error ever accumulates.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { COLORS } from "./cubemodel.js";

const NORMAL_OF = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
const AXIS_OF = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

function roundedRect(size, r) {
  const s = size / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-s + r, -s);
  shape.lineTo(s - r, -s);
  shape.quadraticCurveTo(s, -s, s, -s + r);
  shape.lineTo(s, s - r);
  shape.quadraticCurveTo(s, s, s - r, s);
  shape.lineTo(-s + r, s);
  shape.quadraticCurveTo(-s, s, -s, s - r);
  shape.lineTo(-s, -s + r);
  shape.quadraticCurveTo(-s, -s, -s + r, -s);
  return new THREE.ShapeGeometry(shape);
}

export class Cube3D {
  constructor(container, model) {
    this.container = container;
    this.model = model;
    this.colors = null;
    this.speed = 1;
    this.queue = Promise.resolve();
    this.gen = 0; // bumped to cancel queued animations

    const w = container.clientWidth || 400;
    const h = container.clientHeight || 300;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 100);
    this.resetView();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 16;

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(4, 8, 6);
    this.scene.add(dir);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this._buildCubies();

    new ResizeObserver(() => this._resize()).observe(container);
    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  resetView() {
    this.camera.position.set(5.2, 4.6, 7.2);
    this.camera.lookAt(0, 0, 0);
    if (this.controls) this.controls.target.set(0, 0, 0);
  }

  _resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _buildCubies() {
    this.cubies = new Map();
    const body = new THREE.BoxGeometry(0.98, 0.98, 0.98);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.userData.home = [x, y, z];
      g.add(new THREE.Mesh(body, bodyMat));
      this.root.add(g);
      this.cubies.set(`${x},${y},${z}`, g);
    }
    const geo = roundedRect(0.84, 0.12);
    this.stickerMeshes = this.model.stickers.map(({ pos, normal }) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.35, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geo, mat);
      const n = new THREE.Vector3(...normal);
      m.position.copy(n.clone().multiplyScalar(0.495));
      m.lookAt(n.clone().multiplyScalar(2));
      this.cubies.get(pos.join(",")).add(m);
      return m;
    });
  }

  setColors(colors) {
    this.colors = colors.slice();
    colors.forEach((c, i) => {
      const hex = COLORS[c] ? COLORS[c].hex : "#777777";
      this.stickerMeshes[i].material.color.set(hex);
    });
  }

  highlight(indices) {
    const set = new Set(indices || []);
    this.stickerMeshes.forEach((m, i) => {
      m.material.emissive.set(set.size && set.has(i) ? 0x222222 : 0x000000);
      m.scale.setScalar(set.size && !set.has(i) ? 0.92 : 1);
    });
  }

  // Queue a sequence of moves; resolves once all of them are animated.
  play(moves, { onMove } = {}) {
    const gen = this.gen;
    this.queue = this.queue.then(async () => {
      for (let k = 0; k < moves.length; k++) {
        if (gen !== this.gen) return;
        if (onMove) onMove(k);
        await this._animate(moves[k]);
      }
      if (gen === this.gen && onMove) onMove(moves.length);
    });
    return this.queue;
  }

  // Cancel pending animations and show `colors` as soon as the current turn ends.
  jumpTo(colors) {
    this.gen++;
    this.queue = this.queue.then(() => this.setColors(colors));
    return this.queue;
  }

  _animate(move) {
    const face = move[0];
    const whole = face in AXIS_OF;
    const axis = new THREE.Vector3(...(whole ? AXIS_OF[face] : NORMAL_OF[face]));
    const turns = move.endsWith("2") ? 2 : move.endsWith("'") ? -1 : 1;
    const target = -turns * Math.PI / 2;
    const layer = [];
    for (const g of this.cubies.values()) {
      const p = new THREE.Vector3(...g.userData.home);
      if (whole || Math.round(p.dot(axis)) === 1) layer.push(g);
    }
    const pivot = new THREE.Group();
    this.root.add(pivot);
    layer.forEach((g) => pivot.attach(g));
    const duration = (Math.abs(turns) === 2 ? 520 : 360) / this.speed;
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / duration);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        pivot.setRotationFromAxisAngle(axis, target * e);
        if (t < 1) {
          requestAnimationFrame(step);
          return;
        }
        layer.forEach((g) => {
          this.root.attach(g);
          g.position.set(...g.userData.home);
          g.rotation.set(0, 0, 0);
        });
        this.root.remove(pivot);
        this.setColors(this.model.apply(this.colors, move));
        resolve();
      };
      requestAnimationFrame(step);
    });
  }
}
