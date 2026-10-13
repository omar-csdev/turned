import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GameEvent, GameSnapshot, PlayerState, WeaponId, ZombieState } from '@survive-the-night/game-shared/turned/protocol';
import { WEAPONS } from '@survive-the-night/game-shared/turned/protocol';
import { ISLAND_BUILDINGS, LOOT_SPAWNS, VEHICLE_SPAWNS, ZOMBIE_SPAWNS } from '@survive-the-night/game-shared/turned/island';
import { createIsland, type IslandScene } from './world';
import { createLoot, createStructure, createSurvivor, createVehicle, createWeapon, createZombie, type HumanoidModel, type VehicleModel } from './models';

interface Actor {
  model: HumanoidModel;
  target: THREE.Vector3;
  yaw: number;
  moving: boolean;
  allowed: boolean;
  walking: number;
  deadAt: number | null;
  weapon?: WeaponId;
  held?: THREE.Group;
}
interface Car { model: VehicleModel; target: THREE.Vector3; yaw: number; speed: number }
interface Particle { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number; duration: number; blood: boolean }
interface Tracer { line: THREE.Line; life: number }

const TAU = Math.PI * 2;
const dampAngle = (from: number, to: number, alpha: number) => from + (Math.atan2(Math.sin(to - from), Math.cos(to - from))) * alpha;

