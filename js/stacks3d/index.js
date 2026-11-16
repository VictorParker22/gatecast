// The Stacks in 3D (library.html, capable devices only). Three bookcases at a time in front of the photographed
// room, with books you can tip, grab, slide out and flick toward you, borrow and have stamped. The DOM page
// underneath stays the source of truth and the accessible layer: library.js drives this module through the
// controller returned by mount(), and keyboard / screen-reader users reach every action through the spine
// buttons and the book <dialog>. Pure logic lives in model.js; canvas painting in textures.js.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { gsap } from 'gsap';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import {
  BAY, bayX, spanOf, frameWorld, bookLook, layoutBay, frameCamera, windowFor, windowX, PULL, pullFraction, pointerSpeed, releaseAction,
  springStep, springAtRest, renderScale, frameInterval,
} from './model.js';
import * as P from './textures.js';
import * as sound from './sound.js';
import { buildRoom } from './room.js';
import { hashId } from '../librarymodel.js';

const PAPER_TONE = 0x837666; // paper props sit back in the shadows instead of glowing
const TILT = 0.17; // ~10°: a hovered or focused spine tips forward
// The pulled-out book at three-quarters: the spine turned toward you, the top tipped back so the page edges show.
const READ_TILT = { y: -Math.PI / 2 + 0.58, x: 0.42, z: 0.12 };
// The borrowed book, open: turned ~20° and tipped back ~22° toward the light, like a book held up to be stamped.
const OPEN_PITCH = -0.38, OPEN_TURN = 0.34;

export function loadImage(url, cors = false, timeout = 8000) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    const t = setTimeout(() => { img.onload = img.onerror = null; resolve(null); }, timeout);
    img.onload = () => { clearTimeout(t); resolve(img.naturalWidth > 20 ? img : null); };
    img.onerror = () => { clearTimeout(t); resolve(null); };
    img.src = url;
  });
}

