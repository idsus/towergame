import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import './style.css';

const TAU = Math.PI * 2;
const TOTAL_WAVES = 12;
const TOWER_TYPES = {
  sentinel: { name: 'Sentinel', glyph: '◆', cost: 65, damage: 23, range: 8.4, rate: 1.35, color: 0xffb24b, description: 'A disciplined bolt-caster. Fast target acquisition and excellent finishing power.' },
  frost: { name: 'Rimewell', glyph: '✣', cost: 85, damage: 9, range: 7.5, rate: 1.05, color: 0x62d9ff, description: 'Freezes enemy momentum. Repeated hits deepen the slow field around its target.' },
  mortar: { name: 'Starforge', glyph: '⬢', cost: 115, damage: 48, range: 10.5, rate: 0.48, color: 0xff6f61, description: 'Launches unstable stars that detonate across clustered invaders.' },
  prism: { name: 'Prism', glyph: '✦', cost: 140, damage: 15, range: 9.2, rate: 1.8, color: 0xb38cff, description: 'A piercing aether beam. Strikes up to three enemies along its line of fire.' }
};

const ENEMY_TYPES = {
  wisp: { name: 'Wisp', hp: 60, speed: 3.5, reward: 9, scale: .72, color: 0x71e5ff },
  raider: { name: 'Raider', hp: 125, speed: 2.25, reward: 13, scale: .95, color: 0xd98cff },
  bulwark: { name: 'Bulwark', hp: 360, speed: 1.25, reward: 24, scale: 1.3, color: 0xff7b61, armor: .22 },
  shroud: { name: 'Shroud', hp: 190, speed: 1.8, reward: 18, scale: 1.05, color: 0x91a7ff, shield: .35 },
  titan: { name: 'Void Titan', hp: 1850, speed: .82, reward: 120, scale: 2.15, color: 0xff496c, armor: .28, boss: true }
};

const WAVE_TITLES = [
  'THE FIRST BREACH', 'GLASSWING SWARM', 'MARCH OF CINDERS', 'THE IRON ORACLE',
  'SILENCE DESCENDS', 'A HUNDRED EYES', 'THE HOLLOW CHOIR', 'COLOSSUS RISING',
  'NIGHT WITHOUT END', 'SHATTERED LEGION', 'LAST LIGHT', 'THE AETHER EATER'
];

const $ = (selector) => document.querySelector(selector);
const UI = {
  gold: $('#gold-value'), lives: $('#lives-value'), wave: $('#wave-value'), start: $('#start-wave-btn'), startLabel: $('#start-wave-label'),
  startBonus: $('#start-wave-bonus'), countdown: $('#countdown-value'), pause: $('#pause-btn'), speed: $('#speed-btn'), sound: $('#sound-btn'),
  mission: $('#mission-copy'), threatLabel: $('#threat-label'), threatFill: $('#threat-fill'), hint: $('#build-hint'), intro: $('#intro'),
  enter: $('#enter-game-btn'), inspector: $('#inspector'), closeInspector: $('#close-inspector'), inspectorGlyph: $('#inspector-glyph'),
  inspectorName: $('#inspector-name'), inspectorLevel: $('#inspector-level'), inspectorDescription: $('#inspector-description'), power: $('#metric-power'),
  range: $('#metric-range'), resonance: $('#metric-resonance'), upgrade: $('#upgrade-btn'), upgradeCost: $('#upgrade-cost'),
  overdrive: $('#overdrive-btn'), overdriveStatus: $('#overdrive-status'), sell: $('#sell-btn'), sellValue: $('#sell-value'),
  waveBanner: $('#wave-banner'), waveKicker: $('#wave-kicker'), waveTitle: $('#wave-title'), toasts: $('#toast-stack'), cursorTip: $('#cursor-tip'),
  result: $('#result-overlay'), resultKicker: $('#result-kicker'), resultTitle: $('#result-title'), resultCopy: $('#result-copy'),
  resultScore: $('#result-score'), resultWave: $('#result-wave'), resultCore: $('#result-core'), restart: $('#restart-btn')
};

class SoundEngine {
  constructor() { this.ctx = null; this.enabled = true; }
  unlock() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  tone(freq = 220, duration = .08, gain = .04, type = 'sine', slide = 1) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), now + duration);
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(.0001, now + duration);
    osc.connect(amp).connect(this.ctx.destination);
    osc.start(now); osc.stop(now + duration);
  }
  place() { this.tone(180, .12, .045, 'triangle', 1.8); }
  fire(type) {
    const map = { sentinel: [330, .045, .018, 'square', 1.5], frost: [520, .09, .014, 'sine', .7], mortar: [95, .16, .035, 'sawtooth', .55], prism: [680, .055, .012, 'sine', 1.25] };
    this.tone(...map[type]);
  }
  impact(boss = false) { this.tone(boss ? 68 : 140, boss ? .25 : .08, boss ? .055 : .018, 'triangle', .5); }
  wave() { this.tone(196, .5, .035, 'sine', 2); setTimeout(() => this.tone(293, .45, .025, 'sine', 1.5), 120); }
  breach() { this.tone(110, .45, .055, 'sawtooth', .35); }
}