/** Browser-only renderer. No timers or input listeners: TurnedEngine owns the frame loop. */
export class TurnedRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(68, 1, .08, 1600);
  private readonly viewScene = new THREE.Scene();
  private readonly viewCamera = new THREE.PerspectiveCamera(68, 1, .015, 10);
  private readonly sun = new THREE.DirectionalLight('#fff1ce', 2.3);
  private readonly hemisphere = new THREE.HemisphereLight('#e0f3ff', '#819452', 2.2);
  private readonly island: IslandScene;
  private readonly resizeObserver: ResizeObserver;
  private readonly actors = new Map<string, Actor>();
  private readonly cars = new Map<string, Car>();
  private readonly pickups = new Map<string, THREE.Group>();
  private readonly structures = new Map<string, THREE.Group>();
  private readonly activeNodes = new Map<string, boolean>();
  private readonly previewActors = new THREE.Group();
  private readonly dynamicActors = new THREE.Group();
  private readonly particles: Particle[] = [];
  private readonly tracers: Tracer[] = [];
  private readonly splats: { mesh: THREE.Mesh; life: number }[] = [];
  private readonly particleGeometry = new THREE.BoxGeometry(.085, .085, .085);
  private readonly particleMaterials = {
    blood: new THREE.MeshStandardMaterial({ color: '#af3330', roughness: .9 }),
    wood: new THREE.MeshStandardMaterial({ color: '#c79650', roughness: .9 }),
    stone: new THREE.MeshStandardMaterial({ color: '#9fabaa', roughness: .9 }),
    gold: new THREE.MeshStandardMaterial({ color: '#edc866', emissive: '#dba948', emissiveIntensity: .5 }),
  };
  private readonly splatGeometry = new THREE.CircleGeometry(.28, 7);
  private readonly splatMaterial = new THREE.MeshBasicMaterial({ color: '#873c32', transparent: true, opacity: .65, depthWrite: false });
  private readonly weaponRoot = new THREE.Group();
  private readonly weaponModels = new Map<WeaponId, THREE.Group>();
  private readonly muzzleFlash = new THREE.Mesh(new THREE.IcosahedronGeometry(.065, 0), new THREE.MeshBasicMaterial({ color: '#ffe8a5' }));
  private snapshot: GameSnapshot | null = null;
  private playerId = '';
  private player: PlayerState | null = null;
  private localPosition = new THREE.Vector3();
  private localReady = false;
  private yaw = 0;
  private pitch = 0;
  private preview = true;
  private blood = true;
  private disposed = false;
  private contextLost = false;
  private time = 0;
  private previewFrameTime = 0;
  private bob = 0;
  private lastEvent = -1;
  private shotAt = -100;
  private aim = false;
  private aimBlend = 0;
  private currentWeapon: WeaponId = 'pistol';
  private readonly skyDay = new THREE.Color('#9fc8e2');
  private readonly skyNight = new THREE.Color('#334e6c');
  private readonly skyColor = new THREE.Color();
  private readonly target = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();

  constructor(private readonly container: HTMLElement) {
    // The caller catches this exception and presents the supported-browser recovery UI.
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      throw new Error('Turned needs WebGL to render its island. Enable hardware acceleration, then reload in a recent browser.');
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.autoClear = false;
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;';
    this.renderer.domElement.setAttribute('aria-label', 'Turned — Pinefall Island 3D game view');
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
    this.container.appendChild(this.renderer.domElement);
    this.scene.background = this.skyColor;
    this.scene.fog = new THREE.Fog(this.skyDay, 220, 620);
    this.scene.add(this.hemisphere, this.sun, this.sun.target);
    this.sun.position.set(80, 120, 50);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -155, right: 155, top: 155, bottom: -155, near: .5, far: 350 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -.0004;
    this.sun.shadow.normalBias = .055;
    this.island = createIsland();
    this.scene.add(this.island.root, this.previewActors, this.dynamicActors);
    this.dynamicActors.visible = false;
    this.createPreviewLife();
    this.viewScene.add(new THREE.HemisphereLight('#f0f5e1', '#728575', 3));
    const viewLight = new THREE.DirectionalLight('#ffedc9', 2.3); viewLight.position.set(-3, 5, 4); this.viewScene.add(viewLight);
    this.viewScene.add(this.weaponRoot);
    for (const id of ['axe', 'pistol', 'rifle', 'shotgun'] as const) {
      const weapon = createWeapon(id, true); weapon.visible = id === this.currentWeapon; this.weaponRoot.add(weapon); this.weaponModels.set(id, weapon);
    }
    this.muzzleFlash.visible = false; this.viewScene.add(this.muzzleFlash);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    this.resize();
  }

  get canvas(): HTMLCanvasElement { return this.renderer.domElement; }

  setView(yaw: number, pitch: number): void {
    this.yaw = Number.isFinite(yaw) ? yaw : this.yaw;
    this.pitch = Number.isFinite(pitch) ? THREE.MathUtils.clamp(pitch, -1.45, 1.45) : this.pitch;
  }

  setAim(aim: boolean): void { this.aim = aim; }

  setPreview(enabled: boolean): void {
    if (this.preview === enabled) return;
    this.preview = enabled;
    this.previewFrameTime = 0;
    this.renderer.shadowMap.needsUpdate = true;
    this.previewActors.visible = enabled;
    this.dynamicActors.visible = !enabled;
    if (enabled) {
      for (const id of this.activeNodes.keys()) this.island.setNodeActive(id, true);
      this.activeNodes.clear();
      for (const particle of this.particles) particle.life = 0;
      for (const splat of this.splats) splat.life = 0;
    }
    Object.assign(this.scene.fog!, { near: enabled ? 220 : 95, far: enabled ? 620 : 340 });
    this.localReady = false;
    const extent = enabled ? 155 : 52;
    Object.assign(this.sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  setSettings(settings: { blood?: boolean }): void {
    if (settings.blood === undefined) return;
    this.blood = settings.blood;
    for (const actor of this.actors.values()) this.applyBloodSetting(actor.model.root);
    this.applyBloodSetting(this.previewActors);
    if (!this.blood) {
      for (const particle of this.particles) if (particle.blood) particle.life = 0;
      for (const splat of this.splats) splat.life = 0;
    }
  }

  setSnapshot(snapshot: GameSnapshot, playerId: string): void {
    if (this.disposed) return;
    if (this.playerId !== playerId || (this.snapshot && snapshot.tick < this.snapshot.tick)) {
      this.lastEvent = -1; this.localReady = false;
    }
    const first = this.snapshot === null || this.playerId !== playerId;
    this.snapshot = snapshot; this.playerId = playerId;
    this.player = snapshot.players.find(p => p.id === playerId) ?? null;
    const seen = new Set<string>();
    for (const player of snapshot.players) {
      if (player.id === playerId) continue;
      seen.add(player.id);
      const actor = this.getActor(player.id, player);
      actor.target.set(player.x, player.y, player.z); actor.yaw = player.yaw; actor.moving = player.moving;
      actor.allowed = player.connected && !player.vehicleId;
      actor.model.head.rotation.x = -player.pitch * .65;
      if (actor.weapon !== player.weapon) {
        if (actor.held) { actor.model.rightArm.remove(actor.held); this.disposeObject(actor.held); }
        actor.held = createWeapon(player.weapon); actor.held.position.set(0, -.49, -.07); actor.held.rotation.x = -Math.PI / 2;
        actor.model.rightArm.add(actor.held); actor.weapon = player.weapon;
      }
      this.setDead(actor, player.dead);
    }
    for (const zombie of snapshot.zombies) {
      seen.add(zombie.id);
      const actor = this.getActor(zombie.id, zombie);
      actor.moving = actor.target.distanceToSquared(this.target.set(zombie.x, zombie.y, zombie.z)) > .0002;
      actor.target.copy(this.target); actor.yaw = zombie.yaw;
      actor.model.root.userData.attacking = zombie.attacking;
      this.setDead(actor, zombie.health <= 0);
    }
    for (const [id, actor] of this.actors) if (!seen.has(id)) { this.dynamicActors.remove(actor.model.root); this.disposeObject(actor.model.root); this.actors.delete(id); }
    const carsSeen = new Set<string>();
    for (const vehicle of snapshot.vehicles) {
      carsSeen.add(vehicle.id);
      let car = this.cars.get(vehicle.id);
      if (!car) {
        const model = createVehicle(vehicle.kind, vehicle.color);
        model.root.position.set(vehicle.x, 0, vehicle.z); model.root.rotation.y = vehicle.yaw;
        car = { model, target: model.root.position.clone(), yaw: vehicle.yaw, speed: vehicle.speed }; this.cars.set(vehicle.id, car); this.dynamicActors.add(model.root);
      }
      car.target.set(vehicle.x, 0, vehicle.z); car.yaw = vehicle.yaw; car.speed = vehicle.speed;
      car.model.root.userData.destroyed = vehicle.health <= 0;
    }
    for (const [id, car] of this.cars) if (!carsSeen.has(id)) { this.dynamicActors.remove(car.model.root); this.disposeObject(car.model.root); this.cars.delete(id); }
    for (const loot of snapshot.loot) {
      let pickup = this.pickups.get(loot.id);
      if (!pickup && loot.active) {
        pickup = createLoot(loot.kind); pickup.position.set(loot.x, 0, loot.z); this.pickups.set(loot.id, pickup); this.dynamicActors.add(pickup);
        const halo = new THREE.Mesh(new THREE.RingGeometry(.43, .51, 16), new THREE.MeshBasicMaterial({ color: loot.kind === 'supply' ? '#f4d369' : '#e1e9b9', transparent: true, opacity: .45, depthWrite: false, side: THREE.DoubleSide }));
        halo.rotation.x = -Math.PI / 2; halo.position.y = .025; halo.name = 'halo'; pickup.add(halo);
      }
      if (pickup) { pickup.visible = loot.active; pickup.userData.active = loot.active; }
    }
    for (const node of snapshot.nodes) if (this.activeNodes.get(node.id) !== node.active) { this.island.setNodeActive(node.id, node.active); this.activeNodes.set(node.id, node.active); }
    const structuresSeen = new Set<string>();
    for (const building of snapshot.buildings) {
      structuresSeen.add(building.id);
      let model = this.structures.get(building.id);
      if (!model) { model = createStructure(building.kind); model.position.set(building.x, 0, building.z); model.rotation.y = building.yaw; this.structures.set(building.id, model); this.dynamicActors.add(model); }
      model.visible = building.health > 0;
    }
    for (const [id, model] of this.structures) if (!structuresSeen.has(id)) { this.dynamicActors.remove(model); this.disposeObject(model); this.structures.delete(id); }
    if (first) this.lastEvent = snapshot.events.reduce((max, event) => Math.max(max, event.id), -1);
    for (let i = 0; i < snapshot.events.length; i++) {
      const event = snapshot.events[i];
      if (event.id <= this.lastEvent) continue;
      this.lastEvent = event.id;
      this.handleEvent(event, snapshot.events[i + 1]);
    }
  }

  update(dt: number): void {
    if (this.disposed) return;
    if (this.contextLost) throw new Error('The graphics connection was lost. Reload Turned to reconnect to your lobby.');
    if (document.hidden) return;
    // An idle menu needs a gentle flyover, not a full-speed game/shadow pass.
    if (this.preview) {
      this.previewFrameTime += dt;
      if (this.previewFrameTime < 1 / 20) return;
      dt = this.previewFrameTime;
      this.previewFrameTime = 0;
    }
    this.renderer.shadowMap.autoUpdate = !this.preview;
    dt = Math.min(Math.max(dt, 0), .08); this.time += dt;
    const alpha = 1 - Math.exp(-18 * dt);
    this.aimBlend = THREE.MathUtils.lerp(this.aimBlend, this.aim ? 1 : 0, 1 - Math.exp(-14 * dt));
    for (const actor of this.actors.values()) this.animateActor(actor, dt, alpha);
    for (const car of this.cars.values()) {
      car.model.root.position.lerp(car.target, alpha); car.model.root.rotation.y = dampAngle(car.model.root.rotation.y, car.yaw, alpha);
      car.model.root.visible = car.target.distanceToSquared(this.camera.position) < 160 * 160;
      for (const wheel of car.model.wheels) wheel.rotation.x -= car.speed * dt / .43;
      car.model.root.rotation.z = car.model.root.userData.destroyed ? .075 : Math.sin(this.time * 17) * Math.min(Math.abs(car.speed), 10) * .0008;
    }
    for (const [id, pickup] of this.pickups) {
      pickup.visible = pickup.userData.active && pickup.position.distanceToSquared(this.camera.position) < 85 * 85;
      if (!pickup.visible) continue;
      pickup.position.y = .08 + Math.sin(this.time * 2.2 + id.length) * .055;
      pickup.rotation.y = Math.sin(this.time * .45 + id.length) * .14;
      const halo = pickup.getObjectByName('halo'); if (halo) halo.position.y = .025 - pickup.position.y;
    }
    for (const model of this.structures.values()) {
      const flame = model.getObjectByName('flame'); if (flame) { flame.scale.y = .9 + Math.sin(this.time * 15) * .14; flame.rotation.y = this.time * .5; }
    }
    this.island.clouds.position.x = Math.sin(this.time * .005) * 13;
    this.updateAtmosphere();
    if (this.preview || !this.player) this.updatePreview(); else this.updatePlayer(dt, alpha);
    this.updateEffects(dt);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (!this.preview && this.player && !this.player.dead && !this.player.vehicleId) {
      this.updateWeapon(dt);
      this.renderer.clearDepth(); this.renderer.render(this.viewScene, this.viewCamera);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.disposeObject(this.scene); this.disposeObject(this.viewScene);
    this.particleGeometry.dispose(); this.splatGeometry.dispose(); this.splatMaterial.dispose();
    Object.values(this.particleMaterials).forEach(m => m.dispose());
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.canvas.remove();
    this.actors.clear(); this.cars.clear(); this.pickups.clear(); this.structures.clear();
  }

  private resize = (): void => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = this.viewCamera.aspect = width / height;
    this.camera.updateProjectionMatrix(); this.viewCamera.updateProjectionMatrix();
  };
  private onContextLost = (event: Event): void => { event.preventDefault(); this.contextLost = true; };
  private onContextRestored = (): void => { this.contextLost = false; };

  private createPreviewLife(): void {
    for (const spawn of VEHICLE_SPAWNS) {
      const car = createVehicle(spawn.kind, spawn.color); car.root.position.set(spawn.x, 0, spawn.z); car.root.rotation.y = spawn.yaw; this.previewActors.add(car.root);
    }
    for (const loot of LOOT_SPAWNS) { const model = createLoot(loot.kind); model.position.set(loot.x, .05, loot.z); this.previewActors.add(model); }
    for (let i = 0; i < ZOMBIE_SPAWNS.length; i += 3) {
      const spawn = ZOMBIE_SPAWNS[i], model = createZombie(spawn.kind); model.root.position.set(spawn.x, 0, spawn.z); model.root.rotation.y = i * 1.7; this.previewActors.add(model.root);
    }
    const campfire = createStructure('campfire'); campfire.position.set(0, 0, 102); this.previewActors.add(campfire);
    const workbench = createStructure('workbench'); workbench.position.set(-12, 0, 98); this.previewActors.add(workbench);
    this.batchPreview();
  }

  /** Preview characters are scenery: combine matching surfaces across every model. */
  private batchPreview(): void {
    this.previewActors.updateMatrixWorld(true);
    const batches = new Map<string, { material: THREE.MeshStandardMaterial; meshes: THREE.Mesh[] }>();
    this.previewActors.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial) || object.material.transparent || object.userData.blood) return;
      const mat = object.material;
      const key = [mat.color.getHex(), mat.emissive.getHex(), mat.emissiveIntensity, mat.metalness, mat.roughness].join(':');
      const group = batches.get(key) ?? { material: mat, meshes: [] }; group.meshes.push(object); batches.set(key, group);
    });
    const discardedMaterials = new Set<THREE.Material>();
    const preservedMaterials = new Set([...batches.values()].map(b => b.material));
    for (const batch of batches.values()) {
      if (batch.meshes.length < 2) continue;
      const geometries = batch.meshes.map(mesh => {
        const transformed = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
        const result = transformed.index ? transformed.toNonIndexed() : transformed;
        if (result !== transformed) transformed.dispose(); return result;
      });
      const merged = mergeGeometries(geometries, false);
      geometries.forEach(g => g.dispose());
      if (!merged) continue;
      for (const mesh of batch.meshes) {
        mesh.removeFromParent(); mesh.geometry.dispose();
        if (mesh.material !== batch.material) discardedMaterials.add(mesh.material as THREE.Material);
      }
      const mesh = new THREE.Mesh(merged, batch.material); mesh.castShadow = mesh.receiveShadow = true; this.previewActors.add(mesh);
    }
    for (const mat of discardedMaterials) if (!preservedMaterials.has(mat as THREE.MeshStandardMaterial)) mat.dispose();
  }

  private getActor(id: string, state: PlayerState | ZombieState): Actor {
    let actor = this.actors.get(id);
    if (!actor) {
      const model = 'color' in state ? createSurvivor(state.color) : createZombie(state.kind);
      model.root.position.set(state.x, state.y, state.z); model.root.rotation.y = state.yaw;
      actor = { model, target: model.root.position.clone(), yaw: state.yaw, moving: false, allowed: true, walking: id.length, deadAt: null };
      this.applyBloodSetting(model.root); this.actors.set(id, actor); this.dynamicActors.add(model.root);
    }
    return actor;
  }
  private setDead(actor: Actor, dead: boolean): void {
    if (dead && actor.deadAt === null) actor.deadAt = this.time;
    if (!dead && actor.deadAt !== null) { actor.deadAt = null; actor.model.root.scale.setScalar(1); actor.model.root.rotation.x = 0; }
  }
  private animateActor(actor: Actor, dt: number, alpha: number): void {
    const { model } = actor;
    model.root.visible = actor.allowed && actor.target.distanceToSquared(this.camera.position) < 115 * 115;
    model.root.position.lerp(actor.target, alpha);
    model.root.rotation.y = dampAngle(model.root.rotation.y, actor.yaw, alpha);
    if (actor.deadAt !== null) {
      const elapsed = this.time - actor.deadAt;
      model.root.rotation.x = THREE.MathUtils.lerp(model.root.rotation.x, -1.5, 1 - Math.exp(-8 * dt));
      model.root.position.y = .18;
      model.root.scale.setScalar(Math.max(0, 1 - Math.max(0, elapsed - 4) / 2));
      return;
    }
    const zombie = model.root.name.includes('infected');
    actor.walking += dt * (model.root.name.startsWith('runner') ? 11 : 7.5);
    const gait = Math.sin(actor.walking) * (actor.moving ? .6 : .035);
    model.leftLeg.rotation.x = gait; model.rightLeg.rotation.x = -gait;
    if (zombie) {
      const attack = model.root.userData.attacking ? Math.sin(this.time * 14) * .45 : 0;
      model.leftArm.rotation.x = 1.05 + gait * .25 + attack;
      model.rightArm.rotation.x = 1.15 - gait * .25 + attack;
      model.root.rotation.x = model.root.name.startsWith('runner') ? -.12 : -.035;
    } else {
      model.leftArm.rotation.x = actor.weapon === 'axe' ? -gait : 1.1 + gait*.12;
      model.rightArm.rotation.x = 1.25 + gait * .12;
    }
    model.root.position.y += actor.moving ? Math.abs(Math.sin(actor.walking)) * .035 : 0;
  }

  private updatePreview(): void {
    const a = .7 + Math.sin(this.time * .006) * .1;
    this.camera.position.set(Math.sin(a) * 225, 100, Math.cos(a) * 225);
    this.camera.lookAt(-13, 3, -4);
    if (this.camera.fov !== 49) { this.camera.fov = 49; this.camera.updateProjectionMatrix(); }
    this.sun.target.position.set(0, 0, 0); this.sun.position.set(70, 125, 60);
  }

  private updatePlayer(dt: number, alpha: number): void {
    const p = this.player!;
    this.target.set(p.x, p.y, p.z);
    if (!this.localReady || this.localPosition.distanceToSquared(this.target) > 144) { this.localPosition.copy(this.target); this.localReady = true; }
    this.localPosition.lerp(this.target, alpha);
    this.bob += dt * (p.moving ? 10 : 2);
    const bob = p.moving && p.y < .02 ? Math.sin(this.bob * 2) * .025 : 0;
    if (p.vehicleId) {
      const car = this.cars.get(p.vehicleId);
      const center = car?.model.root.position ?? this.localPosition;
      const behindX = Math.sin(this.yaw), behindZ = Math.cos(this.yaw);
      let distance = 5.8;
      // Keep chase cameras outside solid buildings when backing into a wall.
      for (let step = 1; step <= 6; step += .4) {
        const x = center.x + behindX * step, z = center.z + behindZ * step;
        if (ISLAND_BUILDINGS.some(b => Math.abs(x-b.x) < b.width/2+.3 && Math.abs(z-b.z) < b.depth/2+.3)) { distance = Math.max(.7, step - .5); break; }
      }
      this.camera.position.set(center.x + behindX * distance, 3.1 - this.pitch * 1.3, center.z + behindZ * distance);
      this.camera.lookAt(center.x - behindX * 8, 1.7 + this.pitch * 6, center.z - behindZ * 8);
    } else {
      this.camera.position.copy(this.localPosition); this.camera.position.y += p.dead ? .4 : 1.62 + bob;
      this.camera.rotation.set(this.pitch, this.yaw, p.dead ? -.3 : 0, 'YXZ');
    }
    const targetFov = p.vehicleId ? 73 : THREE.MathUtils.lerp(68, 49, this.aimBlend);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-10*dt)); this.camera.updateProjectionMatrix();
    this.sun.target.position.set(p.x, 0, p.z); this.sun.position.set(p.x + 70, 120, p.z + 55);
  }

  private updateWeapon(dt: number): void {
    const p = this.player!;
    if (p.weapon !== this.currentWeapon) {
      this.currentWeapon = p.weapon;
      for (const [id, model] of this.weaponModels) model.visible = id === p.weapon;
      this.shotAt = -100;
    }
    const axe = p.weapon === 'axe';
    const sinceShot = this.time - this.shotAt;
    const recoil = Math.exp(-sinceShot * 24);
    const swing = axe && sinceShot < .42 ? Math.sin(Math.min(1, sinceShot / .42) * Math.PI) : 0;
    const reloadProgress = p.reloading > 0 ? 1 - p.reloading / WEAPONS[p.weapon].reload : 0;
    const reload = p.reloading > 0 ? Math.sin(Math.PI * THREE.MathUtils.clamp(reloadProgress, .03, .97)) : 0;
    const bobStrength = p.moving ? 1 : .12;
    const ads = axe ? 0 : this.aimBlend;
    this.weaponRoot.position.set(
      THREE.MathUtils.lerp(axe ? .47 : .3, 0, ads) + Math.sin(this.bob)*.013*bobStrength - swing*.27,
      THREE.MathUtils.lerp(axe ? -.5 : -.3, -.167, ads) + Math.cos(this.bob*2)*.012*bobStrength - reload*.19 - swing*.12,
      (axe ? -.83 : -.7) + recoil*.055 + reload*.07,
    );
    this.weaponRoot.rotation.set(recoil*.16 - swing*1.7 - reload*.42, reload*-.5, (axe ? -.2 : 0) - swing*.38 - reload*.65);
    const model = this.weaponModels.get(p.weapon)!;
    const muzzle = model.getObjectByName('muzzle');
    this.muzzleFlash.visible = !!muzzle && sinceShot < .045 && p.reloading <= 0;
    if (this.muzzleFlash.visible && muzzle) {
      this.weaponRoot.updateMatrixWorld(true); muzzle.getWorldPosition(this.muzzleFlash.position);
      this.muzzleFlash.scale.set(1, 1, p.weapon === 'shotgun' ? 3.1 : 2.1); this.muzzleFlash.rotation.z = this.time * 57;
    }
    this.viewCamera.fov = THREE.MathUtils.lerp(68, 59, ads); this.viewCamera.updateProjectionMatrix();
  }

  private updateAtmosphere(): void {
    const hour = this.preview ? 9.5 : this.snapshot?.dayTime ?? 9.5;
    const daylight = THREE.MathUtils.clamp(Math.sin((hour - 6) / 24 * TAU) * 1.4, 0, 1);
    this.skyColor.copy(this.skyNight).lerp(this.skyDay, daylight);
    (this.scene.fog as THREE.Fog).color.copy(this.skyColor);
    this.sun.intensity = .55 + daylight * 2.1;
    this.hemisphere.intensity = 1.25 + daylight * .9;
    this.renderer.toneMappingExposure = .98 + daylight * .15;
  }

  private handleEvent(event: GameEvent, next?: GameEvent): void {
    if (event.type === 'shot') {
      if (event.actorId === this.playerId) this.shotAt = this.time;
      if (event.weapon === 'axe') return;
      const shooter = this.snapshot?.players.find(p => p.id === event.actorId); if (!shooter) return;
      const start = new THREE.Vector3(event.x, event.y ?? 1.65, event.z);
      this.direction.set(-Math.sin(shooter.yaw)*Math.cos(shooter.pitch), Math.sin(shooter.pitch), -Math.cos(shooter.yaw)*Math.cos(shooter.pitch));
      const end = start.clone().addScaledVector(this.direction, 35);
      if (next && (next.type === 'hit' || next.type === 'kill') && next.actorId === event.actorId) end.set(next.x, next.y ?? 1, next.z);
      start.addScaledVector(this.direction, .65); start.y -= .09;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, end]), new THREE.LineBasicMaterial({ color: '#ffe5a4', transparent: true, opacity: .55, depthWrite: false }));
      this.scene.add(line); this.tracers.push({ line, life: .065 });
    } else if (event.type === 'hit' || event.type === 'kill' || event.type === 'hurt') {
      const node = event.targetId && (event.targetId.startsWith('tree-') || event.targetId.startsWith('rock-') || event.targetId.startsWith('salvage-'));
      if (node) this.burst(event, event.targetId!.startsWith('tree-') ? 'wood' : 'stone', 11);
      else if (this.blood) {
        this.burst(event, 'blood', event.type === 'kill' ? 18 : 9);
        if (event.type === 'kill') {
          const mesh = new THREE.Mesh(this.splatGeometry, this.splatMaterial); mesh.rotation.x = -Math.PI/2; mesh.rotation.z = event.id; mesh.position.set(event.x, .052, event.z); mesh.scale.set(1.7,1.2,1); this.scene.add(mesh); this.splats.push({ mesh, life: 18 });
        }
      }
    } else if (event.type === 'pickup' || event.type === 'build') this.burst(event, 'gold', 7);
  }

  private burst(event: GameEvent, kind: keyof TurnedRenderer['particleMaterials'], count: number): void {
    for (let i = 0; i < count && this.particles.length < 200; i++) {
      const mesh = new THREE.Mesh(this.particleGeometry, this.particleMaterials[kind]);
      mesh.position.set(event.x, event.y ?? .8, event.z);
      const angle = i * 2.39996 + event.id * .7, speed = 1 + (i % 4)*.65;
      this.scene.add(mesh); this.particles.push({ mesh, velocity: new THREE.Vector3(Math.sin(angle)*speed, 1.2+(i%3)*.8, Math.cos(angle)*speed), life: .45+(i%4)*.1, duration: .8, blood: kind === 'blood' });
    }
  }
  private updateEffects(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]; p.life -= dt;
      if (p.life <= 0) { this.scene.remove(p.mesh); this.particles.splice(i,1); continue; }
      p.velocity.y -= dt*8; p.mesh.position.addScaledVector(p.velocity,dt); p.mesh.position.y = Math.max(.05,p.mesh.position.y); p.mesh.rotation.x += dt*4; p.mesh.rotation.z += dt*7; p.mesh.scale.setScalar(Math.min(1,p.life*6));
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i]; tracer.life -= dt;
      if (tracer.life <= 0) { this.scene.remove(tracer.line); tracer.line.geometry.dispose(); (tracer.line.material as THREE.Material).dispose(); this.tracers.splice(i,1); }
    }
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const splat = this.splats[i]; splat.life -= dt;
      if (splat.life <= 0 || this.splats.length > 18) { this.scene.remove(splat.mesh); this.splats.splice(i,1); }
      else if (splat.life < 2) splat.mesh.scale.multiplyScalar(Math.exp(-dt*1.8));
    }
  }
  private applyBloodSetting(root: THREE.Object3D): void { root.traverse(object => { if (object.userData.blood) object.visible = this.blood; }); }
  private disposeObject(root: THREE.Object3D): void {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
  }
}