const VIGNETTE_GRAIN = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.045 }, vignette: { value: 0.55 }, res: { value: new THREE.Vector2(1, 1) }, focus: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, grain, vignette, focus; uniform vec2 res; varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5; d.x *= res.x / res.y;
      float v = smoothstep(0.9 + 0.2 * (res.x / res.y), 0.2, length(d));
      c.rgb *= mix(1.0 - vignette - focus * 0.25, 1.0, v);
      float n = hash(vUv * res + fract(time) * 100.0) - 0.5;
      c.rgb += n * grain * (0.6 + 0.4 * (1.0 - dot(c.rgb, vec3(0.333))));
      gl_FragColor = c;
    }`,
};

const FLAME = {
  uniforms: { time: { value: 0 } },
  vertexShader: `varying vec3 vP; uniform float time; void main(){ vP = position; vec3 p = position;
    float sway = sin(time * 7.0 + p.y * 40.0) * 0.0018 * (p.y + 0.02) * 40.0; p.x += sway; p.y *= 1.0 + 0.08 * sin(time * 11.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
  fragmentShader: `varying vec3 vP; uniform float time; void main(){ float h = clamp((vP.y + 0.008) / 0.034, 0.0, 1.0);
    vec3 core = vec3(1.0, 0.95, 0.8); vec3 edge = vec3(1.0, 0.55, 0.15);
    vec3 col = mix(core, edge, smoothstep(0.1, 0.9, h)) * (3.2 - 1.6 * h);
    gl_FragColor = vec4(col, 1.0 - smoothstep(0.75, 1.0, h)); }`,
};

const DUST = {
  uniforms: { time: { value: 0 }, size: { value: 30 }, shaft: { value: new THREE.Vector4(0, 0, 1, 0) }, opacity: { value: 1 } },
  vertexShader: `uniform float time, size; attribute float seed; varying float vA; uniform vec4 shaft;
    void main(){ vec3 p = position;
      p.y += mod(time * 0.012 * (0.4 + seed) + seed * 3.0, 1.2) - 0.6;
      p.x += sin(time * 0.3 + seed * 20.0) * 0.03; p.z += cos(time * 0.23 + seed * 13.0) * 0.03;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = size * (0.4 + seed) / -mv.z;
      vec2 rel = p.xy - shaft.xy; vec2 dir = normalize(shaft.zw);
      float across = abs(rel.x * dir.y - rel.y * dir.x);
      vA = step(0.0, dot(rel, dir)) * smoothstep(0.3, 0.03, across) * (0.35 + 0.65 * sin(time * (0.5 + seed) + seed * 40.0) * 0.5 + 0.325); }`,
  fragmentShader: `varying float vA; uniform float opacity; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA * opacity;
    gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * 1.6, a); }`,
};

export async function mount(opts) {
  const { canvas, stage, region, data, tier, assets = {}, coverUrl = () => null, shelfName = () => '', on = {} } = opts;
  const high = tier === 'high';
  const mobile = !!opts.mobile;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !high, alpha: false, stencil: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x0b0a0c, 1);
  if (high) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; }
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; stop(); on.lost?.(); }, { once: true });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 30);
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };
  const tex = (src, { srgb = true, repeat = false } = {}) => {
    const t = src instanceof HTMLCanvasElement ? new THREE.CanvasTexture(src) : new THREE.Texture(src);
    t.needsUpdate = true;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = maxAniso;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return keep(t);
  };

  /* ---------- Assets: photographic textures when present, procedural otherwise ---------- */
  const texSize = high ? 1024 : 512;
  const A = (name) => (assets[name] ? assets[name].replace('{size}', texSize) : null);
  const fontsReady = document.fonts ? Promise.all([
    document.fonts.load('400 40px "Alfa Slab One"'), document.fonts.load('800 40px "Barlow Condensed"'), document.fonts.load('600 40px "Inter Variable"'),
  ]).catch(() => {}) : Promise.resolve();
  const [woodImg, clothImg, leatherImg, paperImg, pagesImg, pocketImg, brassImg, backImg] = await Promise.all([
    loadImage(A('wood')), loadImage(A('cloth')), loadImage(A('leather')), loadImage(A('paper')), loadImage(A('pages')), loadImage(A('pocket')), loadImage(A('brass')),
    loadImage(opts.backdropUrl, false, 15000), fontsReady,
  ]);
  if (lost) throw new Error('context lost');
  const grains = {
    cloth: clothImg ? toCanvas(clothImg, 256) : P.grainCanvas('cloth', 256, 3),
    leather: leatherImg ? toCanvas(leatherImg, 256) : P.grainCanvas('leather', 256, 5),
    paper: paperImg ? toCanvas(paperImg, 256) : P.grainCanvas('paper', 256, 9),
  };

  /* ---------- Backdrop and environment ---------- */
  let backdrop = null;
  if (backImg) {
    // The photo, as wide as the canvas, its floor fading to the night colour (same as the CSS backdrop).
    const bw = Math.min(2048, backImg.naturalWidth), bh = Math.round(bw * backImg.naturalHeight / backImg.naturalWidth);
    const bc = P.makeCanvas(bw, bh), bctx = bc.getContext('2d');
    bctx.drawImage(backImg, 0, 0, bw, bh);
    const fade = bctx.createLinearGradient(0, bh * 0.78, 0, bh * 0.99);
    fade.addColorStop(0, 'rgba(13,10,8,0)'); fade.addColorStop(1, '#0D0A08');
    bctx.fillStyle = fade; bctx.fillRect(0, bh * 0.78, bw, bh * 0.22);
    backdrop = tex(bc); backdrop.generateMipmaps = false; backdrop.minFilter = THREE.LinearFilter;
    backdrop.userData.ar = bh / bw;
    scene.background = backdrop;
    scene.fog = new THREE.Fog(0x161a24, 3.2, 15); // a little haze, as in the photo
  }
  else scene.background = new THREE.Color(0x0e0c0b);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = tex(envCanvas());
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  const envRT = keep(pmrem.fromEquirectangular(envTex));
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.45;
  pmrem.dispose();

  /* ---------- Materials ---------- */
  const woodSrc = woodImg ? toCanvas(woodImg, texSize) : P.woodCanvas(high ? 1024 : 512);
  const woodPBR = P.derivePBR(woodSrc, { size: high ? 512 : 256, strength: 2.6, rough: 0.58, roughGain: 0.35 });
  const woodMat = keep(new THREE.MeshStandardMaterial({
    map: tex(woodSrc, { repeat: true }), normalMap: tex(woodPBR.normal, { srgb: false, repeat: true }), roughnessMap: tex(woodPBR.rough, { srgb: false, repeat: true }),
    roughness: 1, metalness: 0, color: woodImg ? 0x6c5a4c : 0x6a5c54, normalScale: new THREE.Vector2(0.55, 0.55),
  }));
  const backCanvas = (() => {
    const w = 512, h = 680, c = P.makeCanvas(w, h), ctx = c.getContext('2d');
    ctx.drawImage(woodSrc, 0, 0, w, h);
    ctx.fillStyle = 'rgba(10,6,3,0.5)'; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'multiply';
    const yPx = (y) => h - (y / BAY.header[0]) * h;
    ctx.drawImage(P.backPanelShade(w, h, [[yPx(BAY.floors[0] + BAY.clear), yPx(BAY.floors[0])], [yPx(BAY.floors[1] + BAY.clear), yPx(BAY.floors[1])]]), 0, 0);
    return c;
  })();
  const backMat = keep(new THREE.MeshStandardMaterial({ map: tex(backCanvas), roughness: 0.85, metalness: 0, color: woodImg ? 0x6a584c : 0xbbbbbb }));
  const pagesSrc = pagesImg ? rotate90(toCanvas(pagesImg, 256)) : P.pagesCanvas(256); // stripes along u
  const pagesMat = keep(new THREE.MeshStandardMaterial({ map: tex(pagesSrc), roughness: 0.92 }));
  const curveTex = tex(P.spineCurveCanvas(), { srgb: false });
  const clothMats = new Map(); // binding name -> plain cloth for the boards
  const clothMat = (binding) => {
    if (!clothMats.has(binding.name)) {
      const c = P.makeCanvas(128, 128), ctx = c.getContext('2d');
      ctx.fillStyle = binding.base; ctx.fillRect(0, 0, 128, 128);
      ctx.globalCompositeOperation = 'overlay'; ctx.drawImage(binding.kind === 'leather' ? grains.leather : grains.cloth, 0, 0, 128, 128);
      clothMats.set(binding.name, keep(new THREE.MeshStandardMaterial({ map: tex(c), roughness: binding.kind === 'leather' ? 0.6 : 0.88 })));
    }
    return clothMats.get(binding.name);
  };
  const brassMat = keep(new THREE.MeshStandardMaterial({ color: 0xc9a050, metalness: 1, roughness: 0.32, envMapIntensity: 1.4 }));
  const darkWoodMat = keep(new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.55 }));

  /* ---------- Lights ---------- */
  const hemi = new THREE.HemisphereLight(0x6d82b0, 0x1a1008, 0.26);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0x8fb0ff, 2.1); // the window: cool rim light on the right-hand edges
  moon.position.set(3.4, 2.4, -0.6); scene.add(moon); scene.add(moon.target);
  const key = new THREE.SpotLight(0xffd8b4, 6, 0, 0.62, 0.8, 2); // the lamps' warmth, from the left
  key.position.set(-1.1, 2.3, 2.1);
  scene.add(key); scene.add(key.target);
  if (high) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.012; key.shadow.radius = 4;
    key.shadow.camera.near = 1; key.shadow.camera.far = 6;
  }
  const bayLights = [0, 1, 2].map(() => {
    const s = new THREE.SpotLight(0xffc98c, 9, 0, 0.42, 0.6, 2); // a picture light over each case: a warm pool on the plate and the upper row
    scene.add(s); scene.add(s.target);
    return s;
  });
  const readLight = new THREE.PointLight(0xffe2c0, 0, 0, 2);
  scene.add(readLight);
  const candleLight = new THREE.PointLight(0xff9a40, 0.5, 0, 2);
  scene.add(candleLight);

  /* ---------- Bookcases, books and props ---------- */
  const shelves = data.shelves;
  const bays = [];
  const books = new Map(); // id -> record
  const pickables = [];
  let flames = [];
  const world = new THREE.Group();
  scene.add(world);

  // Floor under the cases, catching their shadows.
  // With the photo, the floor only catches shadows (the photo's floor shows through); without it, a dark floor.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 3), backImg ? keep(new THREE.ShadowMaterial({ opacity: 0.55, color: 0x050302 })) : keep(new THREE.MeshStandardMaterial({ color: 0x120c08, roughness: 0.9 })));
  if (backImg && !high) floor.visible = false;
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 0.6); floor.receiveShadow = true;
  world.add(floor);

  const woodGeo = (w, h, d, seed) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]], r = P.rng(seed);
    for (let f = 0; f < 6; f++) {
      const [fu, fv] = dims[f], swap = fv > fu, ou = r(), ov = r();
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        let u = uv.getX(i), v = uv.getY(i);
        if (swap) [u, v] = [v, u];
        uv.setXY(i, ou + (u * (swap ? fv : fu)) / 0.6, ov + (v * (swap ? fu : fv)) / 0.6);
      }
    }
    return keep(g);
  };
  const part = (parent, geo, mat, x, y, z, { cast = true, receive = true } = {}) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast && high; m.receiveShadow = receive && high;
    parent.add(m); return m;
  };

  const PROPS = {
    folders(g, cx, y, span, s) {
      const n = 3;
      for (let k = 0; k < n; k++) {
        const w = Math.min(0.22, span * 0.9), h = 0.27 - k * 0.012;
        const mat = keep(new THREE.MeshStandardMaterial({ map: tex(P.paintFolder(s * 5 + k, grains.paper, { tab: k === n - 1 })), roughness: 0.9, color: PAPER_TONE }));
        const m = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, 0.004)), [mat, mat, mat, mat, mat, mat]);
        m.position.set(cx + (k - 1) * 0.012, y + h / 2 * Math.cos(0.16) + 0.002, -BAY.depth + 0.07 + k * 0.022);
        m.rotation.set(-0.16, (k - 1) * 0.05, (k - 1) * 0.03);
        m.castShadow = high; m.receiveShadow = high; g.add(m);
      }
    },
    map(g, cx, y, span, s) {
      const w = Math.min(0.24, span * 0.95), h = 0.2;
      const geo = new THREE.PlaneGeometry(w, h, 12, 1);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) / w + 0.5) * Math.PI * 2) * 0.006);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(keep(geo), keep(new THREE.MeshStandardMaterial({ map: tex(P.paintMap(s, grains.paper)), roughness: 0.9, side: THREE.DoubleSide, color: PAPER_TONE })));
      m.position.set(cx, y + h / 2 * Math.cos(0.22), -BAY.depth + 0.06);
      m.rotation.set(-0.22, 0, 0.04);
      m.castShadow = high; m.receiveShadow = high; g.add(m);
    },
    note(g, cx, y, span, s) {
      const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.1, 0.075)), noteMat(s));
      m.rotation.set(-Math.PI / 2, 0, 0.3 + (s % 3) * 0.2);
      m.position.set(cx, y + 0.002, -0.07);
      m.receiveShadow = high; g.add(m);
    },
    ledgers(g, cx, y, span, s) { // blank old ledgers lying flat: no titles
      let yy = y;
      ['#2B241C', '#4A1E1E', '#3B3A2A'].forEach((c, k) => {
        const w = Math.min(0.2, span * 0.85) - k * 0.015, th = 0.03 + (k % 2) * 0.008;
        const mat = keep(new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
        const m = new THREE.Mesh(keep(new THREE.BoxGeometry(w, th, 0.16)), [mat, mat, pagesMat, mat, mat, pagesMat]);
        m.position.set(cx + (k - 1) * 0.006, yy + th / 2, -0.1);
        m.rotation.y = (k - 1) * 0.06;
        m.castShadow = high; m.receiveShadow = high; g.add(m);
        yy += th;
      });
      return yy;
    },
    rolledmap(g, cx, y, span, s) { // a rolled map tied with string, lying across the front
      const grp = new THREE.Group();
      const paper = keep(new THREE.MeshStandardMaterial({ map: tex(P.paintMap(s + 50, grains.paper, { w: 256, h: 128 })), roughness: 0.9, color: PAPER_TONE }));
      const roll = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.017, 0.017, 0.2, 20, 1, true)), keep(paper));
      roll.material.side = THREE.DoubleSide;
      const tie = new THREE.Mesh(keep(new THREE.TorusGeometry(0.0175, 0.0018, 6, 20)), keep(new THREE.MeshStandardMaterial({ color: 0x5a2a22, roughness: 0.8 })));
      tie.rotation.x = Math.PI / 2; tie.position.y = 0.03;
      grp.add(roll, tie);
      grp.rotation.set(0, 0.25 + (s % 3) * 0.1, Math.PI / 2);
      grp.position.set(cx, y + 0.017, -0.05);
      grp.traverse((o) => { if (o.isMesh) { o.castShadow = high; o.receiveShadow = high; } });
      g.add(grp);
    },
    magnifier(g, cx, y, span, s) {
      const grp = new THREE.Group();
      const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(0.042, 0.0055, 12, 48)), brassMat);
      const glass = new THREE.Mesh(keep(new THREE.CircleGeometry(0.041, 40)), keep(new THREE.MeshStandardMaterial({ color: 0xdfe8ef, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.22, envMapIntensity: 2.5 })));
      const handle = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.0075, 0.0095, 0.1, 16)), darkWoodMat);
      handle.position.set(0, -0.098, 0);
      const ferrule = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.008, 0.008, 0.016, 16)), brassMat);
      ferrule.position.set(0, -0.052, 0);
      // A soft highlight on the glass, so it reads as a lens in a dark room.
      const glint = new THREE.Mesh(keep(new THREE.CircleGeometry(0.03, 24, 0.6, 1.4)), keep(new THREE.MeshBasicMaterial({ color: 0xfff3dc, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })));
      glint.position.z = 0.0015;
      grp.add(ring, glass, glint, handle, ferrule);
      grp.rotation.set(-Math.PI / 2 + 0.12, 0, 0.9 + (s % 2) * 0.4);
      grp.position.set(cx, y + 0.012, -0.06);
      grp.traverse((o) => { if (o.isMesh) { o.castShadow = high; o.receiveShadow = high; } });
      g.add(grp);
    },
    candle(g, cx, y, span, s) {
      const grp = new THREE.Group();
      const prof = [[0, 0], [0.045, 0], [0.05, 0.004], [0.046, 0.008], [0.014, 0.012], [0.01, 0.03], [0.018, 0.034], [0.022, 0.05], [0.02, 0.052], [0, 0.052]].map(([a, b]) => new THREE.Vector2(a, b));
      const holder = new THREE.Mesh(keep(new THREE.LatheGeometry(prof, 32)), brassMat);
      const wax = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.0155, 0.016, 0.1, 24)), keep(new THREE.MeshStandardMaterial({ color: 0xf2e6cc, roughness: 0.6, emissive: 0xffb060, emissiveIntensity: 0.12 })));
      wax.position.y = 0.052 + 0.05;
      const wick = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.0008, 0.0008, 0.008, 6)), keep(new THREE.MeshBasicMaterial({ color: 0x111111 })));
      wick.position.y = 0.152 + 0.004;
      const flameMat = keep(new THREE.ShaderMaterial({ ...FLAME, uniforms: THREE.UniformsUtils.clone(FLAME.uniforms), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      const flame = new THREE.Mesh(keep(new THREE.SphereGeometry(1, 16, 12)), flameMat);
      flame.geometry.translate(0, 0.6, 0);
      flame.scale.set(0.0065, 0.022, 0.0065);
      flame.position.y = 0.158;
      const glow = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: tex(P.glowCanvas(128)), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: high ? 0.55 : 0.9 })));
      glow.scale.set(0.16, 0.16, 1); glow.position.y = 0.17;
      grp.add(holder, wax, wick, flame, glow);
      grp.position.set(cx, y, -0.09);
      holder.castShadow = high; wax.castShadow = high;
      g.add(grp);
      g.updateMatrixWorld(true);
      const wp = new THREE.Vector3(0, 0.2, 0.02).applyMatrix4(grp.matrixWorld);
      candleLight.position.copy(wp);
      flames.push({ flame, glow, mat: flameMat });
    },
  };

  // Props per bay, by the shelf's object; the widths are the shelf length they need (the rest ride on top or in front).
  const PROP_PLAN = {
    lens: [['folders', 'magnifier'], ['ledgers']],
    file: [['folders', 'magnifier'], ['ledgers', 'rolledmap']],
    candle: [['map', 'candle'], ['folders']],
    glass: [['ledgers', 'rolledmap'], ['map']],
    flask: [['ledgers', 'magnifier'], ['folders']],
    hat: [['map'], ['ledgers', 'rolledmap']],
  };
  const PROP_W = { folders: 0.17, map: 0.17, ledgers: 0.17, candle: 0.09 };
  const slipMat = keep(new THREE.MeshStandardMaterial({ color: 0xcfc2a2, roughness: 0.95, side: THREE.DoubleSide }));

  // Blank old volumes that fill each row: plain cloth, blind bands, no titles; not pickable, not in the page.
  const FILLER_TONES = ['#3A2A1E', '#2A3326', '#2D3445', '#4A3A22', '#3B2230', '#1F1C19'];
  const fillerMats = FILLER_TONES.map((col, k) => {
    const c = P.makeCanvas(64, 384), ctx = c.getContext('2d');
    ctx.fillStyle = col; ctx.fillRect(0, 0, 64, 384);
    ctx.globalCompositeOperation = 'overlay'; ctx.drawImage(k % 2 ? grains.leather : grains.cloth, 0, 0, 64, 384);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (const y of k % 3 ? [40, 52, 330, 342] : [60, 300]) ctx.fillRect(4, y, 56, 4);
    ctx.fillStyle = 'rgba(235,220,190,0.12)'; ctx.fillRect(0, 0, 64, 10); ctx.fillRect(0, 374, 64, 10);
    const e = ctx.createLinearGradient(0, 0, 64, 0);
    e.addColorStop(0, 'rgba(0,0,0,0.45)'); e.addColorStop(0.15, 'rgba(0,0,0,0)'); e.addColorStop(0.85, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = e; ctx.fillRect(0, 0, 64, 384);
    const spine = keep(new THREE.MeshStandardMaterial({ map: tex(c), normalMap: curveTex, roughness: k % 2 ? 0.62 : 0.85 }));
    const board = keep(new THREE.MeshStandardMaterial({ color: col, roughness: 0.8 }));
    return [board, board, pagesMat, pagesMat, spine, pagesMat];
  });
  function makeFiller(f, g) {
    const mesh = new THREE.Mesh(keep(new THREE.BoxGeometry(f.thick, f.height, f.depth)), fillerMats[f.tone]);
    mesh.position.set(0, f.height / 2, -f.depth / 2);
    mesh.castShadow = high; mesh.receiveShadow = high;
    const slot = new THREE.Group(), holder = new THREE.Group();
    const floorY = BAY.floors[f.row];
    if (f.lean) {
      const right = f.lean > 0;
      slot.position.set(f.x + (right ? f.thick / 2 : -f.thick / 2), floorY, -0.014);
      slot.rotation.z = -f.lean;
      holder.position.x = right ? -f.thick / 2 : f.thick / 2;
    } else slot.position.set(f.x, floorY, -0.014);
    slot.add(holder); holder.add(mesh); g.add(slot);
  }

  await yieldFrame();
  let seed = 1;
  for (const [i, shelf] of shelves.entries()) {
    const g = new THREE.Group();
    g.position.x = bayX(i, shelves.length);
    world.add(g);
    const W = BAY.width, D = BAY.depth, S = BAY.side, b = BAY.board;
    const innerW = W - 2 * S;
    for (const sx of [-1, 1]) part(g, woodGeo(S, BAY.header[1], D + 0.012, seed++), woodMat, sx * (W / 2 - S / 2), BAY.header[1] / 2, -D / 2 + 0.006);
    const back = part(g, keep(new THREE.BoxGeometry(innerW, BAY.header[0], 0.012)), backMat, 0, BAY.header[0] / 2, -D + 0.006, { cast: false });
    back.renderOrder = -1;
    for (const y of [BAY.floors[1] - b / 2, BAY.floors[0] - b / 2, BAY.header[0] + b / 2]) part(g, woodGeo(innerW, b, D, seed++), woodMat, 0, y, -D / 2);
    // Shelf lips: a slightly proud front edge on each board.
    for (const y of [BAY.floors[1] - b / 2, BAY.floors[0] - b / 2]) part(g, woodGeo(innerW, b + 0.006, 0.014, seed++), woodMat, 0, y - 0.003, 0.004);
    part(g, woodGeo(W, BAY.header[1] - BAY.header[0], 0.028, seed++), woodMat, 0, (BAY.header[0] + BAY.header[1]) / 2, 0.006);
    part(g, woodGeo(W + 0.05, BAY.cornice - BAY.header[1], D + 0.05, seed++), woodMat, 0, (BAY.header[1] + BAY.cornice) / 2, -D / 2 + 0.02);
    part(g, woodGeo(W + 0.03, 0.012, D + 0.035, seed++), woodMat, 0, BAY.header[1] + 0.004, -D / 2 + 0.015);
    part(g, woodGeo(innerW, BAY.floors[1] - b, 0.02, seed++), woodMat, 0, (BAY.floors[1] - b) / 2, -0.012);
    // The brass name plate, engraved with the shelf's name.
    const { worldW, worldH } = P.plateSize(shelf.name);
    const pl = P.paintPlate(shelf.name, worldW, worldH, { h: high ? 128 : 80, brass: brassImg });
    const plateMat = keep(new THREE.MeshStandardMaterial({ map: tex(pl.map), roughnessMap: tex(pl.pbr, { srgb: false }), metalnessMap: tex(pl.pbr, { srgb: false }), roughness: 1, metalness: 1, envMapIntensity: 1.5, color: 0xd0c0a4 }));
    const plate = part(g, keep(new THREE.BoxGeometry(worldW, worldH, 0.004)), [brassMat, brassMat, brassMat, brassMat, plateMat, brassMat], 0, (BAY.header[0] + BAY.header[1]) / 2 + 0.004, 0.022);
    plate.castShadow = false;
    // A soft contact shadow where the case stands on the floor.
    const fs = P.makeCanvas(128, 64), fctx = fs.getContext('2d');
    const fg = fctx.createRadialGradient(64, 32, 4, 64, 32, 64);
    fg.addColorStop(0, 'rgba(255,255,255,0.95)'); fg.addColorStop(0.55, 'rgba(255,255,255,0.6)'); fg.addColorStop(1, 'rgba(255,255,255,0)');
    fctx.fillStyle = fg; fctx.fillRect(0, 0, 128, 64);
    const contact = new THREE.Mesh(keep(new THREE.PlaneGeometry(W + 0.34, D + 0.4)), keep(new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: tex(fs, { srgb: false }), transparent: true, opacity: 0.85, depthWrite: false })));
    contact.rotation.x = -Math.PI / 2; contact.position.set(0, 0.0015, -D / 2 + 0.03);
    g.add(contact);
    const bayRec = { index: i, shelf, group: g, books: [], dim: 0 };
    bays.push(bayRec);

    // Books.
    const list = data.books.filter((bk) => bk.shelf === shelf.id);
    const looks = list.map(bookLook);
    const plan = PROP_PLAN[shelf.object] || [[], []];
    const { placed, fillers, free } = layoutBay(looks, i, plan.map((row) => row.reduce((t, k) => t + (PROP_W[k] || 0), 0)));
    for (const f of fillers) makeFiller(f, g);
    for (const [k, book] of list.entries()) {
      const look = looks[k];
      const pos = placed.find((p) => p.id === book.id);
      const rec = makeBook(book, look, pos, g, bayRec);
      books.set(book.id, rec);
      bayRec.books.push(rec);
      if (k % 6 === 5) await yieldFrame();
    }
    addProps(g, plan, free, i);
    // Contact shadows: soft dark footprints under the books and along the back of each shelf.
    for (const row of [0, 1]) {
      const cw = 256, chh = 96, c = P.makeCanvas(cw, chh), ctx = c.getContext('2d');
      const toX = (x) => (x / BAY.inner + 0.5) * cw, toZ = (z) => (-z / BAY.depth) * chh; // z 0 (front) .. -depth (back)
      const back = ctx.createLinearGradient(0, chh, 0, chh * 0.55);
      back.addColorStop(0, 'rgba(0,0,0,0.75)'); back.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = back; ctx.fillRect(0, 0, cw, chh);
      ctx.filter = 'blur(3px)';
      const feet = [...placed.filter((q) => q.row === row).map((p) => { const l = looks.find((x) => x.id === p.id); return { x: p.x, t: l.thick, d: l.depth }; }),
        ...fillers.filter((q) => q.row === row).map((q) => ({ x: q.x, t: q.thick, d: q.depth }))];
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      for (const p of feet) ctx.fillRect(toX(p.x - p.t / 2) - 2, toZ(-0.012) - 2, (p.t / BAY.inner) * cw + 4, (p.d / BAY.depth) * chh + 4);
      const decal = new THREE.Mesh(keep(new THREE.PlaneGeometry(BAY.inner, BAY.depth)), keep(new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: tex(c, { srgb: false }), transparent: true, depthWrite: false })));
      decal.rotation.x = -Math.PI / 2;
      decal.position.set(0, BAY.floors[row] + 0.0008, -BAY.depth / 2);
      decal.renderOrder = 1;
      g.add(decal);
    }
  }

  function makeBook(book, look, pos, bayGroup, bayRec) {
    const { thick: t, height: h, depth: d } = look;
    const sp = P.paintSpine(book, look, grains, { w: high ? 128 : 64 });
    const spineMat = keep(new THREE.MeshStandardMaterial({
      map: tex(sp.map), roughnessMap: tex(sp.pbr, { srgb: false }), metalnessMap: tex(sp.pbr, { srgb: false }), roughness: 1, metalness: 1,
      normalMap: curveTex, normalScale: new THREE.Vector2(1, 1), envMapIntensity: 1.5, emissive: 0x1a120a, emissiveMap: null,
    }));
    const cloth = clothMat(look.binding);
    const mesh = new THREE.Mesh(keep(new THREE.BoxGeometry(t, h, d)), [cloth, cloth, pagesMat, pagesMat, spineMat, pagesMat]);
    mesh.castShadow = high; mesh.receiveShadow = high;
    mesh.position.set(0, h / 2, -d / 2);
    mesh.userData.id = book.id;
    // Some library copies have a paper slip left between the pages.
    if (hashId(book.id) % 4 === 0) {
      const slip = new THREE.Mesh(keep(new THREE.PlaneGeometry(Math.min(0.022, t * 0.5), 0.05)), slipMat);
      slip.position.set(0, h / 2 + 0.012, d * 0.15); slip.rotation.z = ((hashId(book.id) >>> 3) % 5 - 2) * 0.05;
      mesh.add(slip);
    }
    const floorY = BAY.floors[pos.row];
    const slot = new THREE.Group(), holder = new THREE.Group(), slide = new THREE.Group(), tilt = new THREE.Group();
    const zFront = -0.012;
    if (pos.lean) {
      const right = pos.lean > 0;
      slot.position.set(pos.x + (right ? t / 2 : -t / 2), floorY, zFront);
      slot.rotation.z = -pos.lean;
      holder.position.x = right ? -t / 2 : t / 2;
    } else slot.position.set(pos.x, floorY, zFront);
    slot.add(holder); holder.add(slide); slide.add(tilt); tilt.add(mesh);
    bayGroup.add(slot);
    pickables.push(mesh);
    return {
      id: book.id, book, look, mesh, slot, holder, slide, tilt, spineMat, bay: bayRec,
      tiltS: { x: 0, v: 0 }, tiltTarget: 0, dim: 0, dimTarget: 0, push: 0, state: 'shelf',
    };
  }

  function addProps(g, plan, free, i) {
    plan.forEach((list, row) => {
      const f = free.find((x) => x.row === row);
      if (!f) return;
      const y = BAY.floors[row];
      const span = f.x1 - f.x0;
      const need = list.reduce((t, k) => t + (PROP_W[k] || 0), 0);
      const scale = need ? Math.min(1, span / need) : 1;
      let cursor = f.x0, top = y;
      list.filter((k) => PROP_W[k]).forEach((kind, k) => {
        const w = PROP_W[kind] * scale;
        const r = PROPS[kind](g, cursor + w / 2, y, w, i * 10 + row * 3 + k);
        if (kind === 'ledgers') top = r;
        cursor += w;
      });
      // Small things: on the ledgers if there are some, else on the shelf in front of the rest.
      list.filter((k) => !PROP_W[k]).forEach((kind, k) => PROPS[kind](g, f.x0 + span * (0.45 + k * 0.1), top, span, i * 10 + row * 3 + 5 + k));
    });
    // A note tucked under the books, hanging over the shelf edge.
    if (i % 3 !== 1) {
      const n = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.075, 0.06)), noteMat(i * 7 + 3));
      n.position.set(-BAY.inner / 2 + 0.12 + (i % 2) * 0.2, BAY.floors[0] - 0.024, 0.016);
      n.rotation.set(-0.15, 0, (i % 2 ? 1 : -1) * 0.12);
      g.add(n);
    }
    // A note pinned to the front of the right-hand post of the last case on each page.
    if (i % 3 === 2) {
      const n = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.075, 0.1)), noteMat(i * 13 + 1));
      n.position.set(BAY.width / 2 + 0.012, 0.6, 0.03);
      n.rotation.set(0, -0.05, -0.1);
      const pin = new THREE.Mesh(keep(new THREE.SphereGeometry(0.0045, 10, 8)), brassMat);
      pin.position.set(BAY.width / 2 - 0.012, 0.64, 0.036);
      g.add(n, pin);
    }
  }

  function noteMat(s) { return keep(new THREE.MeshStandardMaterial({ map: tex(P.paintNote(s, grains.paper)), roughness: 0.95, side: THREE.DoubleSide, color: PAPER_TONE })); }

  // Dust in the window light, above the cases.
  const dust = (() => {
    const n = high ? 260 : 110;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), sd = new Float32Array(n), r = P.rng(42);
    for (let i = 0; i < n; i++) { pos[i * 3] = (r() - 0.5) * 4.4; pos[i * 3 + 1] = 0.3 + r() * 2.4; pos[i * 3 + 2] = -2.1 + r() * 1.3; sd[i] = r(); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(sd, 1));
    const mat = keep(new THREE.ShaderMaterial({ ...DUST, uniforms: THREE.UniformsUtils.clone(DUST.uniforms), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    const pts = new THREE.Points(keep(geo), mat);
    pts.frustumCulled = false;
    scene.add(pts);
    return { pts, mat };
  })();

  // No photographed room: build one.
  const room = backImg ? null : buildRoom({ scene, high, tex, keep, maxLights: 0 });
  let roomBaseX = 0;

  /* ---------- Post-processing (high tier) ---------- */
  let composer = null, bloom = null, bokeh = null, grainPass = null;
  if (high) {
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.45, 0.92);
    composer.addPass(bloom);
    bokeh = new BokehPass(scene, camera, { focus: 1, aperture: 0.0, maxblur: 0.012 });
    bokeh.enabled = false;
    composer.addPass(bokeh);
    composer.addPass(new OutputPass());
    grainPass = new ShaderPass(VIGNETTE_GRAIN);
    composer.addPass(grainPass);
  }

  /* ---------- Layout: framing the cases into the region the page keeps for them ---------- */
  const view = { first: 0, visible: 3, x: 0, drag: 0, px: 0, py: 0, perPx: 0.002, w: 1, h: 1, dpr: 1 };
  const parallax = { x: 0, y: 0, tx: 0, ty: 0 };
  const frameInfo = { shiftX: 0, shiftY: 0 };
  let canvasRect = canvas.getBoundingClientRect();

  function layout() {
    const sr = stage.getBoundingClientRect();
    const rr = region.getBoundingClientRect();
    canvasRect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(sr.width)), h = Math.max(1, Math.round(sr.height));
    const rect = { x: rr.left - sr.left, y: rr.top - sr.top, w: rr.width, h: rr.height };
    // How many bays: from the shape of the frame the stylesheet reserves (3, 2 or 1 bay wide).
    const ar = rect.h / Math.max(1, rect.w);
    const visible = ar > 0.95 ? 1 : ar > 0.5 ? 2 : 3;
    const changed = visible !== view.visible;
    view.visible = visible;
    view.w = w; view.h = h;
    view.dpr = renderScale({ w, h, dpr: window.devicePixelRatio || 1, tier, mobile }) * (view.dprScale || 1);
    renderer.setPixelRatio(view.dpr);
    renderer.setSize(w, h, false);
    if (composer) {
      composer.setPixelRatio(view.dpr); composer.setSize(w, h);
      bloom.resolution.set(w * view.dpr / 2, h * view.dpr / 2);
      grainPass.uniforms.res.value.set(w * view.dpr, h * view.dpr);
    }
    camera.fov = visible === 1 ? 32 : 28;
    camera.aspect = w / h;
    const f = frameCamera({ canvasW: w, canvasH: h, rect, worldW: frameWorld(visible).w, worldH: frameWorld(visible).h, fov: camera.fov });
    view.perPx = f.perPx;
    view.dist = f.distance;
    frameInfo.shiftX = f.shiftX; frameInfo.shiftY = f.shiftY;
    applyProjection();
    if (backdrop) { // width-fit, top-aligned; below the photo the edge row (the night colour) repeats
      const ry = h / (w * backdrop.userData.ar);
      backdrop.repeat.set(1, ry);
      backdrop.offset.set(0, 1 - ry);
    }
    if (changed) view.first = windowFor(view.first, visible, bays.length);
    view.x = windowX(view.first, visible, bays.length);
    view.drag = 0; parallax.x = parallax.y = 0;
    placeCamera();
    if (room) {
      const ray = new THREE.Ray();
      const at = (px, py, z) => {
        const v = new THREE.Vector3((px / w) * 2 - 1, 1 - (py / h) * 2, 0.5).unproject(camera);
        ray.set(camera.position, v.sub(camera.position).normalize());
        return ray.at((z - camera.position.z) / ray.direction.z, new THREE.Vector3());
      };
      const shaft = room.place({ at, w, heroH: rect.y, casesTop: rect.y, cx: view.x });
      roomBaseX = view.x;
      dust.mat.uniforms.shaft.value.set(shaft.shaftOrigin.x - view.x, shaft.shaftOrigin.y, shaft.shaftDir.x, shaft.shaftDir.y);
      dust.home = shaft;
    }
    on.window?.(view.first, view.visible);
    invalidate(400);
  }

  function applyProjection() {
    camera.updateProjectionMatrix();
    camera.projectionMatrix.elements[8] -= frameInfo.shiftX;
    camera.projectionMatrix.elements[9] -= frameInfo.shiftY;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }

  const camBase = new THREE.Vector3();
  function placeCamera() {
    const cx = view.x + view.drag;
    camBase.set(cx, BAY.height / 2, view.dist);
    camera.position.set(cx + parallax.x * 0.012, BAY.height / 2 - parallax.y * 0.008, view.dist);
    camera.rotation.set(-parallax.y * 0.004, -parallax.x * 0.006, 0);
    camera.updateMatrixWorld();
    // Lights travel with the window of bays.
    key.position.set(cx - 1.1, 2.3, 2.1); key.target.position.set(cx, 0.45, -0.15);
    const off = view.visible === 1 ? [-1, 0, 1] : view.visible === 2 ? [-0.5, 0.5, 1.5] : [-1, 0, 1];
    bayLights.forEach((s, k) => {
      const x = cx + off[k] * BAY.pitch;
      s.position.set(x, 1.3, 0.62); s.target.position.set(x, 0.66, -0.1);
    });
    moon.target.position.set(cx, 0.4, 0);
    if (room) room.room.position.x = roomBaseX + (cx - roomBaseX) * 0.88;
    dust.pts.position.x = room ? room.room.position.x : cx;
  }

  /* ---------- Render loop with a governor ---------- */
  let raf = 0, running = false, visible = true, onScreen = true, lastFrame = 0, movingUntil = 0, t0 = performance.now();
  const clock = { elapsed: 0 };
  const slow = { n: 0, sum: 0 };
  function invalidate(ms = 0) { movingUntil = Math.max(movingUntil, performance.now() + ms); start(); }
  function start() { if (!running && !lost && visible && onScreen) { running = true; raf = requestAnimationFrame(frame); } }
  function stop() { running = false; cancelAnimationFrame(raf); }
  let firstFrame = true, cost = 0;
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const moving = now < movingUntil || drag.active || anyBookMoving;
    // Idle (only the candle and dust move): never spend more than ~a quarter of the time rendering.
    const interval = moving ? frameInterval({ moving, visible: visible && onScreen, tier }) : Math.max(frameInterval({ moving, visible: visible && onScreen, tier }), cost * 4);
    if (now - lastFrame < interval - 2) return;
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    clock.elapsed = (now - t0) / 1000;
    update(dt, clock.elapsed);
    const s = performance.now();
    if (composer) composer.render(dt); else renderer.render(scene, camera);
    cost = cost * 0.8 + (performance.now() - s) * 0.2;
    if (firstFrame) { firstFrame = false; requestAnimationFrame(() => on.ready?.()); }
    if (moving) governor(performance.now() - s, dt);
  }
  // If frames keep taking too long, render fewer pixels (down to 0.75x), then drop bloom.
  function governor(cpuMs, dt) {
    slow.n++; slow.sum += dt;
    if (slow.n < 40) return;
    const avg = (slow.sum / slow.n) * 1000;
    slow.n = 0; slow.sum = 0;
    if (avg > 30 && view.dpr > 0.8) { view.dprScale = (view.dprScale || 1) * 0.85; layout(); }
    else if (avg > 30 && bloom && bloom.enabled) { bloom.enabled = false; }
  }

  let anyBookMoving = false;
  const tmpV = new THREE.Vector3();
  function update(dt, t) {
    parallax.x += (parallax.tx - parallax.x) * Math.min(1, dt * 4);
    parallax.y += (parallax.ty - parallax.y) * Math.min(1, dt * 4);
    if (Math.abs(parallax.tx - parallax.x) > 0.001 || Math.abs(parallax.ty - parallax.y) > 0.001) movingUntil = Math.max(movingUntil, performance.now() + 50);
    placeCamera();
    anyBookMoving = false;
    for (const b of books.values()) {
      if (b.state === 'shelf' || b.state === 'drag') {
        const target = b.state === 'drag' ? TILT * 0.6 + drag.fraction * 0.12 : b.tiltTarget;
        if (!springAtRest(b.tiltS, target, 5e-4)) {
          b.tiltS = springStep(b.tiltS, target, dt, 220, 17);
          b.tilt.rotation.x = b.tiltS.x;
          anyBookMoving = true;
        }
      }
    }
    if (drag.active) stepDrag(dt);
    // Candle and dust.
    const flick = 0.85 + 0.15 * Math.sin(t * 13.1) * Math.sin(t * 7.3 + 1.3) + 0.06 * Math.sin(t * 31.7);
    candleLight.intensity = 0.42 * flick;
    for (const f of flames) { f.mat.uniforms.time.value = t; f.glow.material.opacity = (high ? 0.5 : 0.85) * (0.85 + 0.15 * flick); }
    dust.mat.uniforms.time.value = t;
    room?.update(t);
    if (grainPass) grainPass.uniforms.time.value = t;
    if (ring.id) placeRing();
    on.frame?.();
  }

  /* ---------- Visibility: pause when hidden or scrolled away ---------- */
  const onVis = () => { visible = !document.hidden; if (visible) invalidate(100); else stop(); };
  document.addEventListener('visibilitychange', onVis);
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    onScreen = entries[0].isIntersecting;
    if (onScreen) invalidate(100); else stop();
  }) : null;
  io?.observe(canvas);
  const ro = new ResizeObserver(() => layout());
  ro.observe(stage); ro.observe(region);

  /* ---------- Picking ---------- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(ev) {
    canvasRect = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - canvasRect.left) / canvasRect.width) * 2 - 1, -((ev.clientY - canvasRect.top) / canvasRect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    if (!hit) return null;
    const b = books.get(hit.object.userData.id);
    return b && b.state === 'shelf' ? b : null;
  }

  let hovered = null;
  function setHover(b) {
    if (hovered === b) return;
    if (hovered && hovered.state === 'shelf' && hovered.id !== ring.id) hovered.tiltTarget = 0;
    hovered = b;
    if (b) b.tiltTarget = TILT;
    canvas.style.cursor = b ? 'grab' : '';
    on.hover?.(b ? b.id : null);
    invalidate(300);
  }

  /* ---------- Grab, slide, flick (cannon-es) ---------- */
  const physics = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
  const hand = new CANNON.Body({ type: CANNON.Body.KINEMATIC, mass: 0 });
  physics.addBody(hand);
  const drag = { active: false, b: null, body: null, spring: null, x0: 0, y0: 0, t0: 0, samples: [], fraction: 0, travel: 0, pointerId: null, slid: 0 };

  function beginDrag(b, ev) {
    drag.active = true; drag.b = b; drag.x0 = ev.clientX; drag.y0 = ev.clientY; drag.t0 = performance.now();
    drag.samples = [{ t: drag.t0, x: ev.clientX, y: ev.clientY }]; drag.fraction = 0; drag.travel = 0; drag.slid = 0;
    const body = new CANNON.Body({ mass: 0.45, shape: new CANNON.Box(new CANNON.Vec3(b.look.thick / 2, b.look.height / 2, b.look.depth / 2)), linearDamping: 0.55 });
    body.linearFactor.set(0, 0, 1); body.angularFactor.set(0, 0, 0);
    body.position.set(0, 0, 0);
    physics.addBody(body);
    hand.position.set(0, 0, 0);
    drag.body = body;
    drag.spring = new CANNON.Spring(hand, body, { restLength: 0, stiffness: 140, damping: 9 });
    b.state = 'drag';
    canvas.style.cursor = 'grabbing';
    prefetchCover(b);
    on.hover?.(b.id);
    invalidate(200);
  }
  function moveDrag(ev) {
    const now = performance.now();
    drag.samples.push({ t: now, x: ev.clientX, y: ev.clientY });
    if (drag.samples.length > 12) drag.samples.shift();
    drag.travel = Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0);
    drag.fraction = pullFraction(drag.travel);
    hand.position.z = drag.fraction * PULL.maxOut;
    // A little sideways sway toward the pointer.
    drag.b.slide.rotation.z = Math.max(-0.05, Math.min(0.05, (ev.clientX - drag.x0) * -0.0004));
  }
  function stepDrag(dt) {
    drag.spring.applyForce();
    // Friction from the neighbours: a constant drag against the motion, stronger near the back of the shelf.
    const v = drag.body.velocity.z;
    if (Math.abs(v) > 1e-4) drag.body.applyForce(new CANNON.Vec3(0, 0, -Math.sign(v) * 0.9 * (1 - drag.body.position.z / (PULL.maxOut * 1.4))));
    physics.step(1 / 120, dt, 4);
    const z = Math.max(0, Math.min(PULL.maxOut * 1.05, drag.body.position.z));
    if (z !== drag.body.position.z) { drag.body.position.z = z; drag.body.velocity.z = 0; }
    drag.b.slide.position.z = z;
    drag.b.slide.position.y = z * 0.04;
    if (z - drag.slid > 0.03) { sound.slide(0.4); drag.slid = z; }
  }
  function endDrag(ev, cancelled = false) {
    const b = drag.b;
    if (!b) return;
    const duration = performance.now() - drag.t0;
    const speed = pointerSpeed(drag.samples);
    const action = cancelled ? 'back' : releaseAction({ travel: drag.travel, duration, speed, fraction: drag.fraction });
    const z = drag.body.position.z;
    physics.removeBody(drag.body);
    drag.active = false; drag.b = null; drag.body = null; drag.spring = null;
    canvas.style.cursor = '';
    if (action === 'back') {
      b.state = 'shelf';
      sound.slide(z / PULL.maxOut * 0.5);
      gsap.to(b.slide.position, { z: 0, y: 0, duration: 0.45, ease: 'back.out(2.2)', onUpdate: () => invalidate(50), onComplete: () => { if (z > 0.02) sound.tock(); } });
      gsap.to(b.slide.rotation, { z: 0, duration: 0.3 });
      b.tiltTarget = hovered === b ? TILT : 0;
      invalidate(600);
      return;
    }
    on.pull?.(b.id, { flick: action === 'flick' });
  }

  /* ---------- Pointer events ---------- */
  let press = null; // a touch that may become a tap, a long-press grab, or a swipe
  const onDown = (ev) => {
    sound.unlock();
    if (busy) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const b = pick(ev);
    if (ev.pointerType !== 'mouse') {
      press = { b, x: ev.clientX, y: ev.clientY, t: performance.now(), id: ev.pointerId, mode: 'maybe', timer: 0 };
      if (b) press.timer = setTimeout(() => { if (press && press.mode === 'maybe') { press.mode = 'grab'; navigator.vibrate?.(8); beginDrag(b, { clientX: press.x, clientY: press.y }); } }, 300);
      return;
    }
    if (b) { canvas.setPointerCapture(ev.pointerId); drag.pointerId = ev.pointerId; beginDrag(b, ev); }
    else press = { b: null, x: ev.clientX, y: ev.clientY, t: performance.now(), id: ev.pointerId, mode: 'maybe' };
  };
  const onMove = (ev) => {
    if (drag.active && (press ? press.mode === 'grab' : true)) { moveDrag(ev); return; }
    if (press) {
      const dx = ev.clientX - press.x, dy = ev.clientY - press.y;
      if (press.mode === 'maybe' && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        press.mode = 'swipe'; clearTimeout(press.timer);
        try { canvas.setPointerCapture(ev.pointerId); } catch {}
      } else if (press.mode === 'maybe' && Math.abs(dy) > 10) { clearTimeout(press.timer); press = null; return; }
      if (press && press.mode === 'swipe') { view.drag = -dx * view.perPx; invalidate(100); }
      return;
    }
    if (ev.pointerType === 'mouse') {
      canvasRect = canvas.getBoundingClientRect();
      parallax.tx = ((ev.clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
      parallax.ty = ((ev.clientY - canvasRect.top) / canvasRect.height) * 2 - 1;
      if (!busy) setHover(pick(ev));
      invalidate(80);
    }
  };
  const onUp = (ev) => {
    if (press) {
      clearTimeout(press.timer);
      const p = press; press = null;
      if (p.mode === 'swipe') {
        const dx = ev.clientX - p.x;
        const step = Math.abs(dx) > 50 ? (dx < 0 ? 1 : -1) : 0;
        const dragX = view.drag;
        view.drag = 0;
        view.x += dragX;
        panTo(view.first + step * view.visible);
        return;
      }
      if (p.mode === 'grab') { if (drag.active) endDrag(ev); return; }
      if (p.mode === 'maybe' && p.b && performance.now() - p.t < 500 && !busy) { on.pull?.(p.b.id, { flick: false }); return; }
      if (p.mode === 'maybe' && !p.b) {
        const dx = ev.clientX - p.x;
        if (Math.abs(dx) > 60) panTo(view.first + (dx < 0 ? 1 : -1) * view.visible);
      }
      return;
    }
    if (drag.active) endDrag(ev);
  };
  const onCancel = () => {
    if (press) { clearTimeout(press.timer); if (press.mode === 'swipe') { view.x += view.drag; view.drag = 0; panTo(view.first); } press = null; }
    if (drag.active) endDrag(null, true);
  };
  const onLeave = () => { if (!drag.active) setHover(null); parallax.tx = 0; parallax.ty = 0; invalidate(600); };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', onLeave);
  // A long press on a book must not scroll the page or open the context menu.
  const onTouchMove = (e) => { if (press && press.mode === 'grab') e.preventDefault(); };
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('contextmenu', (e) => { if (press || drag.active) e.preventDefault(); });

  /* ---------- Panning between bays ---------- */
  function panTo(first, { instant = false } = {}) {
    const f = Math.max(0, Math.min(bays.length - view.visible, Math.round(first / view.visible) * view.visible));
    const clamped = Math.max(0, Math.min(bays.length - view.visible, first));
    view.first = view.visible === 1 ? clamped : f;
    const x = windowX(view.first, view.visible, bays.length);
    gsap.to(view, { x, duration: instant ? 0 : 0.95, ease: 'power3.inOut', onUpdate: () => invalidate(60) });
    invalidate(1000);
    on.window?.(view.first, view.visible);
  }

  /* ---------- Focus ring for keyboard users ---------- */
  const ring = { id: null, el: opts.ringEl || null };
  function placeRing() {
    const b = books.get(ring.id);
    if (!b || !ring.el || b.state !== 'shelf' || !ring.show) { if (ring.el) ring.el.hidden = true; return; }
    const r = projectBox(b.mesh, 'spine');
    ring.el.hidden = false;
    Object.assign(ring.el.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  }

  // Screen rectangle (relative to the stage) of a face of a book's box.
  const corners = [...Array(8)].map(() => new THREE.Vector3());
  function projectBox(mesh, face) {
    const p = mesh.geometry.parameters, hx = p.width / 2, hy = p.height / 2, hz = p.depth / 2;
    const pts = face === 'spine' ? [[hx, hy, hz], [-hx, hy, hz], [hx, -hy, hz], [-hx, -hy, hz]]
      : face === 'back' ? [[-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, hz], [-hx, -hy, -hz]]
        : face === 'front' ? [[hx, hy, hz], [hx, hy, -hz], [hx, -hy, hz], [hx, -hy, -hz]]
          : [[hx, hy, hz], [-hx, hy, hz], [hx, -hy, hz], [-hx, -hy, hz], [hx, hy, -hz], [-hx, hy, -hz], [hx, -hy, -hz], [-hx, -hy, -hz]];
    mesh.updateWorldMatrix(true, false);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach((q, i) => {
      const v = corners[i].set(q[0], q[1], q[2]).applyMatrix4(mesh.matrixWorld).project(camera);
      const sx = (v.x + 1) / 2 * view.w, sy = (1 - v.y) / 2 * view.h;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    });
    return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
  }

  /* ---------- Reading: fly to the visitor, turn, borrow, stamp, put back ---------- */
  let busy = false;
  let reading = null; // { b, face, rig, coverP }
  const covers = new Map();

  function prefetchCover(b) {
    if (covers.has(b.id)) return covers.get(b.id);
    const p = (async () => {
      const url = coverUrl(b.book);
      const img = url ? await loadImage(url, true, 6000) : null;
      const canvasC = img ? P.paintPhotoCover(img, b.look, { w: high ? 512 : 384 }) : P.paintCover(b.book, b.look, shelfName(b.book.shelf), grains, { w: high ? 512 : 384 });
      const front = keep(new THREE.MeshStandardMaterial({ map: tex(canvasC), roughness: img ? 0.5 : 0.78, metalness: 0 }));
      const back = keep(new THREE.MeshStandardMaterial({ map: tex(P.paintBack(b.look, grains)), roughness: b.look.binding.kind === 'leather' ? 0.6 : 0.88 }));
      return { front, back, photo: !!img };
    })();
    covers.set(b.id, p);
    return p;
  }

  // Where the book is read: in the middle of the visible part of the canvas (left of the library card on wide
  // screens), above the dialog's buttons, at a size that fits.
  function readingPose(b, mode = 'cover') {
    canvasRect = canvas.getBoundingClientRect();
    const topV = opts.safeTop ? opts.safeTop() : 16; // viewport px the book stays below (and above the buttons)
    const bottomV = window.innerHeight - (opts.safeBottom ? opts.safeBottom() : 96);
    const topPx = Math.max(0, topV - canvasRect.top);
    const bottomPx = Math.min(view.h, bottomV - canvasRect.top);
    const availH = Math.max(160, bottomPx - topPx);
    const wide = view.w >= 1100;
    const cxPx = view.w * (wide ? (mode === 'open' ? 0.56 : 0.44) : 0.5);
    const cyPx = topPx + availH / 2;
    const { thick: t, height: h, depth: d } = b.look;
    // Fit the book's projected size into the space: height and width limits, whichever is tighter.
    const vh = window.innerHeight;
    const maxH = Math.min(availH * 0.88, mode === 'open' ? vh * 0.55 : mode === 'cover' ? vh * 0.6 : 600);
    const maxW = mode === 'open' ? Math.min(view.w * 0.9, 820) : Math.min(view.w * 0.82, 520);
    const worldH = mode === 'open' ? h * Math.cos(OPEN_PITCH) + 0.02 : mode === 'cover' ? h * 1.05 : h;
    const worldW = mode === 'open' ? (2 * d + 0.012) * Math.cos(OPEN_TURN) : d + t * 0.8;
    const tanH = Math.tan((camera.fov * Math.PI) / 360);
    const dist = Math.max((worldH * view.h) / (maxH * 2 * tanH), (worldW * view.h) / (maxW * 2 * tanH));
    const nx = (cxPx / view.w) * 2 - 1, ny = 1 - (cyPx / view.h) * 2;
    const dir = new THREE.Vector3(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const pos = camera.position.clone().addScaledVector(dir, dist / dir.dot(fwd));
    const q = new THREE.Quaternion();
    if (mode === 'cover') q.setFromEuler(new THREE.Euler(READ_TILT.x, READ_TILT.y, READ_TILT.z, 'XYZ'));
    else if (mode === 'back') q.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0, 'XYZ'));
    else {
      q.setFromEuler(new THREE.Euler(OPEN_PITCH, -Math.PI / 2 + OPEN_TURN, 0, 'XYZ'));
      // Centre the open spread (local z from -d/2 to 3d/2): the book's own centre sits half a board to one side.
      pos.sub(new THREE.Vector3(0, 0, d / 2).applyQuaternion(q));
    }
    return { pos, q, dist };
  }

  function setFocusBlur(on, dist) {
    if (!bokeh) return;
    if (on) { bokeh.enabled = true; bokeh.uniforms.focus.value = dist; }
    gsap.to(bokeh.uniforms.aperture, { value: on ? 0.003 : 0, duration: on ? 0.9 : 0.5, ease: 'power2.out', onUpdate: () => invalidate(40), onComplete: () => { if (!on) bokeh.enabled = false; } });
    if (grainPass) gsap.to(grainPass.uniforms.focus, { value: on ? 1 : 0, duration: 0.8 });
  }

  function tweenPose(obj, to, { duration = 0.9, ease = 'power3.out', arc = 0, spin = 0 } = {}) {
    const from = { pos: obj.position.clone(), q: obj.quaternion.clone() };
    const mid = from.pos.clone().lerp(to.pos, 0.5).add(new THREE.Vector3(0, arc, arc * 0.6));
    const p = { t: 0 };
    const qs = new THREE.Quaternion();
    const spinQ = new THREE.Quaternion();
    return new Promise((resolve) => {
      gsap.to(p, {
        t: 1, duration, ease,
        onUpdate: () => {
          const t = p.t, u = 1 - t;
          obj.position.set(u * u * from.pos.x + 2 * u * t * mid.x + t * t * to.pos.x, u * u * from.pos.y + 2 * u * t * mid.y + t * t * to.pos.y, u * u * from.pos.z + 2 * u * t * mid.z + t * t * to.pos.z);
          qs.slerpQuaternions(from.q, to.q, t);
          if (spin) { spinQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin * Math.sin(t * Math.PI)); qs.multiply(spinQ); }
          obj.quaternion.copy(qs);
          invalidate(60);
        },
        onComplete: resolve,
      });
    });
  }

  async function pullOut(id, { flick = false } = {}) {
    const b = books.get(id);
    if (!b || busy || reading) return false;
    busy = true;
    setHover(null);
    if (ring.id === id) ring.el && (ring.el.hidden = true);
    // Bring its bay into view first.
    const first = windowFor(b.bay.index, view.visible, bays.length);
    if (first !== view.first || Math.abs(view.x - windowX(first, view.visible, bays.length)) > 0.01) { panTo(first); await wait(700); }
    const coverP = prefetchCover(b);
    b.state = 'out';
    // Slide the rest of the way out (from wherever the hand left it).
    sound.slide(1);
    gsap.killTweensOf(b.slide.position);
    await new Promise((r) => gsap.to(b.slide.position, { z: PULL.maxOut, y: 0.008, duration: flick ? 0.12 : 0.28, ease: 'power2.out', onUpdate: () => invalidate(50), onComplete: r }));
    gsap.to(b.tilt.rotation, { x: 0.08, duration: 0.15 });
    b.tiltS = { x: 0, v: 0 };
    // Leave the shelf: the mesh flies in world space.
    scene.attach(b.mesh);
    b.mesh.castShadow = false;
    const pose = readingPose(b, 'cover');
    readLight.position.copy(pose.pos).add(new THREE.Vector3(-0.3, 0.4, 0.55));
    gsap.to(readLight, { intensity: 1.6, duration: 0.8 });
    setFocusBlur(true, pose.dist);
    const cov = await Promise.race([coverP, wait(flick ? 120 : 260).then(() => null)]);
    if (cov) { b.mesh.material[0] = cov.front; b.mesh.material[1] = cov.back; }
    else coverP.then((c) => { if (reading && reading.b === b && !reading.rig) { b.mesh.material[0] = c.front; b.mesh.material[1] = c.back; invalidate(100); } });
    reading = { b, face: 'cover', rig: null, coverP };
    on.out?.(id);
    await tweenPose(b.mesh, pose, { duration: flick ? 0.75 : 1.0, ease: flick ? 'power2.out' : 'power3.out', arc: 0.08, spin: flick ? -1.4 : -0.5 });
    sound.rustle();
    busy = false;
    const c = await coverP;
    return { photo: c.photo };
  }

  async function turn(face) {
    if (!reading || busy || reading.face === face) return;
    busy = true;
    if (reading.rig) await closeCover();
    const b = reading.b;
    reading.face = face;
    sound.rustle();
    const pose = readingPose(b, face === 'back' ? 'back' : 'cover');
    await tweenPose(b.mesh, pose, { duration: 0.85, ease: 'power2.inOut' });
    busy = false;
  }

  // The borrowed book opens on its hinge: front board, page block with the pocket, back board and spine.
  function buildRig(b, slip) {
    const { thick: t, height: h, depth: d } = b.look;
    const board = Math.min(0.005, t * 0.12);
    const rig = new THREE.Group();
    rig.position.copy(b.mesh.position); rig.quaternion.copy(b.mesh.quaternion);
    const pocketPainted = P.paintPocketPage(slip, b.look, grains, pocketImg, { w: high ? 768 : 512 });
    const pageTex = tex(pocketPainted.canvas);
    const pageMat = keep(new THREE.MeshStandardMaterial({ map: pageTex, roughness: 0.9 }));
    const block = new THREE.Mesh(keep(new THREE.BoxGeometry(t - 2 * board, h - 0.006, d - 0.004)), [pageMat, pagesMat, pagesMat, pagesMat, pagesMat, pagesMat]);
    block.position.z = -0.002;
    const backBoard = new THREE.Mesh(keep(new THREE.BoxGeometry(board, h, d)), b.mesh.material[1]);
    backBoard.position.x = -t / 2 + board / 2;
    const spine = new THREE.Mesh(keep(new THREE.BoxGeometry(t, h, 0.003)), [b.spineMat, b.spineMat, b.spineMat, b.spineMat, b.spineMat, b.spineMat]);
    spine.position.z = d / 2 - 0.0015;
    const hinge = new THREE.Group();
    hinge.position.set(t / 2 - board / 2, 0, d / 2);
    const endMat = keep(new THREE.MeshStandardMaterial({ map: tex(P.paintEndpaper(b.look, grains, { w: high ? 512 : 384 })), roughness: 0.9 }));
    const frontBoard = new THREE.Mesh(keep(new THREE.BoxGeometry(board, h, d)), [b.mesh.material[0], endMat, b.mesh.material[0], b.mesh.material[0], b.mesh.material[0], b.mesh.material[0]]);
    frontBoard.position.z = -d / 2;
    hinge.add(frontBoard);
    rig.add(block, backBoard, spine, hinge);
    scene.add(rig);
    b.mesh.visible = false;
    return { rig, hinge, block, pageTex, pocketPainted, slip };
  }

  async function closeCover() {
    const r = reading.rig;
    sound.rustle();
    await new Promise((res) => gsap.to(r.hinge.rotation, { y: 0, duration: 0.55, ease: 'power2.inOut', onUpdate: () => invalidate(50), onComplete: res }));
    reading.b.mesh.position.copy(r.rig.position); reading.b.mesh.quaternion.copy(r.rig.quaternion);
    reading.b.mesh.visible = true;
    scene.remove(r.rig);
    reading.rig = null;
  }

  // Borrow: open the cover, the stamp comes down on the slip, today's date appears in red, the stamp lifts.
  // `slip`: { title, previous: [...dates], stamped: 'DD MON YYYY' }. Calls onImpact at the moment of the stamp.
  async function borrow(slip, onImpact) {
    if (!reading || busy) return;
    busy = true;
    const b = reading.b;
    await reading.coverP;
    if (reading.face !== 'cover') { reading.face = 'cover'; }
    const openPose = readingPose(b, 'open');
    // Square up to the cover, then lay the book back.
    await tweenPose(b.mesh, openPose, { duration: 0.75, ease: 'power2.inOut' });
    if (bokeh) bokeh.uniforms.focus.value = openPose.dist;
    reading.rig = buildRig(b, { ...slip, stamped: null });
    const r = reading.rig;
    sound.rustle();
    await new Promise((res) => gsap.to(r.hinge.rotation, { y: -Math.PI * 0.985, duration: 0.95, ease: 'power2.inOut', onUpdate: () => invalidate(50), onComplete: res }));
    // The stamp: from above, down onto the next free row of the slip.
    const stampObj = makeStamp(b.look.depth * 0.36);
    const at = r.pocketPainted.stampAt; // canvas px of the row to stamp
    const cw = r.pocketPainted.canvas.width, ch = r.pocketPainted.canvas.height;
    const { thick: t, height: h, depth: d } = b.look;
    const local = new THREE.Vector3(r.block.geometry.parameters.width / 2 + 0.0002, (h - 0.006) / 2 - (at.y / ch) * (h - 0.006), (d - 0.004) / 2 - (at.x / cw) * (d - 0.004));
    r.rig.updateMatrixWorld(true);
    const contact = local.clone().applyMatrix4(r.block.matrixWorld);
    const normal = new THREE.Vector3(1, 0, 0).applyQuaternion(r.rig.quaternion).normalize();
    // The stamp swings in from the upper right, tilted like a hand bringing it over, and squares up above the slip.
    const aligned = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    const tilted = aligned.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.75));
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const up = contact.clone().addScaledVector(normal, 0.2).addScaledVector(right, 0.24).addScaledVector(camUp, 0.1);
    const hover = contact.clone().addScaledVector(normal, 0.05);
    const ctrl = up.clone().lerp(hover, 0.5).addScaledVector(normal, 0.08);
    stampObj.position.copy(up); stampObj.quaternion.copy(tilted);
    scene.add(stampObj);
    on.stampPhase?.('air');
    const sw = { t: 0 };
    await new Promise((res) => gsap.to(sw, { t: 1, duration: 0.7, ease: 'power2.out', onUpdate: () => {
      const t = sw.t, u = 1 - t;
      stampObj.position.set(u * u * up.x + 2 * u * t * ctrl.x + t * t * hover.x, u * u * up.y + 2 * u * t * ctrl.y + t * t * hover.y, u * u * up.z + 2 * u * t * ctrl.z + t * t * hover.z);
      stampObj.quaternion.slerpQuaternions(tilted, aligned, Math.min(1, t * 1.15));
      invalidate(50);
    }, onComplete: res }));
    on.stampPhase?.('hover');
    await wait(opts.stampPause || 160);
    await new Promise((res) => gsap.to(stampObj.position, { x: contact.x, y: contact.y, z: contact.z, duration: 0.13, ease: 'power3.in', onUpdate: () => invalidate(50), onComplete: res }));
    // Impact: thud, a squash, the book jolts, ink appears.
    sound.stampThud();
    stampObj.scale.set(1.04, 0.93, 1.04);
    const jolt = r.rig.position.clone();
    gsap.fromTo(r.rig.position, { x: jolt.x, y: jolt.y - 0.004, z: jolt.z }, { x: jolt.x, y: jolt.y, z: jolt.z, duration: 0.25, ease: 'elastic.out(1, 0.4)' });
    const repainted = P.paintPocketPage({ ...slip }, b.look, grains, pocketImg, { w: high ? 768 : 512 });
    r.block.material[0].map = tex(repainted.canvas);
    r.block.material[0].needsUpdate = true;
    onImpact?.();
    invalidate(400);
    await wait(220);
    stampObj.scale.set(1, 1, 1);
    await new Promise((res) => gsap.to(stampObj.position, { x: up.x, y: up.y, z: up.z, duration: 0.6, ease: 'power2.in', onUpdate: () => invalidate(50), onComplete: res }));
    scene.remove(stampObj);
    on.stampPhase?.('done');
    reading.face = 'open';
    busy = false;
  }

  function makeStamp(size) {
    const g = new THREE.Group();
    const rubber = new THREE.Mesh(keep(new THREE.BoxGeometry(size, size * 0.06, size * 0.42)), keep(new THREE.MeshStandardMaterial({ color: 0x5a1c18, roughness: 0.8 })));
    rubber.position.y = size * 0.03;
    const blockM = new THREE.Mesh(keep(new THREE.BoxGeometry(size * 1.04, size * 0.16, size * 0.46)), darkWoodMat);
    blockM.position.y = size * 0.06 + size * 0.08;
    const collar = new THREE.Mesh(keep(new THREE.CylinderGeometry(size * 0.14, size * 0.17, size * 0.08, 24)), brassMat);
    collar.position.y = size * 0.26;
    const prof = [[0, 0], [size * 0.09, 0], [size * 0.07, size * 0.25], [size * 0.09, size * 0.42], [size * 0.2, size * 0.55], [size * 0.18, size * 0.68], [0, size * 0.72]].map(([a, c]) => new THREE.Vector2(a, c));
    const handle = new THREE.Mesh(keep(new THREE.LatheGeometry(prof, 28)), keep(new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 0.45 })));
    handle.position.y = size * 0.3;
    g.add(rubber, blockM, collar, handle);
    return g;
  }

  async function putBack() {
    if (!reading) return;
    while (busy) await wait(60);
    busy = true;
    const b = reading.b;
    if (reading.rig) await closeCover();
    setFocusBlur(false);
    gsap.to(readLight, { intensity: 0, duration: 0.6 });
    // Fly back to just in front of its slot, then slide in and settle with a little bounce.
    b.slide.position.set(0, 0.008, PULL.maxOut);
    b.tilt.rotation.set(0.08, 0, 0);
    b.slide.rotation.set(0, 0, 0);
    b.tilt.updateWorldMatrix(true, false);
    const target = new THREE.Object3D();
    target.position.set(0, b.look.height / 2, -b.look.depth / 2);
    b.tilt.add(target);
    target.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3(), q = new THREE.Quaternion();
    target.matrixWorld.decompose(pos, q, new THREE.Vector3());
    b.tilt.remove(target);
    sound.rustle();
    await tweenPose(b.mesh, { pos, q }, { duration: 0.85, ease: 'power2.inOut', arc: 0.05 });
    b.tilt.attach(b.mesh);
    b.mesh.position.set(0, b.look.height / 2, -b.look.depth / 2);
    b.mesh.quaternion.identity();
    b.mesh.castShadow = high;
    sound.slide(0.7);
    gsap.to(b.tilt.rotation, { x: 0, duration: 0.35 });
    await new Promise((r) => gsap.to(b.slide.position, { z: 0, y: 0, duration: 0.5, ease: 'back.out(2.4)', onUpdate: () => invalidate(50), onComplete: r }));
    sound.tock();
    b.state = 'shelf'; b.tiltS = { x: 0, v: 0 }; b.tiltTarget = ring.id === b.id ? TILT : 0;
    reading = null;
    busy = false;
    invalidate(300);
  }

  /* ---------- Filters ---------- */
  function setView({ shelf = 'all', hits = null } = {}) {
    for (const bay of bays) {
      const off = shelf !== 'all' && bay.shelf.id !== shelf;
      for (const b of bay.books) {
        const miss = hits ? !hits.has(b.id) : false;
        const dim = off ? 0.55 : miss ? 0.7 : 0;
        const push = miss ? -0.035 : 0;
        gsap.to(b, { dim, duration: 0.45, onUpdate: () => { b.spineMat.color.setScalar(1 - b.dim); invalidate(40); } });
        if (b.state === 'shelf') gsap.to(b.holder.position, { z: push, y: miss ? -0.004 : 0, duration: 0.5, ease: 'power2.out', onUpdate: () => invalidate(40) });
      }
    }
    if (shelf !== 'all') {
      const i = bays.findIndex((x) => x.shelf.id === shelf);
      if (i >= 0) panTo(windowFor(i, view.visible, bays.length));
    }
    invalidate(600);
  }

  function focusBook(id, showRing = true) {
    const prev = books.get(ring.id);
    if (prev && prev.state === 'shelf' && prev !== hovered) prev.tiltTarget = 0;
    ring.id = id;
    ring.show = showRing;
    if (!id) { if (ring.el) ring.el.hidden = true; invalidate(300); return; }
    const b = books.get(id);
    if (!b) return;
    const first = windowFor(b.bay.index, view.visible, bays.length);
    if (first !== view.first) panTo(first);
    if (b.state === 'shelf') b.tiltTarget = TILT;
    invalidate(1100);
  }

  /* ---------- Start ---------- */
  layout();
  invalidate(1500);

  return {
    tier,
    pullOut, turn, borrow, putBack, setView, focusBook,
    pan(dir) { panTo(view.first + dir * view.visible); },
    panToShelf(id) { const i = bays.findIndex((x) => x.shelf.id === id); if (i >= 0) panTo(windowFor(i, view.visible, bays.length)); },
    windowInfo: () => ({ first: view.first, visible: view.visible, count: bays.length }),
    visibleBooks: () => bays.slice(view.first, view.first + view.visible).flatMap((bay) => bay.books.map((b) => b.id)),
    faceRect(face = 'back') {
      if (!reading) return null;
      if (face === 'leftpage' && !reading.rig) return null;
      const r = face === 'leftpage' ? projectBox(reading.rig.hinge.children[0], 'back') : projectBox(reading.b.mesh, face);
      canvasRect = canvas.getBoundingClientRect();
      return { left: r.left + canvasRect.left, top: r.top + canvasRect.top, width: r.width, height: r.height };
    },
    spineRect(id) { // viewport rectangle of a book's spine on the shelf (tests and the focus ring)
      const b = books.get(id); if (!b) return null;
      const r = projectBox(b.mesh, 'spine'); canvasRect = canvas.getBoundingClientRect();
      return { left: r.left + canvasRect.left, top: r.top + canvasRect.top, width: r.width, height: r.height };
    },
    isBusy: () => busy,
    reading: () => (reading ? { id: reading.b.id, face: reading.face } : null),
    relayout: layout,
    debugScene: scene,
    invalidate,
    stats: () => ({ frameMs: Math.round(cost * 10) / 10, dpr: view.dpr, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, bloom: !!(bloom && bloom.enabled) }),
    destroy() {
      stop(); ro.disconnect(); io?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onCancel); canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('touchmove', onTouchMove);
      for (const d of disposables) d.dispose?.();
      composer?.dispose?.();
      renderer.dispose();
    },
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

function rotate90(src) {
  const c = P.makeCanvas(src.height, src.width), ctx = c.getContext('2d');
  ctx.translate(c.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(src, 0, 0);
  return c;
}

function toCanvas(img, size) {
  const c = P.makeCanvas(size, Math.round(size * img.naturalHeight / img.naturalWidth));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// A small equirectangular room for reflections: dark walls, warm lamps on the left, the cold window up right.
function envCanvas() {
  const w = 256, h = 128, c = P.makeCanvas(w, h), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#1a2233'); g.addColorStop(0.5, '#15110d'); g.addColorStop(1, '#0b0806');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const blob = (x, y, r, col) => { const rg = ctx.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h); };
  blob(w * 0.18, h * 0.5, 26, 'rgba(255,190,110,0.9)');
  blob(w * 0.32, h * 0.55, 18, 'rgba(255,170,90,0.7)');
  blob(w * 0.7, h * 0.3, 30, 'rgba(170,200,255,0.75)');
  blob(w * 0.55, h * 0.35, 60, 'rgba(255,200,140,0.18)');
  return c;
}