class AetherfallGame {
  constructor() {
    this.container = $('#canvas-wrap');
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050816);
    this.scene.fog = new THREE.FogExp2(0x071126, .0125);
    this.camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, .1, 280);
    this.camera.position.set(28, 30, 31);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .58, .62, .78);
    this.composer.addPass(this.bloom);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .065;
    this.controls.enablePan = false;
    this.controls.minDistance = 23;
    this.controls.maxDistance = 62;
    this.controls.minPolarAngle = .42;
    this.controls.maxPolarAngle = 1.28;
    this.controls.target.set(0, 0, 0);

    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.sound = new SoundEngine();
    this.enemies = [];
    this.towers = [];
    this.projectiles = [];
    this.effects = [];
    this.particles = [];
    this.pads = [];
    this.selectedType = null;
    this.selectedTower = null;
    this.hoveredPad = null;
    this.started = false;
    this.paused = true;
    this.gameOver = false;
    this.speed = 1;
    this.gold = 260;
    this.lives = 20;
    this.wave = 0;
    this.score = 0;
    this.state = 'waiting';
    this.countdown = 20;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.shake = 0;
    this.pointerDown = null;

    this.initWorld();
    this.bindUI();
    this.updateUI();
    this.animate();
  }

  initWorld() {
    this.buildSky();
    this.buildLighting();
    this.buildWater();
    this.buildIsland();
    this.buildPath();
    this.buildPads();
    this.buildPortal();
    this.buildCore();
    this.buildScenery();
  }

  buildSky() {
    const skyGeo = new THREE.SphereGeometry(150, 32, 20);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { topColor: { value: new THREE.Color(0x07132f) }, bottomColor: { value: new THREE.Color(0x1a1640) }, offset: { value: 18 }, exponent: { value: .72 } },
      vertexShader: 'varying vec3 vWorldPosition; void main(){ vec4 worldPosition=modelMatrix*vec4(position,1.0); vWorldPosition=worldPosition.xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent; varying vec3 vWorldPosition; void main(){ float h=normalize(vWorldPosition+offset).y; gl_FragColor=vec4(mix(bottomColor,topColor,max(pow(max(h,0.0),exponent),0.0)),1.0); }'
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));

    const starCount = innerWidth < 700 ? 500 : 1100;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 95 + Math.random() * 35;
      const theta = Math.random() * TAU;
      const phi = Math.acos(THREE.MathUtils.lerp(-.15, .92, Math.random()));
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 4;
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const c = new THREE.Color(Math.random() > .82 ? 0xffc97a : 0x9abfff);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    const starsGeo = new THREE.BufferGeometry();
    starsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starsGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.stars = new THREE.Points(starsGeo, new THREE.PointsMaterial({ size: .18, vertexColors: true, transparent: true, opacity: .82, depthWrite: false }));
    this.scene.add(this.stars);

    const moon = new THREE.Mesh(new THREE.SphereGeometry(7.5, 32, 32), new THREE.MeshBasicMaterial({ color: 0xa8c6ff }));
    moon.position.set(-64, 48, -72);
    this.scene.add(moon);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.radialTexture(), color: 0x6d8dff, transparent: true, opacity: .23, depthWrite: false }));
    halo.position.copy(moon.position); halo.scale.set(32, 32, 1); this.scene.add(halo);
  }

  buildLighting() {
    this.scene.add(new THREE.HemisphereLight(0x718cff, 0x161022, 1.45));
    const moonLight = new THREE.DirectionalLight(0xa7bdff, 2.35);
    moonLight.position.set(-22, 38, -18);
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.set(innerWidth < 700 ? 1024 : 2048, innerWidth < 700 ? 1024 : 2048);
    moonLight.shadow.camera.left = -34; moonLight.shadow.camera.right = 34; moonLight.shadow.camera.top = 34; moonLight.shadow.camera.bottom = -34;
    moonLight.shadow.bias = -.0002;
    this.scene.add(moonLight);
    const rim = new THREE.PointLight(0xff8e42, 16, 42, 2);
    rim.position.set(16, 10, 11); this.scene.add(rim);
  }

  buildWater() {
    const geometry = new THREE.PlaneGeometry(220, 220, 90, 90);
    this.waterMaterial = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: { time: { value: 0 }, deep: { value: new THREE.Color(0x020817) }, crest: { value: new THREE.Color(0x173968) } },
      vertexShader: 'uniform float time; varying float vWave; varying vec3 vPos; void main(){ vec3 p=position; float w=sin(p.x*.14+time*.7)*.32+cos(p.y*.11-time*.5)*.23+sin((p.x+p.y)*.055+time)*.18; p.z+=w; vWave=w; vPos=p; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0); }',
      fragmentShader: 'uniform vec3 deep; uniform vec3 crest; varying float vWave; varying vec3 vPos; void main(){ float ripple=clamp(sin((vPos.x-vPos.y)*.18+vWave*1.8)*.5+.5,0.0,1.0); float line=pow(ripple,16.0)*.035; vec3 c=mix(deep,crest,clamp(vWave+.34,0.0,1.0)); gl_FragColor=vec4(c+line,0.9); }'
    });
    this.water = new THREE.Mesh(geometry, this.waterMaterial);
    this.water.rotation.x = -Math.PI / 2; this.water.position.y = -3.4; this.scene.add(this.water);
  }

  buildIsland() {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x17203a, roughness: .88, metalness: .12, flatShading: true });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x273450, roughness: .74, metalness: .2, flatShading: true });
    const layers = [
      [23.5, 3.2, -1.8, rockMat, 13], [21.8, 2.0, .2, edgeMat, 14], [20.7, .9, 1.48, rockMat, 16]
    ];
    layers.forEach(([r, h, y, mat, seg]) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r * .92, r, h, seg), mat);
      mesh.position.y = y; mesh.rotation.y = .08; mesh.castShadow = mesh.receiveShadow = true; this.scene.add(mesh);
    });
    const top = new THREE.Mesh(new THREE.CircleGeometry(19.15, 48), new THREE.MeshStandardMaterial({ color: 0x29354b, roughness: .92, metalness: .05 }));
    top.rotation.x = -Math.PI / 2; top.position.y = 1.96; top.receiveShadow = true; this.scene.add(top);
  }

  buildPath() {
    this.pathPoints = [
      new THREE.Vector3(-20, 2.22, -10), new THREE.Vector3(-14, 2.22, -7), new THREE.Vector3(-9, 2.22, -10),
      new THREE.Vector3(-3, 2.22, -9), new THREE.Vector3(0, 2.22, -4), new THREE.Vector3(-3, 2.22, 1),
      new THREE.Vector3(-9, 2.22, 3), new THREE.Vector3(-10, 2.22, 9), new THREE.Vector3(-5, 2.22, 13),
      new THREE.Vector3(2, 2.22, 11), new THREE.Vector3(5, 2.22, 6), new THREE.Vector3(10, 2.22, 4),
      new THREE.Vector3(15.5, 2.22, 7.5)
    ];
    this.pathCurve = new THREE.CatmullRomCurve3(this.pathPoints, false, 'catmullrom', .12);
    this.pathLength = this.pathCurve.getLength();
    const count = 150, width = 2.25;
    const vertices = [], uvs = [], indices = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count, point = this.pathCurve.getPoint(t), tangent = this.pathCurve.getTangent(t);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      for (const side of [-1, 1]) {
        const p = point.clone().addScaledVector(normal, width * side);
        vertices.push(p.x, p.y, p.z); uvs.push(side === -1 ? 0 : 1, t * 16);
      }
      if (i < count) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(indices); geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x374059, roughness: .73, metalness: .22, emissive: 0x13182d, emissiveIntensity: .25 }));
    road.receiveShadow = true; this.scene.add(road);

    const tracePoints = this.pathCurve.getSpacedPoints(170).map((p, i) => p.clone().setY(2.31 + Math.sin(i * .7) * .01));
    const traceGeo = new THREE.BufferGeometry().setFromPoints(tracePoints);
    this.pathTrace = new THREE.Line(traceGeo, new THREE.LineBasicMaterial({ color: 0x687fb5, transparent: true, opacity: .36 }));
    this.scene.add(this.pathTrace);

    for (let i = 5; i < 160; i += 9) {
      const p = this.pathCurve.getPoint(i / 165), t = this.pathCurve.getTangent(i / 165), n = new THREE.Vector3(-t.z, 0, t.x).normalize();
      [-1, 1].forEach(side => {
        const rune = new THREE.Mesh(new THREE.BoxGeometry(.12, .05, .7), new THREE.MeshBasicMaterial({ color: 0x7694d5, transparent: true, opacity: .38 }));
        rune.position.copy(p).addScaledVector(n, side * 1.73); rune.position.y += .08; rune.rotation.y = Math.atan2(t.x, t.z); this.scene.add(rune);
      });
    }
  }

  buildPads() {
    const coords = [
      [-15, -13], [-12, -3], [-7, -6], [-4, -14], [3, -8], [5, -2], [-5, -1], [-14, 5],
      [-6, 7], [-14, 12], [0, 15], [5, 9], [10, 0], [12, 11], [17, 2], [17, 12]
    ];
    coords.forEach((coord, index) => {
      const group = new THREE.Group();
      group.position.set(coord[0], 2.2, coord[1]);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.18, 1.32, .24, 12), new THREE.MeshStandardMaterial({ color: 0x26304a, roughness: .64, metalness: .62, emissive: 0x1a2846, emissiveIntensity: .28 }));
      disc.receiveShadow = disc.castShadow = true;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.83, .045, 6, 32), new THREE.MeshBasicMaterial({ color: 0x6b82af, transparent: true, opacity: .7 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = .15;
      const rune = new THREE.Mesh(new THREE.OctahedronGeometry(.16), new THREE.MeshBasicMaterial({ color: 0x8ca6d8 })); rune.position.y = .17;
      group.add(disc, ring, rune); group.userData.padIndex = index; group.userData.ring = ring; group.userData.rune = rune;
      this.scene.add(group);
      this.pads.push({ index, group, position: group.position.clone(), tower: null, ring, rune });
    });
  }

  buildPortal() {
    const group = new THREE.Group(); group.position.copy(this.pathPoints[0]).add(new THREE.Vector3(-.5, .8, -.2));
    const stone = new THREE.MeshStandardMaterial({ color: 0x242a46, roughness: .72, metalness: .28 });
    for (let i = 0; i < 9; i++) {
      const angle = Math.PI * (i / 8);
      const block = new THREE.Mesh(new THREE.BoxGeometry(.78, 1.12, .72), stone);
      block.position.set(Math.cos(angle) * 3, Math.sin(angle) * 3, 0); block.rotation.z = angle - Math.PI / 2; block.castShadow = true; group.add(block);
    }
    const portal = new THREE.Mesh(new THREE.CircleGeometry(2.25, 40), new THREE.MeshBasicMaterial({ color: 0x5d32a8, transparent: true, opacity: .78, side: THREE.DoubleSide }));
    portal.position.z = .1; group.add(portal);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(2.25, .08, 8, 48), new THREE.MeshBasicMaterial({ color: 0xc28cff })); inner.position.z = .15; group.add(inner);
    const light = new THREE.PointLight(0x9e63ff, 14, 18); light.position.set(0, 1.8, 2); group.add(light);
    group.rotation.y = .35; this.portal = group; this.scene.add(group);
  }

  buildCore() {
    const group = new THREE.Group(); group.position.copy(this.pathPoints.at(-1)).add(new THREE.Vector3(.8, .2, 0));
    const dark = new THREE.MeshStandardMaterial({ color: 0x252c42, roughness: .42, metalness: .65 });
    const gold = new THREE.MeshStandardMaterial({ color: 0x9a693b, roughness: .34, metalness: .8, emissive: 0x4d250a, emissiveIntensity: .45 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.6, 1.2, 8), dark); base.castShadow = true; group.add(base);
    for (let i = 0; i < 4; i++) {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(.7, 4.6, .7), dark);
      const a = i * TAU / 4 + Math.PI / 4; pylon.position.set(Math.cos(a) * 2.1, 2.7, Math.sin(a) * 2.1); pylon.rotation.z = Math.cos(a) * .18; pylon.rotation.x = Math.sin(a) * .18; pylon.castShadow = true; group.add(pylon);
    }
    const rings = [1.25, 1.75];
    rings.forEach((r, i) => { const ring = new THREE.Mesh(new THREE.TorusGeometry(r, .09, 8, 40), gold); ring.position.y = 3.2; ring.rotation.x = i ? Math.PI / 2 : 0; group.add(ring); });
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.18, 1), new THREE.MeshStandardMaterial({ color: 0x8ff6ff, emissive: 0x35c8ff, emissiveIntensity: 3, roughness: .15, metalness: .1 }));
    crystal.position.y = 3.2; crystal.castShadow = true; group.add(crystal);
    const coreLight = new THREE.PointLight(0x52ddff, 28, 24, 2); coreLight.position.y = 3.2; group.add(coreLight);
    this.coreCrystal = crystal; this.coreRings = rings; this.core = group; this.scene.add(group);
  }

  buildScenery() {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x1c2840, roughness: .83, flatShading: true });
    for (let i = 0; i < 38; i++) {
      const a = Math.random() * TAU, r = 17.2 + Math.random() * 4;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(.35 + Math.random() * 1.05, 0), rockMat);
      rock.scale.y = 1 + Math.random() * 2.2; rock.position.set(Math.cos(a) * r, 2 + Math.random() * .3, Math.sin(a) * r); rock.rotation.set(Math.random(), Math.random(), Math.random()); rock.castShadow = true; this.scene.add(rock);
    }
    const crystalMat = new THREE.MeshStandardMaterial({ color: 0x6f8bff, emissive: 0x263caa, emissiveIntensity: 1.5, roughness: .18, metalness: .12 });
    for (let i = 0; i < 17; i++) {
      const a = Math.random() * TAU, r = 18 + Math.random() * 3;
      const crystal = new THREE.Mesh(new THREE.ConeGeometry(.14 + Math.random() * .18, .8 + Math.random() * 1.6, 5), crystalMat);
      crystal.position.set(Math.cos(a) * r, 2.3, Math.sin(a) * r); crystal.rotation.z = (Math.random() - .5) * .5; this.scene.add(crystal);
    }
    const moteGeo = new THREE.BufferGeometry(); const moteCount = innerWidth < 700 ? 80 : 180; const motePos = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) motePos.set([(Math.random() - .5) * 50, 2 + Math.random() * 18, (Math.random() - .5) * 50], i * 3);
    moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
    this.motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: 0x85cfff, size: .08, transparent: true, opacity: .6, depthWrite: false })); this.scene.add(this.motes);
  }

  radialTexture() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128; const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64); gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(.2, 'rgba(255,255,255,.45)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(canvas);
  }

  bindUI() {
    window.addEventListener('resize', () => this.resize());
    UI.enter.addEventListener('click', () => this.enterGame());
    UI.restart.addEventListener('click', () => location.reload());
    UI.start.addEventListener('click', () => this.startWave(true));
    UI.pause.addEventListener('click', () => this.togglePause());
    UI.speed.addEventListener('click', () => this.cycleSpeed());
    UI.sound.addEventListener('click', () => { this.sound.enabled = !this.sound.enabled; UI.sound.textContent = this.sound.enabled ? '♪' : '×'; this.sound.unlock(); });
    document.querySelectorAll('.tower-choice').forEach(button => button.addEventListener('click', () => this.selectBuildType(button.dataset.tower)));
    UI.closeInspector.addEventListener('click', () => this.selectTower(null));
    UI.upgrade.addEventListener('click', () => this.upgradeSelected());
    UI.sell.addEventListener('click', () => this.sellSelected());
    UI.overdrive.addEventListener('click', () => this.overdriveSelected());
    this.renderer.domElement.addEventListener('pointermove', event => this.onPointerMove(event));
    this.renderer.domElement.addEventListener('pointerdown', event => { this.pointerDown = { x: event.clientX, y: event.clientY }; });
    this.renderer.domElement.addEventListener('pointerup', event => this.onPointerUp(event));
    this.renderer.domElement.addEventListener('pointerleave', () => this.setHoveredPad(null));
    window.addEventListener('keydown', event => this.onKey(event));
  }

  enterGame() {
    this.sound.unlock(); this.sound.wave(); this.started = true; this.paused = false; UI.intro.classList.add('hidden');
    this.toast('RUNES ONLINE · CHOOSE A DEFENSE');
    this.animateCameraTo(new THREE.Vector3(24, 27, 28), new THREE.Vector3(0, 1, 1));
  }

  onKey(event) {
    if (event.repeat || !this.started || this.gameOver) return;
    if (['1', '2', '3', '4'].includes(event.key)) this.selectBuildType(Object.keys(TOWER_TYPES)[Number(event.key) - 1]);
    if (event.key.toLowerCase() === 'p') this.togglePause();
    if (event.code === 'Space') { event.preventDefault(); if (this.state === 'waiting') this.startWave(true); else this.togglePause(); }
    if (event.key === 'Escape') { this.selectBuildType(null); this.selectTower(null); }
  }

  selectBuildType(type) {
    if (!type || !TOWER_TYPES[type]) {
      this.selectedType = null;
      document.querySelectorAll('.tower-choice').forEach(b => b.classList.remove('selected'));
      UI.hint.textContent = 'Select a tower, then choose a vacant rune.';
      UI.cursorTip.classList.remove('show');
      this.pads.forEach(pad => { if (!pad.tower) pad.ring.material.color.set(0x6b82af); });
      return;
    }
    this.sound.unlock(); this.selectedType = this.selectedType === type ? null : type; this.selectTower(null);
    document.querySelectorAll('.tower-choice').forEach(b => b.classList.toggle('selected', b.dataset.tower === this.selectedType));
    UI.hint.textContent = this.selectedType ? `${TOWER_TYPES[type].name.toUpperCase()} ARMED · CHOOSE A VACANT RUNE` : 'Select a tower, then choose a vacant rune.';
    this.pads.forEach(pad => { if (!pad.tower) pad.ring.material.color.set(this.selectedType ? TOWER_TYPES[this.selectedType].color : 0x6b82af); });
  }

  onPointerMove(event) {
    this.pointer.x = (event.clientX / innerWidth) * 2 - 1; this.pointer.y = -(event.clientY / innerHeight) * 2 + 1;
    UI.cursorTip.style.left = `${event.clientX}px`; UI.cursorTip.style.top = `${event.clientY}px`;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const padHits = this.raycaster.intersectObjects(this.pads.map(p => p.group), true);
    if (padHits.length) {
      let node = padHits[0].object; while (node.parent && node.userData.padIndex === undefined) node = node.parent;
      const pad = this.pads[node.userData.padIndex]; this.setHoveredPad(pad);
      UI.cursorTip.textContent = pad.tower ? `${TOWER_TYPES[pad.tower.type].name} · LEVEL ${pad.tower.level}` : this.selectedType ? `BUILD ${TOWER_TYPES[this.selectedType].name.toUpperCase()}` : 'VACANT RUNE';
      UI.cursorTip.classList.add('show'); this.renderer.domElement.style.cursor = 'pointer';
    } else { this.setHoveredPad(null); UI.cursorTip.classList.remove('show'); this.renderer.domElement.style.cursor = this.selectedType ? 'crosshair' : 'grab'; }
  }

  onPointerUp(event) {
    if (!this.pointerDown || Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y) > 7) return;
    this.pointer.x = (event.clientX / innerWidth) * 2 - 1; this.pointer.y = -(event.clientY / innerHeight) * 2 + 1; this.raycaster.setFromCamera(this.pointer, this.camera);
    const towerHits = this.raycaster.intersectObjects(this.towers.map(t => t.group), true);
    if (towerHits.length && !this.selectedType) {
      let node = towerHits[0].object; while (node.parent && node.userData.towerId === undefined) node = node.parent;
      this.selectTower(this.towers.find(t => t.id === node.userData.towerId)); return;
    }
    const padHits = this.raycaster.intersectObjects(this.pads.map(p => p.group), true);
    if (padHits.length) {
      let node = padHits[0].object; while (node.parent && node.userData.padIndex === undefined) node = node.parent;
      const pad = this.pads[node.userData.padIndex];
      if (pad.tower) this.selectTower(pad.tower); else if (this.selectedType) this.buildTower(pad, this.selectedType);
    } else this.selectTower(null);
  }

  setHoveredPad(pad) {
    if (this.hoveredPad && this.hoveredPad !== pad) this.hoveredPad.group.scale.setScalar(1);
    this.hoveredPad = pad;
    if (pad) pad.group.scale.setScalar(1.08);
  }

  createTowerVisual(type) {
    const cfg = TOWER_TYPES[type], group = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x222b42, roughness: .42, metalness: .72 });
    const accent = new THREE.MeshStandardMaterial({ color: cfg.color, emissive: cfg.color, emissiveIntensity: 1.8, roughness: .24, metalness: .35 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.72, .92, .65, 8), dark); base.position.y = .5; base.castShadow = true; group.add(base);
    const pivot = new THREE.Group(); pivot.position.y = .95; group.add(pivot);
    if (type === 'sentinel') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(.68, 1.45, .7), dark); body.position.y = .55; body.castShadow = true; pivot.add(body);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.12, .16, 1.35, 8), accent); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 1.05, .55); pivot.add(barrel);
      const eye = new THREE.Mesh(new THREE.OctahedronGeometry(.23), accent); eye.position.set(0, 1.1, 0); pivot.add(eye);
    } else if (type === 'frost') {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(.52, .7, .62, 10), dark); bowl.position.y = .32; pivot.add(bowl);
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.58, 0), accent); crystal.position.y = 1.2; crystal.scale.y = 1.55; pivot.add(crystal); pivot.userData.spinner = crystal;
      for (let i = 0; i < 3; i++) { const shard = new THREE.Mesh(new THREE.ConeGeometry(.12, .65, 5), accent); const a = i * TAU / 3; shard.position.set(Math.cos(a) * .65, .7, Math.sin(a) * .65); shard.rotation.z = Math.cos(a) * .45; pivot.add(shard); }
    } else if (type === 'mortar') {
      const cradle = new THREE.Mesh(new THREE.CylinderGeometry(.65, .72, .9, 8), dark); cradle.position.y = .4; pivot.add(cradle);
      const cannon = new THREE.Mesh(new THREE.CylinderGeometry(.3, .44, 1.45, 10), dark); cannon.rotation.x = -1.05; cannon.position.set(0, 1.02, .38); pivot.add(cannon);
      const core = new THREE.Mesh(new THREE.SphereGeometry(.28, 12, 8), accent); core.position.set(0, 1.42, .66); pivot.add(core);
    } else {
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(.28, .48, 1.55, 6), dark); spire.position.y = .75; pivot.add(spire);
      const prism = new THREE.Mesh(new THREE.OctahedronGeometry(.52, 0), accent); prism.position.y = 1.7; prism.scale.y = 1.35; pivot.add(prism); pivot.userData.spinner = prism;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.7, .055, 6, 28), accent); ring.position.y = 1.7; ring.rotation.x = Math.PI / 2; pivot.add(ring); pivot.userData.ring = ring;
    }
    group.userData.pivot = pivot; return group;
  }

  buildTower(pad, type) {
    const cfg = TOWER_TYPES[type];
    if (this.gold < cfg.cost) { this.toast(`INSUFFICIENT AETHER · NEED ${cfg.cost - this.gold}`); this.sound.breach(); return; }
    this.gold -= cfg.cost;
    const group = this.createTowerVisual(type); group.position.copy(pad.position); group.position.y += .18; this.scene.add(group);
    const tower = { id: crypto.randomUUID(), type, pad, group, level: 1, cooldown: Math.random() * .35, target: null, totalSpent: cfg.cost, overdrive: 0, overdriveCooldown: 0, resonance: 1 };
    group.userData.towerId = tower.id; pad.tower = tower; pad.rune.visible = false; pad.ring.material.color.set(cfg.color); this.towers.push(tower);
    this.recalculateResonance(); this.spawnBurst(group.position.clone().add(new THREE.Vector3(0, 1.2, 0)), cfg.color, 14, .14); this.sound.place();
    this.toast(`${cfg.name.toUpperCase()} ONLINE`); this.selectTower(tower); this.selectBuildType(null); this.updateUI();
  }

  recalculateResonance() {
    this.towers.forEach(tower => {
      const neighbors = this.towers.filter(other => other !== tower && other.group.position.distanceTo(tower.group.position) < 8.2);
      const disciplines = new Set(neighbors.map(n => n.type).filter(type => type !== tower.type));
      tower.resonance = 1 + Math.min(.24, disciplines.size * .08);
    });
  }

  selectTower(tower) {
    if (this.selectedTower?.rangeRing) { this.scene.remove(this.selectedTower.rangeRing); this.selectedTower.rangeRing.geometry.dispose(); }
    this.selectedTower = tower;
    if (!tower) { UI.inspector.classList.remove('open'); return; }
    this.selectBuildType(null);
    const cfg = TOWER_TYPES[tower.type];
    const ring = new THREE.Mesh(new THREE.RingGeometry(cfg.range * .97, cfg.range, 64), new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: .19, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.copy(tower.group.position); ring.position.y = 2.32; this.scene.add(ring); tower.rangeRing = ring;
    UI.inspector.classList.add('open'); this.refreshInspector();
  }

  refreshInspector() {
    const tower = this.selectedTower; if (!tower) return;
    const cfg = TOWER_TYPES[tower.type], mult = 1 + (tower.level - 1) * .52, upgradeCost = Math.round(cfg.cost * (.72 + tower.level * .42));
    UI.inspectorGlyph.textContent = cfg.glyph; UI.inspectorGlyph.style.color = `#${cfg.color.toString(16).padStart(6, '0')}`;
    UI.inspectorName.textContent = cfg.name; UI.inspectorLevel.textContent = `LEVEL ${tower.level} · ${tower.type === 'mortar' ? 'AREA CONTROL' : tower.type === 'frost' ? 'TEMPO CONTROL' : 'AETHER OFFENSE'}`;
    UI.inspectorDescription.textContent = cfg.description; UI.power.textContent = Math.round(cfg.damage * mult * tower.resonance); UI.range.textContent = (cfg.range * (1 + (tower.level - 1) * .04)).toFixed(1);
    UI.resonance.textContent = tower.resonance > 1 ? `+${Math.round((tower.resonance - 1) * 100)}%` : 'STABLE';
    UI.upgrade.disabled = tower.level >= 4 || this.gold < upgradeCost; UI.upgradeCost.textContent = tower.level >= 4 ? '· MAX' : `· ${upgradeCost}`;
    UI.sell.disabled = false; UI.sellValue.textContent = `· +${Math.round(tower.totalSpent * .68)}`;
    UI.overdrive.disabled = tower.overdriveCooldown > 0; UI.overdriveStatus.textContent = tower.overdrive > 0 ? `· ${tower.overdrive.toFixed(0)}s` : tower.overdriveCooldown > 0 ? `· ${tower.overdriveCooldown.toFixed(0)}s` : '· READY';
  }

  upgradeSelected() {
    const tower = this.selectedTower; if (!tower || tower.level >= 4) return;
    const cfg = TOWER_TYPES[tower.type], cost = Math.round(cfg.cost * (.72 + tower.level * .42)); if (this.gold < cost) return;
    this.gold -= cost; tower.totalSpent += cost; tower.level++;
    tower.group.scale.setScalar(1 + (tower.level - 1) * .08); this.spawnBurst(tower.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)), cfg.color, 20, .18); this.sound.place();
    this.toast(`${cfg.name.toUpperCase()} ASCENDED · LEVEL ${tower.level}`); this.refreshInspector(); this.updateUI();
  }

  sellSelected() {
    const tower = this.selectedTower; if (!tower) return; const value = Math.round(tower.totalSpent * .68);
    this.gold += value; tower.pad.tower = null; tower.pad.rune.visible = true; tower.pad.ring.material.color.set(0x6b82af); this.scene.remove(tower.group);
    this.towers = this.towers.filter(t => t !== tower); this.spawnBurst(tower.group.position.clone(), 0x8ca6d8, 12, .12); this.recalculateResonance(); this.selectTower(null); this.toast(`TOWER DISMANTLED · +${value}`); this.updateUI();
  }

  overdriveSelected() {
    const tower = this.selectedTower; if (!tower || tower.overdriveCooldown > 0) return;
    tower.overdrive = 8; tower.overdriveCooldown = 34; this.spawnBurst(tower.group.position.clone().add(new THREE.Vector3(0, 1.5, 0)), TOWER_TYPES[tower.type].color, 26, .22); this.sound.wave(); this.toast('OVERDRIVE ENGAGED · 8 SECONDS'); this.refreshInspector();
  }

  startWave(manual = false) {
    if (!this.started || this.state !== 'waiting' || this.wave >= TOTAL_WAVES || this.gameOver) return;
    if (manual && this.countdown > 0) { const bonus = Math.ceil(this.countdown * .9); this.gold += bonus; this.toast(`EARLY DEPLOYMENT · +${bonus} AETHER`); }
    this.wave++; this.state = 'running'; this.countdown = 0; this.spawnQueue = this.createWave(this.wave); this.spawnTimer = .5; UI.wave.textContent = this.wave;
    UI.waveKicker.textContent = `WAVE ${String(this.wave).padStart(2, '0')}`; UI.waveTitle.textContent = WAVE_TITLES[this.wave - 1]; UI.waveBanner.classList.remove('show'); void UI.waveBanner.offsetWidth; UI.waveBanner.classList.add('show');
    UI.start.disabled = true; this.sound.wave(); this.updateMission(); this.updateUI();
  }

  createWave(wave) {
    const queue = []; const scale = 1 + (wave - 1) * .19;
    const add = (type, count, spacing = .8) => { for (let i = 0; i < count; i++) queue.push({ type, delay: spacing, hpScale: scale }); };
    if (wave % 4 === 0) { add('raider', 5 + wave, .52); add('bulwark', 2 + wave / 2, 1); add('titan', 1, 1.4); }
    else if (wave <= 2) { add('wisp', 8 + wave * 3, .62); if (wave === 2) add('raider', 4, .8); }
    else { add('wisp', 5 + wave, .42); add('raider', 5 + Math.floor(wave * .7), .6); if (wave >= 5) add('shroud', 2 + Math.floor(wave / 2), .82); add('bulwark', Math.floor(wave / 3), 1.15); }
    if (wave === 12) { add('shroud', 8, .5); add('titan', 1, 1.8); }
    return queue;
  }

  spawnEnemy(data) {
    const cfg = ENEMY_TYPES[data.type], group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: cfg.color, emissive: cfg.color, emissiveIntensity: cfg.boss ? 1.2 : .52, roughness: .35, metalness: .28, flatShading: true });
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x171a2c, roughness: .5, metalness: .65, flatShading: true });
    let body;
    if (data.type === 'wisp') body = new THREE.Mesh(new THREE.TetrahedronGeometry(.68, 1), bodyMat);
    else if (data.type === 'bulwark') { body = new THREE.Mesh(new THREE.DodecahedronGeometry(.86, 0), shellMat); const core = new THREE.Mesh(new THREE.OctahedronGeometry(.45), bodyMat); group.add(core); }
    else if (data.type === 'titan') { body = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 1), shellMat); const core = new THREE.Mesh(new THREE.OctahedronGeometry(.62), bodyMat); core.scale.y = 1.6; group.add(core); }
    else body = new THREE.Mesh(new THREE.OctahedronGeometry(.72, 0), bodyMat);
    body.castShadow = true; group.add(body);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.82, .06, 6, 24), new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: .75 })); ring.rotation.x = Math.PI / 2; group.add(ring);
    if (cfg.shield) { const shield = new THREE.Mesh(new THREE.SphereGeometry(1.03, 12, 8), new THREE.MeshBasicMaterial({ color: 0x7d8fff, transparent: true, opacity: .14, wireframe: true })); group.add(shield); }
    group.scale.setScalar(cfg.scale); group.position.copy(this.pathCurve.getPoint(0)); group.position.y += .65 * cfg.scale; this.scene.add(group);
    const hp = cfg.hp * data.hpScale; const enemy = { id: crypto.randomUUID(), type: data.type, cfg, group, hp, maxHp: hp, progress: 0, slow: 1, slowTimer: 0, dead: false, ring, phase: Math.random() * TAU };
    this.createHealthBar(enemy); this.enemies.push(enemy);
    if (cfg.boss) { this.toast('BOSS SIGNATURE DETECTED'); this.shake = .35; }
  }

  createHealthBar(enemy) {
    const group = new THREE.Group(); const back = new THREE.Mesh(new THREE.PlaneGeometry(1.5, .11), new THREE.MeshBasicMaterial({ color: 0x10131f, transparent: true, opacity: .9, depthTest: false }));
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(1.45, .07), new THREE.MeshBasicMaterial({ color: enemy.cfg.boss ? 0xff496c : 0x7ce4cf, depthTest: false })); fill.position.z = .01; group.add(back, fill); group.position.y = enemy.cfg.boss ? 1.65 : 1.2; enemy.group.add(group); enemy.healthGroup = group; enemy.healthFill = fill;
  }

  updateEnemies(dt) {
    for (const enemy of [...this.enemies]) {
      if (enemy.dead) continue;
      if (enemy.slowTimer > 0) enemy.slowTimer -= dt; else enemy.slow = THREE.MathUtils.lerp(enemy.slow, 1, dt * 2);
      enemy.progress += (enemy.cfg.speed * enemy.slow * dt) / this.pathLength;
      if (enemy.progress >= 1) { this.enemyBreach(enemy); continue; }
      const p = this.pathCurve.getPoint(enemy.progress), tangent = this.pathCurve.getTangent(enemy.progress); enemy.group.position.copy(p); enemy.group.position.y += .65 * enemy.cfg.scale + Math.sin(performance.now() * .003 + enemy.phase) * .12;
      enemy.group.rotation.y = Math.atan2(tangent.x, tangent.z); enemy.ring.rotation.z += dt * 1.5; enemy.healthGroup.quaternion.copy(this.camera.quaternion);
    }
  }

  enemyBreach(enemy) {
    this.removeEnemy(enemy); const damage = enemy.cfg.boss ? 6 : enemy.type === 'bulwark' ? 2 : 1; this.lives = Math.max(0, this.lives - damage); this.shake = .55; this.sound.breach(); this.spawnBurst(this.core.position.clone().add(new THREE.Vector3(0, 3, 0)), 0xff496c, 25, .24);
    this.toast(`CORE BREACH · -${damage}`); this.updateUI(); if (this.lives <= 0) this.endGame(false);
  }

  damageEnemy(enemy, damage, source, pierce = false) {
    if (!enemy || enemy.dead) return;
    let dealt = damage; if (enemy.cfg.armor && !pierce) dealt *= 1 - enemy.cfg.armor; if (enemy.cfg.shield && source !== 'prism') dealt *= 1 - enemy.cfg.shield;
    enemy.hp -= dealt; const ratio = Math.max(0, enemy.hp / enemy.maxHp); enemy.healthFill.scale.x = ratio; enemy.healthFill.position.x = -.725 * (1 - ratio);
    if (enemy.hp <= 0) this.killEnemy(enemy);
  }

  killEnemy(enemy) {
    if (enemy.dead) return; enemy.dead = true; this.gold += enemy.cfg.reward; this.score += Math.round(enemy.maxHp + enemy.progress * 50); this.sound.impact(enemy.cfg.boss); this.spawnBurst(enemy.group.position.clone(), enemy.cfg.color, enemy.cfg.boss ? 42 : 12, enemy.cfg.boss ? .34 : .16); if (enemy.cfg.boss) this.shake = .65; this.removeEnemy(enemy); this.updateUI();
  }

  removeEnemy(enemy) { this.scene.remove(enemy.group); this.enemies = this.enemies.filter(e => e !== enemy); }

  updateTowers(dt) {
    for (const tower of this.towers) {
      const cfg = TOWER_TYPES[tower.type], levelMult = 1 + (tower.level - 1) * .52, range = cfg.range * (1 + (tower.level - 1) * .04), over = tower.overdrive > 0 ? 1.8 : 1;
      tower.cooldown -= dt; tower.overdrive = Math.max(0, tower.overdrive - dt); tower.overdriveCooldown = Math.max(0, tower.overdriveCooldown - dt);
      if (tower.group.userData.pivot.userData.spinner) tower.group.userData.pivot.userData.spinner.rotation.y += dt * (tower.overdrive > 0 ? 5 : 1.6);
      if (tower.group.userData.pivot.userData.ring) tower.group.userData.pivot.userData.ring.rotation.z += dt;
      const candidates = this.enemies.filter(e => !e.dead && e.group.position.distanceTo(tower.group.position) <= range).sort((a, b) => b.progress - a.progress);
      tower.target = candidates[0] || null;
      if (tower.target) {
        const dir = tower.target.group.position.clone().sub(tower.group.position); tower.group.userData.pivot.rotation.y = THREE.MathUtils.lerp(tower.group.userData.pivot.rotation.y, Math.atan2(dir.x, dir.z), Math.min(1, dt * 8));
        if (tower.cooldown <= 0) { this.fireTower(tower, candidates, cfg.damage * levelMult * tower.resonance * over); tower.cooldown = 1 / (cfg.rate * (1 + (tower.level - 1) * .12) * over); }
      }
    }
    if (this.selectedTower) this.refreshInspector();
  }

  fireTower(tower, candidates, damage) {
    const type = tower.type, target = candidates[0]; if (!target) return; this.sound.fire(type);
    const start = tower.group.position.clone().add(new THREE.Vector3(0, type === 'prism' ? 2.65 : 2.05, 0));
    if (type === 'sentinel') this.createProjectile(start, target, damage, type, .22);
    else if (type === 'frost') { this.damageEnemy(target, damage, type); target.slow = Math.max(.42, target.slow - .13); target.slowTimer = 1.7; this.createBeam(start, target.group.position, 0x62d9ff, .12, .035); }
    else if (type === 'mortar') this.createProjectile(start, target, damage, type, .72);
    else {
      const dir = target.group.position.clone().sub(start).normalize(), length = TOWER_TYPES.prism.range * 1.35;
      const victims = this.enemies.filter(e => { const rel = e.group.position.clone().sub(start); const projected = rel.dot(dir); if (projected < 0 || projected > length) return false; return rel.sub(dir.clone().multiplyScalar(projected)).length() < 1.15; }).sort((a, b) => b.progress - a.progress).slice(0, 3);
      victims.forEach((enemy, i) => this.damageEnemy(enemy, damage * (1 - i * .18), type, true)); this.createBeam(start, start.clone().add(dir.multiplyScalar(length)), 0xb38cff, .16, .075);
    }
  }

  createProjectile(start, target, damage, type, duration) {
    const cfg = TOWER_TYPES[type]; const mesh = new THREE.Mesh(new THREE.SphereGeometry(type === 'mortar' ? .24 : .13, 8, 6), new THREE.MeshBasicMaterial({ color: cfg.color })); mesh.position.copy(start); this.scene.add(mesh);
    this.projectiles.push({ mesh, start, target, damage, type, duration, age: 0, targetPoint: target.group.position.clone() });
  }

  updateProjectiles(dt) {
    for (const p of [...this.projectiles]) {
      p.age += dt; const t = Math.min(1, p.age / p.duration); if (!p.target.dead) p.targetPoint.copy(p.target.group.position);
      p.mesh.position.lerpVectors(p.start, p.targetPoint, t); if (p.type === 'mortar') p.mesh.position.y += Math.sin(t * Math.PI) * 5;
      if (t >= 1) {
        if (p.type === 'mortar') { this.createExplosion(p.targetPoint, 0xff6f61, 2.35); this.enemies.filter(e => e.group.position.distanceTo(p.targetPoint) < 2.6).forEach(e => this.damageEnemy(e, p.damage, p.type)); this.shake = Math.max(this.shake, .1); }
        else this.damageEnemy(p.target, p.damage, p.type);
        this.scene.remove(p.mesh); this.projectiles = this.projectiles.filter(x => x !== p);
      }
    }
  }

  createBeam(a, b, color, life, width) {
    const line = new THREE.Mesh(new THREE.CylinderGeometry(width, width, a.distanceTo(b), 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .95 }));
    line.position.copy(a).lerp(b, .5); line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); this.scene.add(line); this.effects.push({ mesh: line, life, maxLife: life, grow: false });
  }

  createExplosion(position, color, radius) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(.25, .42, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9, side: THREE.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.copy(position); ring.position.y = 2.4; this.scene.add(ring); this.effects.push({ mesh: ring, life: .42, maxLife: .42, grow: true, radius }); this.spawnBurst(position.clone().setY(2.7), color, 18, .25);
  }

  spawnBurst(position, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(.045 + Math.random() * .08), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })); mesh.position.copy(position); this.scene.add(mesh);
      const velocity = new THREE.Vector3((Math.random() - .5) * 2, Math.random() * 1.5, (Math.random() - .5) * 2).normalize().multiplyScalar(speed * (3 + Math.random() * 5));
      this.particles.push({ mesh, velocity, life: .45 + Math.random() * .55, maxLife: 1 });
    }
  }

  updateEffects(dt) {
    for (const effect of [...this.effects]) { effect.life -= dt; effect.mesh.material.opacity = Math.max(0, effect.life / effect.maxLife); if (effect.grow) { const s = THREE.MathUtils.lerp(effect.radius, .3, effect.life / effect.maxLife); effect.mesh.scale.setScalar(s); } if (effect.life <= 0) { this.scene.remove(effect.mesh); this.effects = this.effects.filter(e => e !== effect); } }
    for (const particle of [...this.particles]) { particle.life -= dt; particle.velocity.y -= dt * 1.6; particle.mesh.position.addScaledVector(particle.velocity, dt); particle.mesh.rotation.x += dt * 7; particle.mesh.material.opacity = Math.max(0, particle.life / particle.maxLife); if (particle.life <= 0) { this.scene.remove(particle.mesh); this.particles = this.particles.filter(p => p !== particle); } }
  }

  updateWave(dt) {
    if (this.state === 'waiting') {
      this.countdown = Math.max(0, this.countdown - dt); if (this.countdown <= 0 && this.wave < TOTAL_WAVES) this.startWave(false);
    } else if (this.state === 'running') {
      if (this.spawnQueue.length) { this.spawnTimer -= dt; if (this.spawnTimer <= 0) { const next = this.spawnQueue.shift(); this.spawnEnemy(next); this.spawnTimer = next.delay; } }
      else if (!this.enemies.length && !this.projectiles.length) this.completeWave();
    }
  }

  completeWave() {
    if (this.wave >= TOTAL_WAVES) { this.endGame(true); return; }
    this.state = 'waiting'; this.countdown = Math.max(8, 18 - this.wave * .55); const reward = 34 + this.wave * 3; this.gold += reward; this.score += 300 * this.wave; this.toast(`WAVE CLEARED · +${reward} AETHER`); this.sound.wave(); this.updateMission(); this.updateUI();
  }

  updateMission() {
    if (this.wave === 0) UI.mission.textContent = 'Fortify the aether road before the first breach.';
    else if (this.state === 'waiting') UI.mission.textContent = `Wave ${this.wave} repelled. Reconfigure the defense before the next breach.`;
    else if (this.wave % 4 === 0) UI.mission.textContent = 'Titan-class signature inbound. Armor resists all but concentrated fire.';
    else UI.mission.textContent = `Wave ${this.wave} active. Break the vanguard before it reaches the core.`;
  }

  updateUI() {
    UI.gold.textContent = Math.floor(this.gold); UI.lives.textContent = this.lives; UI.wave.textContent = this.wave; UI.countdown.textContent = Math.ceil(this.countdown);
    UI.start.disabled = this.state !== 'waiting' || this.wave >= TOTAL_WAVES; const bonus = Math.ceil(this.countdown * .9); UI.startBonus.textContent = `EARLY BONUS +${bonus}`;
    document.querySelectorAll('.tower-choice').forEach(button => button.classList.toggle('unaffordable', this.gold < TOWER_TYPES[button.dataset.tower].cost));
    const threat = this.state === 'running' ? Math.min(100, this.enemies.reduce((sum, e) => sum + e.progress, 0) * 12 + this.enemies.length * 3) : 4;
    UI.threatFill.style.width = `${threat}%`; UI.threatFill.style.background = threat > 70 ? 'var(--danger)' : 'var(--aether)'; UI.threatLabel.textContent = threat > 70 ? 'CRITICAL' : threat > 38 ? 'ELEVATED' : 'CALM';
    if (this.selectedTower) this.refreshInspector();
  }

  togglePause() { if (!this.started || this.gameOver) return; this.paused = !this.paused; UI.pause.textContent = this.paused ? '▶' : 'Ⅱ'; this.toast(this.paused ? 'TIME SUSPENDED' : 'TIME RESTORED'); }
  cycleSpeed() { const speeds = [1, 2, 3], index = (speeds.indexOf(this.speed) + 1) % speeds.length; this.speed = speeds[index]; UI.speed.textContent = `${this.speed}×`; }
  toast(message) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = message; UI.toasts.appendChild(el); setTimeout(() => el.remove(), 2600); }

  endGame(victory) {
    this.gameOver = true; this.paused = true; UI.result.classList.add('show'); UI.result.setAttribute('aria-hidden', 'false');
    UI.resultKicker.textContent = victory ? 'BASTION SECURED' : 'THE CORE HAS FALLEN'; UI.resultTitle.textContent = victory ? 'DAWN RETURNS.' : 'NIGHT PREVAILS.';
    UI.resultCopy.textContent = victory ? 'The aether road holds. The storm remembers your name.' : 'The breach consumed the keep. Rebuild the pattern and try again.';
    UI.resultScore.textContent = this.score.toLocaleString(); UI.resultWave.textContent = `${this.wave}/${TOTAL_WAVES}`; UI.resultCore.textContent = this.lives;
    this.sound.tone(victory ? 220 : 90, 1.4, .06, victory ? 'sine' : 'sawtooth', victory ? 2 : .28);
  }

  animateCameraTo(position, target) {
    const startP = this.camera.position.clone(), startT = this.controls.target.clone(), start = performance.now(), duration = 1600;
    const tick = now => { const raw = Math.min(1, (now - start) / duration), t = 1 - Math.pow(1 - raw, 4); this.camera.position.lerpVectors(startP, position, t); this.controls.target.lerpVectors(startT, target, t); if (raw < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); this.composer.setSize(innerWidth, innerHeight); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  }

  animate() {
    requestAnimationFrame(() => this.animate()); const realDt = Math.min(this.clock.getDelta(), .05); const elapsed = performance.now() * .001;
    this.waterMaterial.uniforms.time.value = elapsed; this.stars.rotation.y = elapsed * .006; this.motes.rotation.y = elapsed * .015;
    this.portal.rotation.z = Math.sin(elapsed * .4) * .012; this.coreCrystal.rotation.y += realDt * .7; this.coreCrystal.position.y = 3.2 + Math.sin(elapsed * 1.8) * .16;
    this.pads.forEach((pad, i) => { pad.rune.rotation.y += realDt * .8; pad.ring.rotation.z += realDt * (i % 2 ? .14 : -.14); });
    if (this.started && !this.paused && !this.gameOver) {
      const dt = realDt * this.speed; this.updateWave(dt); this.updateEnemies(dt); this.updateTowers(dt); this.updateProjectiles(dt); this.updateEffects(dt); this.updateUI();
    } else this.updateEffects(realDt);
    this.controls.update();
    if (this.shake > 0) { this.camera.position.x += (Math.random() - .5) * this.shake; this.camera.position.y += (Math.random() - .5) * this.shake * .5; this.shake = Math.max(0, this.shake - realDt * 1.8); }
    this.composer.render();
  }
}

new AetherfallGame();
