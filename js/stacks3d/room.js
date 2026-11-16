// The Stacks in 3D: the reading room behind the bookcases, built in the scene when no photographed backdrop is
// available. A brick wall warmed by two table lamps on the left, a dark plaster wall with an arched, moonlit window
// and its light shafts, a spiral iron staircase, a plank floor. It is laid out in screen terms (where the title,
// the card and the cases are) at every resize, so the composition holds from phones to 2560px screens.
import * as THREE from 'three';
import * as P from './textures.js';

const WALL_Z = -2.4;

const RAYS = {
  uniforms: { time: { value: 0 }, strength: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `varying vec2 vUv; uniform float time, strength;
    void main(){
      float across = smoothstep(0.0, 0.45, vUv.x) * smoothstep(1.0, 0.55, vUv.x);
      float along = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.08, vUv.y);
      float flicker = 0.85 + 0.15 * sin(time * 0.4 + vUv.y * 3.0);
      gl_FragColor = vec4(vec3(0.7, 0.8, 1.0), across * along * 0.6 * strength * flicker);
    }`,
};

export function buildRoom({ scene, high, tex, keep, maxLights = 2 }) {
  const room = new THREE.Group();
  scene.add(room);

  // Walls and floor.
  const plaster = P.plasterCanvas(high ? 512 : 256, high ? 512 : 256);
  const plasterPBR = P.derivePBR(plaster, { size: 256, strength: 1.4, rough: 0.92, roughGain: 0.1 });
  const plasterTex = tex(plaster, { repeat: true });
  plasterTex.repeat.set(4, 2);
  const plasterN = tex(plasterPBR.normal, { srgb: false, repeat: true }); plasterN.repeat.set(4, 2);
  const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(16, 7)), keep(new THREE.MeshStandardMaterial({ map: plasterTex, normalMap: plasterN, roughness: 0.95, color: 0x60677a })));
  wall.position.set(0, 3.2, WALL_Z);
  room.add(wall);

  const bricks = P.bricksCanvas(high ? 512 : 256, high ? 512 : 256);
  const brickPBR = P.derivePBR(bricks, { size: 256, strength: 3.2, rough: 0.85, roughGain: 0.2 });
  const brickTex = tex(bricks, { repeat: true }), brickN = tex(brickPBR.normal, { srgb: false, repeat: true });
  const brickMat = keep(new THREE.MeshStandardMaterial({ map: brickTex, normalMap: brickN, roughness: 0.9, color: 0xd8c0a8 }));
  const brick = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1)), brickMat);
  room.add(brick);

  // The arched window: glass that glows (bloom), a frame, mullions and a sill.
  const win = new THREE.Group();
  const ww = 0.62, wh = 1.05; // rectangle part; the arch adds ww/2 on top
  const shape = new THREE.Shape();
  shape.moveTo(-ww / 2, 0); shape.lineTo(ww / 2, 0); shape.lineTo(ww / 2, wh); shape.absarc(0, wh, ww / 2, 0, Math.PI, false); shape.lineTo(-ww / 2, 0);
  const glassGeo = keep(new THREE.ShapeGeometry(shape, 24));
  // UVs for the glass gradient.
  const pos = glassGeo.attributes.position, uv = glassGeo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / ww + 0.5, pos.getY(i) / (wh + ww / 2));
  const glass = new THREE.Mesh(glassGeo, keep(new THREE.MeshBasicMaterial({ map: tex(P.windowGlassCanvas()), color: new THREE.Color(1, 1, 1).multiplyScalar(high ? 1.1 : 0.9), toneMapped: !high })));
  win.add(glass);
  const iron = keep(new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6, metalness: 0.4 }));
  const bar = (w, h, x, y) => { const m = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, 0.03)), iron); m.position.set(x, y, 0.012); win.add(m); };
  for (const x of [-ww / 6, ww / 6]) bar(0.022, wh + ww / 2 - 0.02, x, (wh + ww / 2) / 2 - 0.01);
  for (const y of [wh * 0.33, wh * 0.66, wh]) bar(ww, 0.022, 0, y);
  const frameGeo = keep(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(-ww / 2, 0, 0), new THREE.Vector3(-ww / 2, wh, 0),
    ...Array.from({ length: 13 }, (_, k) => { const a = Math.PI - (k / 12) * Math.PI; return new THREE.Vector3(Math.cos(a) * ww / 2, wh + Math.sin(a) * ww / 2, 0); }),
    new THREE.Vector3(ww / 2, wh, 0), new THREE.Vector3(ww / 2, 0, 0),
  ], false, 'catmullrom', 0.01), 64, 0.03, 6, false));
  const frame = new THREE.Mesh(frameGeo, keep(new THREE.MeshStandardMaterial({ color: 0x2b2522, roughness: 0.8 })));
  win.add(frame);
  const sill = new THREE.Mesh(keep(new THREE.BoxGeometry(ww + 0.16, 0.05, 0.14)), keep(new THREE.MeshStandardMaterial({ color: 0x3a3631, roughness: 0.85 })));
  sill.position.set(0, -0.03, 0.06);
  win.add(sill);
  room.add(win);

  // Moonlight shafts from the window, falling down and to the left.
  const rayMat = keep(new THREE.ShaderMaterial({ ...RAYS, uniforms: THREE.UniformsUtils.clone(RAYS.uniforms), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  const rays = new THREE.Group();
  [[0.0, 0.62, 0], [-0.14, 0.38, 0.12], [0.16, 0.42, -0.08], [-0.05, 0.24, 0.25]].forEach(([dx, w, dz]) => {
    const g = new THREE.PlaneGeometry(w, 4.2);
    g.translate(0, -2.1, 0);
    const m = new THREE.Mesh(keep(g), rayMat);
    m.position.set(dx, 0, dz);
    rays.add(m);
  });
  rays.name = 'rays';
  room.add(rays);
  const moon = new THREE.SpotLight(0x9fb8ff, high ? 9 : 6, 0, 0.5, 0.9, 2);
  room.add(moon); room.add(moon.target);

  // Table lamps on a low sideboard.
  const brass = keep(new THREE.MeshStandardMaterial({ color: 0xb08a40, metalness: 1, roughness: 0.35 }));
  const shadeMat = keep(new THREE.MeshStandardMaterial({ map: tex(P.shadeCanvas()), emissive: 0xffb860, emissiveMap: null, emissiveIntensity: high ? 1.5 : 1.05, side: THREE.DoubleSide, roughness: 0.8 }));
  const sideboard = new THREE.Mesh(keep(new THREE.BoxGeometry(1.6, 0.8, 0.45)), keep(new THREE.MeshStandardMaterial({ color: 0x24170e, roughness: 0.6 })));
  room.add(sideboard);
  const lamps = [0, 1].map((k) => {
    const g = new THREE.Group();
    const prof = [[0, 0], [0.09, 0], [0.09, 0.02], [0.03, 0.04], [0.025, 0.2], [0.05, 0.26], [0.02, 0.32], [0.012, 0.42], [0, 0.42]].map(([a, b]) => new THREE.Vector2(a, b));
    const base = new THREE.Mesh(keep(new THREE.LatheGeometry(prof, 24)), brass);
    const shade = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.11, 0.2, 0.22, 32, 1, true)), shadeMat);
    shade.position.y = 0.48;
    const glow = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: tex(P.glowCanvas(128, 'rgba(255,205,140,1)', 'rgba(255,150,60,0)')), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: high ? 0.12 : 0.35 })));
    glow.scale.set(0.5, 0.5, 1); glow.position.y = 0.45; glow.name = 'lampglow'; shade.name = 'shade';
    // The warm pool the lamp throws on the wall behind it (a soft additive decal: cheaper and calmer than a light).
    const pool = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.5, 1.3)), keep(new THREE.MeshBasicMaterial({ map: tex(P.glowCanvas(128, 'rgba(255,170,90,1)', 'rgba(255,120,40,0)')), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.38 })));
    pool.position.set(0, 0.5, -0.33); pool.name = 'pool';
    g.add(base, shade, glow, pool);
    g.scale.setScalar(k ? 0.85 : 1);
    room.add(g);
    return g;
  });
  const lampLights = lamps.slice(0, maxLights).map(() => { const l = new THREE.PointLight(0xffb15a, high ? 0.7 : 0.6, 1.6, 2); room.add(l); return l; });

  // A spiral iron staircase in the shadows.
  const stair = new THREE.Group();
  const stepMat = keep(new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.55, metalness: 0.5 }));
  const pole = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.04, 0.04, 4.2, 12)), stepMat);
  pole.position.y = 2.1; stair.add(pole);
  const n = 22, rise = 0.19, R = 0.62;
  const stepGeo = keep(new THREE.BoxGeometry(R, 0.03, 0.2));
  stepGeo.translate(R / 2, 0, 0);
  for (let i = 0; i < n; i++) { const s = new THREE.Mesh(stepGeo, stepMat); s.position.y = 0.2 + i * rise; s.rotation.y = i * 0.42; stair.add(s); }
  const helix = new THREE.CatmullRomCurve3(Array.from({ length: 60 }, (_, k) => { const t = k / 59 * n; return new THREE.Vector3(Math.cos(-t * 0.42) * R, 1.05 + t * rise, Math.sin(-t * 0.42) * R); }));
  stair.add(new THREE.Mesh(keep(new THREE.TubeGeometry(helix, 200, 0.012, 6, false)), stepMat));
  for (let i = 0; i < n; i += 2) {
    const a = -i * 0.42, b = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.006, 0.006, 0.85, 5)), stepMat);
    b.position.set(Math.cos(a) * R, 0.2 + i * rise + 0.42, Math.sin(a) * R); stair.add(b);
  }
  room.add(stair);

  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(16, 1.52)), keep(new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.7 })));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, WALL_Z + 0.75);
  floor.receiveShadow = high;
  room.add(floor);

  // Lay the room out from screen positions: where the window, lamps and stairs should appear on this screen.
  // `at(px, py, z)` maps a canvas pixel to the world point at depth z (relative to the room's x).
  function place({ at, w, heroH, casesTop, cx }) {
    room.position.x = cx;
    const narrow = w < 700;
    const wallAt = (fx, fy) => at(fx * w, fy, WALL_Z);
    // Window: up and right of centre, its top near the top of the hero.
    const wTop = wallAt(narrow ? 0.66 : 0.6, Math.max(20, heroH * 0.06));
    const wBot = wallAt(narrow ? 0.66 : 0.6, heroH * (narrow ? 0.42 : 0.58));
    const fullH = wTop.y - wBot.y;
    const s = fullH / (wh + ww / 2);
    win.scale.setScalar(s);
    win.position.set(wTop.x - cx, wBot.y, WALL_Z + 0.01);
    rays.position.set(win.position.x, wBot.y + (wh * 0.6) * s, WALL_Z + 0.25);
    rays.rotation.set(-0.35, 0, -0.62);
    rays.scale.setScalar(Math.max(0.8, s * 1.2));
    moon.position.set(win.position.x, wBot.y + wh * s * 0.6, WALL_Z + 0.4);
    moon.target.position.set(win.position.x - 2.2, 0, 0.6);
    // Bricks: the left part of the wall, down to the floor.
    const bTop = wallAt(0, Math.max(0, heroH * 0.12)), bRight = wallAt(narrow ? 0.34 : 0.4, 0);
    const bLeft = bTop.x - 1.5;
    const bw = bRight.x - bLeft, bh = bTop.y + 0.05;
    brick.scale.set(bw, bh, 1);
    brick.position.set((bLeft + bRight.x) / 2 - cx, bh / 2, WALL_Z + 0.006);
    brickTex.repeat.set(bw / 1.2, bh / 1.2); brickN.repeat.copy(brickTex.repeat);
    // Lamps on the sideboard, their shades level with the bottom of the hero, just above the cases.
    const lampZ = WALL_Z + 0.35;
    const topY = at(0, casesTop, lampZ).y; // world y at the top of the cases, at the lamps' depth
    const sbTop = topY - 0.05;
    sideboard.position.set(at(w * (narrow ? 0.12 : 0.17), 0, lampZ).x - cx, sbTop - 0.4, lampZ - 0.05);
    const xs = narrow ? [0.06, 0.3] : [0.05, 0.3];
    lamps.forEach((l, k) => {
      const p = at(w * xs[k], 0, lampZ);
      l.position.set(p.x - cx, sbTop, lampZ);
    });
    lampLights.forEach((li, k) => li.position.set(lamps[k].position.x, sbTop + 0.4 * lamps[k].scale.y, lampZ - 0.05));
    // Stairs behind the middle of the hero.
    const st = at(w * (narrow ? 0.4 : 0.47), 0, WALL_Z + 0.9);
    stair.position.set(st.x - cx, 0, WALL_Z + 0.9);
    return { shaftOrigin: new THREE.Vector3(win.position.x + cx, rays.position.y, rays.position.z), shaftDir: new THREE.Vector3(-Math.sin(0.62), -Math.cos(0.62), 0) };
  }

  function update(t) { rayMat.uniforms.time.value = t; }
  return { room, place, update };
}
