import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { t } from "./i18n";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Narration } from "./activity-copy";
import type { PulseStatus } from "./agentPulse";
import type { RaceStatus } from "./race";
import { formatMinutes, LIGHTING, MAX_HURDLES, type Celebration, type Daypart } from "./raceInsights";

export type RaceLane = {
  id: string;
  name: string;
  model: string | null;
  color: string;
  status: RaceStatus;
  progress: number;
  cue: "leap" | "fall" | "finish";
  /** Event id of the latest event when it just arrived live; drives one-shot animations. */
  cueKey: string | null;
  /** What the agent is doing now, shown in a speech bubble above its runner. */
  bubble?: Narration | null;
  /** Agent status: decides what the runner does (run, circle, wave, sit, stoop). */
  mood: PulseStatus;
  /** Clicking the runner focuses it (the camera comes close and a card opens). */
  onSelect?: () => void;
  /** Colour of the cap: the family of the model in use (grey when unknown). */
  capColor: string;
  statusLabel: string;
  /** Work span of the latest session, in minutes, and the laps (30 minutes each) it makes. */
  sessionMinutes: number;
  laps: number;
  /** Estimated USD cost of the session, when known. */
  cost: number | null;
  /** Where on the track (0..100) a tool failed during the turn in progress: a hurdle stays on each spot. */
  hurdleMarks: number[];
  celebration: Celebration;
  focused: boolean;
};

const NEEDS_YOU: PulseStatus[] = ["looping", "blocked", "stalled", "waiting"];
const MOOD_ICONS: Partial<Record<PulseStatus, { symbol: string; color: string }>> = {
  looping: { symbol: "↻", color: "#ff8f5a" },
  blocked: { symbol: "!", color: "#e5484d" },
  stalled: { symbol: "…", color: "#8a93a3" },
  waiting: { symbol: "?", color: "#6f83ff" }
};

const START_X = -9;
const FINISH_X = 9;
const LANE_WIDTH = 1.15;
const HIP_HEIGHT = 0.56;
const RUNNER_SCALE = 1.3;
const CONFETTI_COUNT = 28;
const CONFETTI_COLORS = ["#ff6b6b", "#ffd166", "#06d6a0", "#4cc9f0", "#b388ff", "#ff9f1c"];
const CROWD_COLORS = ["#ef476f", "#ffd166", "#06d6a0", "#118ab2", "#f78c6b", "#c77dff", "#f4f1de"];
const SHORTS = "#2f3542";
const HILLS: Array<[number, number, number, string]> = [
  [-20, -22, 7, "#6cbf73"],
  [-6, -26, 9, "#5aae69"],
  [10, -23, 7.5, "#74c47a"],
  [25, -25, 8, "#62b46e"]
];
const CAMERA_DIRECTION = new THREE.Vector3(0, 0.46, 1).normalize();

function laneZ(index: number, count: number) {
  return (index - (count - 1) / 2) * LANE_WIDTH;
}

function progressToX(progress: number) {
  return START_X + ((FINISH_X - START_X) * progress) / 100;
}

/** Deterministic pseudo-random so the stadium layout is stable between renders. */
function seeded(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

/** How much the race may ask of the computer. "auto" suits most; "light" is for weak graphics. */
export type RaceQuality = "light" | "auto" | "smooth";
const QUALITY: Record<RaceQuality, { fps: number; pixels: number; dprMax: number }> = {
  light: { fps: 20, pixels: 0.4e6, dprMax: 1 },
  auto: { fps: 30, pixels: 0.9e6, dprMax: 1.25 },
  smooth: { fps: 60, pixels: 2.2e6, dprMax: 2 }
};

const easeOut = (k: number) => 1 - (1 - k) ** 3;
const easeIn = (k: number) => k * k;

/** Soft, cheap shading: no shadow maps, no specular. Rounded shapes do the rest. */
function Low({ color, emissive }: { color: string; emissive?: string }) {
  return <meshLambertMaterial color={color} emissive={emissive} emissiveIntensity={emissive ? 0.2 : 0} />;
}

/**
 * Keeps the race cheap: it draws at a resolution that fits a pixel budget (not the full size of a
 * big or high-density screen), at a capped frame rate, and not at all while the window is hidden.
 */
function Governor({ quality }: { quality: RaceQuality }) {
  const { size, setDpr, invalidate } = useThree();
  const budget = QUALITY[quality];
  useEffect(() => {
    const device = window.devicePixelRatio || 1;
    const fit = Math.sqrt(budget.pixels / Math.max(1, size.width * size.height));
    setDpr(Math.max(0.5, Math.min(device, budget.dprMax, fit)));
  }, [size.width, size.height, budget, setDpr]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) invalidate(); }, 1000 / budget.fps);
    return () => window.clearInterval(timer);
  }, [budget, invalidate]);
  return null;
}

/** Colours and transforms for instanced meshes (one draw call for many objects). */
function useInstances(items: Array<{ position: [number, number, number]; scale?: [number, number, number]; color: string }>) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const instances = mesh.current;
    if (!instances) return;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    items.forEach((item, index) => {
      matrix.compose(new THREE.Vector3(...item.position), new THREE.Quaternion(), new THREE.Vector3(...(item.scale ?? [1, 1, 1])));
      instances.setMatrixAt(index, matrix);
      instances.setColorAt(index, color.set(item.color));
    });
    instances.instanceMatrix.needsUpdate = true;
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
  }, [items]);
  return mesh;
}

export default function SprintTrack3D({ lanes, reducedMotion, quality = "auto", daypart, focusId, onBlur }: { lanes: RaceLane[]; reducedMotion: boolean; quality?: RaceQuality; daypart: Daypart; focusId: string | null; onBlur: () => void }) {
  const active = lanes.filter((lane) => lane.status === "running" || lane.status === "recent");
  const bubbleRows = assignBubbleRows(lanes);
  // The camera drifts a little towards the leader; when an agent starts needing you it leans in
  // for a few seconds, and when you focus a runner it comes close to it.
  const needy = lanes.find((lane) => NEEDS_YOU.includes(lane.mood));
  const leaderX = active.length ? progressToX(Math.max(...active.map((lane) => lane.progress))) : 0;
  const focusIndex = focusId ? lanes.findIndex((lane) => lane.id === focusId) : -1;
  const focus = focusIndex >= 0 ? { x: progressToX(lanes[focusIndex].progress), z: laneZ(focusIndex, lanes.length) } : null;
  const light = LIGHTING[daypart];
  return (
    <Canvas
      className="sprint-canvas"
      flat
      frameloop="demand"
      dpr={1}
      camera={{ fov: 30, position: [0, 7, 12], near: 0.1, far: 140 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      onPointerMissed={onBlur}
      aria-label={t("Piste 3D de la course des agents", "3D track of the agents’ race")}
    >
      <Governor quality={quality} />
      <CameraRig leaderX={leaderX} reducedMotion={reducedMotion} spotlight={needy ? { key: `${needy.id}:${needy.mood}`, x: progressToX(needy.progress) } : null} focus={focus} />
      <hemisphereLight args={[light.hemiSky, light.hemiGround, light.hemi]} />
      <directionalLight position={[-7, 13, 9]} intensity={light.sunIntensity} color={light.sun} />
      <Stadium lanes={lanes} excitement={active.length} reducedMotion={reducedMotion} daypart={daypart} />
      <Scoreboard lanes={lanes} />
      <Hurdles lanes={lanes} />
      <LapFlags lanes={lanes} />
      {lanes.map((lane, index) => (
        <Runner key={lane.id} lane={lane} z={laneZ(index, lanes.length)} bubbleRow={bubbleRows.get(lane.id) ?? 0} renderOrder={index} reducedMotion={reducedMotion} />
      ))}
    </Canvas>
  );
}

/**
 * Bubble rows: a bubble goes to the lowest row with no other bubble overlapping it along the track.
 * Nearest lanes are placed first, so farther lanes (already higher on screen) take the upper rows.
 */
function assignBubbleRows(lanes: RaceLane[]) {
  const placed: Array<{ center: number; row: number }> = [];
  const rows = new Map<string, number>();
  for (const lane of [...lanes].reverse().filter((candidate) => candidate.bubble)) {
    const center = lane.progress + (bubbleFlipped(lane.progress) ? -9 : 9);
    let row = 0;
    while (row < 2 && placed.some((other) => other.row === row && Math.abs(other.center - center) < 32)) row += 1;
    placed.push({ center, row });
    rows.set(lane.id, row);
  }
  return rows;
}

/** Near the finish the bubble opens to the left of the runner so it stays inside the stage. */
const bubbleFlipped = (progress: number) => progress > 60;

const SPOTLIGHT_SECONDS = 5;

function CameraRig({ leaderX, reducedMotion, spotlight, focus }: { leaderX: number; reducedMotion: boolean; spotlight: { key: string; x: number } | null; focus: { x: number; z: number } | null }) {
  const { camera, size } = useThree();
  const target = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3(0, 1.35, -0.5));
  const zoom = useRef(1);
  const lean = useRef({ key: null as string | null, until: 0 });
  useFrame((state, delta) => {
    const perspective = camera as THREE.PerspectiveCamera;
    const time = state.clock.elapsedTime;
    const aspect = size.width / Math.max(1, size.height);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2));
    // Keep the whole 100 m (plus margins) in frame whatever the panel width.
    // Wide and short stages (the race takes at most half the window) need the height to fit too.
    const wide = Math.max(11, 14.2 / (tanHalf * aspect), 9.2 / (2 * tanHalf));
    const sway = reducedMotion ? 0 : Math.sin(time * 0.15) * 0.3;
    // A runner that starts needing you gets a few seconds of attention, then the wide shot returns.
    if ((spotlight?.key ?? null) !== lean.current.key) {
      lean.current = { key: spotlight?.key ?? null, until: spotlight ? time + SPOTLIGHT_SECONDS : 0 };
    }
    const leaning = Boolean(spotlight) && time < lean.current.until && !focus;
    // Almost centred in the wide shot: a strong drift towards the leader pushed the start line out of the frame.
    let lookX = leaderX * 0.03 + sway;
    let lookZ = -0.5;
    let lookY = 1.35;
    let wanted = 1;
    if (focus) {
      lookX = focus.x;
      lookZ = focus.z;
      lookY = 0.95;
      wanted = 0.42;
    } else if (leaning && spotlight) {
      lookX = THREE.MathUtils.clamp(spotlight.x * 0.4, -4, 4);
      wanted = 0.86;
    }
    const blend = reducedMotion ? 1 : 1 - Math.exp(-Math.min(delta, 0.05) * 2);
    zoom.current += (wanted - zoom.current) * blend;
    const distance = Math.max(5.5, wide * zoom.current);
    target.current.copy(CAMERA_DIRECTION).multiplyScalar(distance);
    target.current.x += lookX;
    target.current.z += lookZ;
    perspective.position.lerp(target.current, blend);
    look.current.x += (lookX - look.current.x) * blend;
    look.current.y += (lookY - look.current.y) * blend;
    look.current.z += (lookZ - look.current.z) * blend;
    perspective.lookAt(look.current);
  });
  return null;
}

/** A flat rounded rectangle on the ground. */
function roundedRect(halfX: number, halfZ: number, radius: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-halfX + radius, -halfZ);
  shape.lineTo(halfX - radius, -halfZ);
  shape.absarc(halfX - radius, -halfZ + radius, radius, -Math.PI / 2, 0, false);
  shape.lineTo(halfX, halfZ - radius);
  shape.absarc(halfX - radius, halfZ - radius, radius, 0, Math.PI / 2, false);
  shape.lineTo(-halfX + radius, halfZ);
  shape.absarc(-halfX + radius, halfZ - radius, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(-halfX, -halfZ + radius);
  shape.absarc(-halfX + radius, -halfZ + radius, radius, Math.PI, Math.PI * 1.5, false);
  return new THREE.ShapeGeometry(shape, 12);
}

/** The finish line: a small chequered strip, one texture instead of dozens of tiles. */
function useChecker(rows: number) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = rows * 16;
    const context = canvas.getContext("2d");
    if (context) {
      for (let row = 0; row < rows; row += 1) for (let column = 0; column < 2; column += 1) {
        context.fillStyle = (row + column) % 2 ? "#232a38" : "#fbfbfb";
        context.fillRect(column * 16, row * 16, 16, 16);
      }
    }
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    result.magFilter = THREE.NearestFilter;
    result.minFilter = THREE.NearestFilter;
    result.generateMipmaps = false;
    return result;
  }, [rows]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

/** The stands are arcs of a huge circle, so they bend gently around the track. */
const STAND_RADIUS = 60;
const STAND_FRONT = -4.3;
const STAND_HALF_ANGLE = 0.2;
const STAND_CENTER_Z = STAND_RADIUS + STAND_FRONT;
const STAND_ROW_GAP = 0.7;

function Stadium({ lanes, excitement, reducedMotion, daypart }: { lanes: RaceLane[]; excitement: number; reducedMotion: boolean; daypart: Daypart }) {
  const count = lanes.length;
  const halfWidth = (count * LANE_WIDTH) / 2;
  const trackLength = FINISH_X - START_X + 5;
  const checker = useChecker(Math.max(2, Math.round((halfWidth * 2) / 0.19)));
  const track = useMemo(() => roundedRect(trackLength / 2, halfWidth + 0.25, 1.0), [trackLength, halfWidth]);
  useEffect(() => () => track.dispose(), [track]);
  const treeItems = useMemo(() => Array.from({ length: 22 }, (_, index) => {
    const side = index % 2 ? 1 : -1;
    const backdrop = index > 11;
    return {
      x: backdrop ? -24 + index * 3.6 + seeded(index) * 1.5 : side * (13 + seeded(index) * 5),
      z: backdrop ? -10 - seeded(index + 40) * 4 : -3 + seeded(index + 20) * 8,
      scale: 0.8 + seeded(index + 60) * 0.7,
      color: ["#2f9e5b", "#3fb06a", "#58b368", "#2b8a57"][index % 4]
    };
  }), []);
  // Trunks, lower and upper tufts: three draw calls for every tree.
  const trunks = useInstances(treeItems.map((tree) => ({ position: [tree.x, 0.32 * tree.scale, tree.z], scale: [tree.scale, tree.scale, tree.scale], color: "#9a6a47" })));
  const tufts = useInstances(treeItems.map((tree) => ({ position: [tree.x, 0.95 * tree.scale, tree.z], scale: [tree.scale, tree.scale, tree.scale], color: tree.color })));
  const crowns = useInstances(treeItems.map((tree) => ({ position: [tree.x, 1.5 * tree.scale, tree.z], scale: [0.78 * tree.scale, 0.78 * tree.scale, 0.78 * tree.scale], color: tree.color })));
  const laneLines = useMemo(() => Array.from({ length: count + 1 }, (_, index) => -halfWidth + index * LANE_WIDTH), [count, halfWidth]);

  return (
    <group>
      {/* A round island of meadow with concentric mowing stripes and soft soil sides */}
      <mesh position={[0, -1.3, 2]}>
        <cylinderGeometry args={[26.4, 24.5, 2.2, 80]} />
        <Low color="#c99a6e" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 2]}>
        <circleGeometry args={[26.4, 80]} />
        <Low color="#7ccb6e" />
      </mesh>
      {[8, 16].map((inner) => (
        <mesh key={inner} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.07, 2]}>
          <ringGeometry args={[inner, inner + 4, 80]} />
          <Low color="#8bd27c" />
        </mesh>
      ))}

      {/* Track: a rounded lane with rounded lines */}
      <mesh geometry={track} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
        <Low color="#e8836a" />
      </mesh>
      {laneLines.map((z) => (
        <mesh key={z} rotation={[0, 0, Math.PI / 2]} position={[0, 0.004, z]}>
          <capsuleGeometry args={[0.018, trackLength - 2.6, 4, 8]} />
          <Low color="#fff6ee" />
        </mesh>
      ))}
      {[25, 50, 75].map((mark) => (
        <mesh key={mark} rotation={[Math.PI / 2, 0, 0]} position={[progressToX(mark), 0.003, 0]}>
          <capsuleGeometry args={[0.022, halfWidth * 2 - 0.3, 4, 8]} />
          <Low color="#f6bba7" />
        </mesh>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[START_X, 0.004, 0]}>
        <capsuleGeometry args={[0.04, halfWidth * 2 - 0.2, 4, 8]} />
        <Low color="#ffffff" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[FINISH_X + 0.19, 0.006, 0]}>
        <planeGeometry args={[0.38, halfWidth * 2]} />
        <meshBasicMaterial map={checker} />
      </mesh>

      {/* Starting pads in each provider colour: little soft domes */}
      {lanes.map((lane, index) => (
        <mesh key={lane.id} position={[START_X - 0.45, 0.02, laneZ(index, count)]} scale={[0.17, 0.09, 0.22]}>
          <sphereGeometry args={[1, 16, 10]} />
          <Low color={lane.color} />
        </mesh>
      ))}

      {/* Finish arch: one smooth rainbow */}
      <group position={[FINISH_X + 0.2, 0, 0]} rotation={[0, Math.PI / 2, 0]} scale={[1, 0.72, 1]}>
        <mesh>
          <torusGeometry args={[halfWidth + 0.5, 0.1, 14, 56, Math.PI]} />
          <Low color="#ff7a99" />
        </mesh>
        <mesh scale={[0.93, 0.93, 1]}>
          <torusGeometry args={[halfWidth + 0.5, 0.07, 12, 56, Math.PI]} />
          <Low color="#ffd166" />
        </mesh>
      </group>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[FINISH_X + 0.2, 0.06, side * (halfWidth + 0.5)]}>
          <sphereGeometry args={[0.17, 14, 10]} />
          <Low color="#ffd166" />
        </mesh>
      ))}

      <Crowd excitement={excitement} reducedMotion={reducedMotion} />

      <instancedMesh ref={trunks} args={[undefined, undefined, treeItems.length]}>
        <capsuleGeometry args={[0.1, 0.4, 4, 8]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={tufts} args={[undefined, undefined, treeItems.length]}>
        <sphereGeometry args={[0.62, 16, 12]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[undefined, undefined, treeItems.length]}>
        <sphereGeometry args={[0.62, 16, 12]} />
        <meshLambertMaterial />
      </instancedMesh>

      {/* Distant hills and sun: smooth domes */}
      {HILLS.map(([x, z, radius, color], index) => (
        <mesh key={index} position={[x, -radius * 0.5, z]} scale={[1.7, 0.55, 1]}>
          <sphereGeometry args={[radius, 28, 16]} />
          <Low color={color} />
        </mesh>
      ))}
      <Sky daypart={daypart} />
      <Floodlights on={LIGHTING[daypart].floodlights} />
      <Clouds reducedMotion={reducedMotion} tint={CLOUD_TINT[daypart]} />
    </group>
  );
}

function Crowd({ excitement, reducedMotion }: { excitement: number; reducedMotion: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const seats = useMemo(() => {
    const result: Array<{ x: number; y: number; z: number; phase: number }> = [];
    for (let row = 0; row < 3; row += 1) {
      const radius = STAND_RADIUS + row * STAND_ROW_GAP;
      for (let column = 0; column < 46; column += 1) {
        if (seeded(row * 100 + column) < 0.18) continue;
        const angle = (column / 45 - 0.5) * 2 * (STAND_HALF_ANGLE - 0.012);
        result.push({ x: radius * Math.sin(angle), y: 0.5 + row * 0.5 + 0.2, z: STAND_CENTER_Z - radius * Math.cos(angle), phase: seeded(column + row * 7) * Math.PI * 2 });
      }
    }
    return result;
  }, []);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const energy = useRef(0);
  useLayoutEffect(() => {
    const instances = mesh.current;
    if (!instances) return;
    const color = new THREE.Color();
    seats.forEach((seat, index) => {
      instances.setColorAt(index, color.set(CROWD_COLORS[index % CROWD_COLORS.length]));
      instances.setMatrixAt(index, matrix.makeTranslation(seat.x, seat.y, seat.z));
    });
    instances.instanceMatrix.needsUpdate = true;
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
  }, [seats, matrix]);
  useFrame((state, delta) => {
    const instances = mesh.current;
    if (!instances || reducedMotion) return;
    energy.current += (Math.min(excitement, 3) / 3 - energy.current) * (1 - Math.exp(-Math.min(delta, 0.05) * 1.5));
    const time = state.clock.elapsedTime;
    const amplitude = 0.025 + energy.current * 0.16;
    seats.forEach((seat, index) => {
      const bounce = Math.max(0, Math.sin(time * (3 + energy.current * 5) + seat.phase)) * amplitude;
      instances.setMatrixAt(index, matrix.makeTranslation(seat.x, seat.y + bounce, seat.z));
    });
    instances.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      {[0, 1, 2].map((row) => {
        const radius = STAND_RADIUS + row * STAND_ROW_GAP;
        const height = 0.5 + row * 0.5;
        return <group key={row} position={[0, 0, STAND_CENTER_Z]}>
          <mesh position={[0, height / 2, 0]}>
            <cylinderGeometry args={[radius + 0.32, radius + 0.32, height, 96, 1, true, Math.PI - STAND_HALF_ANGLE, STAND_HALF_ANGLE * 2]} />
            <meshLambertMaterial color={["#8c9bd6", "#7a8ac7", "#6b7bb7"][row]} side={THREE.DoubleSide} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, height, 0]}>
            <ringGeometry args={[radius - 0.38, radius + 0.32, 96, 1, Math.PI / 2 - STAND_HALF_ANGLE, STAND_HALF_ANGLE * 2]} />
            <meshLambertMaterial color={["#a3b0e2", "#919fd5", "#8190c6"][row]} side={THREE.DoubleSide} />
          </mesh>
        </group>;
      })}
      <instancedMesh ref={mesh} args={[undefined, undefined, seats.length]}>
        <capsuleGeometry args={[0.12, 0.12, 4, 10]} />
        <meshLambertMaterial />
      </instancedMesh>
    </group>
  );
}

const CLOUD_TINT: Record<Daypart, string> = { day: "#ffffff", dawn: "#ffe3d0", dusk: "#f0b8c0", night: "#4a5580" };

function Clouds({ reducedMotion, tint }: { reducedMotion: boolean; tint: string }) {
  const group = useRef<THREE.Group>(null);
  const clouds = useMemo(
    () => Array.from({ length: 5 }, (_, index) => ({ x: -30 + index * 14, y: 7 + seeded(index + 3) * 3, z: -24 - seeded(index + 9) * 6, scale: 0.8 + seeded(index + 5) * 0.8 })),
    []
  );
  useFrame((_, delta) => {
    if (!group.current || reducedMotion) return;
    for (const child of group.current.children) {
      child.position.x += Math.min(delta, 0.05) * 0.35;
      if (child.position.x > 38) child.position.x = -38;
    }
  });
  return (
    <group ref={group}>
      {clouds.map((cloud, index) => (
        <group key={index} position={[cloud.x, cloud.y, cloud.z]} scale={cloud.scale}>
          {[[-1, 0, 0.9], [0, 0.35, 1.25], [1.1, 0, 0.85], [0.35, -0.2, 0.9]].map(([x, y, radius], part) => (
            <mesh key={part} position={[x, y, 0]}>
              <sphereGeometry args={[radius, 14, 10]} />
              <meshBasicMaterial color={tint} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------------------------

const STARS = Array.from({ length: 48 }, (_, index) => ({ position: [-34 + seeded(index + 70) * 68, 3.5 + seeded(index + 130) * 5, -31] as [number, number, number], scale: [1, 1, 1] as [number, number, number], color: "#ffffff" }));

/** The sun by day, a moon and stars by night; the sky colour itself is the stage's CSS gradient. */
function Sky({ daypart }: { daypart: Daypart }) {
  const light = LIGHTING[daypart];
  const stars = useInstances(STARS);
  return (
    <group>
      {!light.moon && (
        <mesh position={[-15, daypart === "day" ? 5.5 : 2.8, -30]}>
          <sphereGeometry args={[2.2, 20, 14]} />
          <meshBasicMaterial color={daypart === "day" ? "#ffd66b" : daypart === "dawn" ? "#ffb26b" : "#ff8f6b"} />
        </mesh>
      )}
      {light.moon && (
        <group position={[-15, 5.2, -30]}>
          <mesh>
            <sphereGeometry args={[1.7, 20, 14]} />
            <meshBasicMaterial color="#f3f1e6" />
          </mesh>
          <mesh position={[0.55, 0.3, 0.2]}>
            <sphereGeometry args={[1.5, 20, 14]} />
            <meshBasicMaterial color="#16204a" />
          </mesh>
        </group>
      )}
      <instancedMesh ref={stars} args={[undefined, undefined, STARS.length]} visible={light.stars}>
        <sphereGeometry args={[0.09, 6, 5]} />
        <meshBasicMaterial />
      </instancedMesh>
    </group>
  );
}

/** A soft radial glow, drawn once. */
function useGlow() {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, "rgba(255,244,200,1)");
      gradient.addColorStop(0.35, "rgba(255,226,150,0.45)");
      gradient.addColorStop(1, "rgba(255,226,150,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
    }
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    result.generateMipmaps = false;
    return result;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

/** Four poles at the ends of the stands; their lamps are lit from dusk. No real light: a glow is enough. */
function Floodlights({ on }: { on: boolean }) {
  const glow = useGlow();
  if (!on) return null;
  return (
    <group>
      {[-11.5, -4, 4, 11.5].map((x) => (
        <group key={x} position={[x, 0, -6.2]}>
          <mesh position={[0, 2.1, 0]}>
            <capsuleGeometry args={[0.07, 4, 4, 8]} />
            <meshLambertMaterial color="#9aa3b8" />
          </mesh>
          <mesh position={[0, 4.35, 0.1]} scale={[1, 0.55, 0.5]}>
            <sphereGeometry args={[0.42, 14, 10]} />
            <meshBasicMaterial color="#fff2c4" />
          </mesh>
          <sprite position={[0, 4.35, 0.25]} scale={[3.4, 3.4, 1]}>
            <spriteMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
          </sprite>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Scoreboard
// ---------------------------------------------------------------------------------------------

const BOARD_WIDTH = 8.2;
const BOARD_ROW = 62;
const BOARD_HEAD = 56;
const BOARD_COLUMN = 512;

/**
 * The big screen above the stands: who is who, in what state, for how long. Wide and short (two
 * columns past three agents) so it fits the half-height stage, and it never hides behind a runner.
 */
function Scoreboard({ lanes }: { lanes: RaceLane[] }) {
  const rows = lanes.slice(0, 8);
  const columns = rows.length > 3 ? 2 : 1;
  const perColumn = Math.ceil(rows.length / columns);
  const signature = JSON.stringify(rows.map((lane) => [lane.name, lane.statusLabel, lane.sessionMinutes, lane.laps, lane.color, lane.capColor, NEEDS_YOU.includes(lane.mood)]));
  const width = columns * BOARD_COLUMN;
  const height = BOARD_HEAD + perColumn * BOARD_ROW + 12;
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "rgba(12, 16, 26, 0.9)";
      context.beginPath();
      context.roundRect(4, 4, width - 8, height - 8, 32);
      context.fill();
      context.lineWidth = 5;
      context.strokeStyle = "#3a4560";
      context.stroke();
      context.textBaseline = "middle";
      context.fillStyle = "#8fa0c4";
      context.font = "700 24px ui-monospace, Menlo, monospace";
      context.fillText(t("AGENTS  ·  ÉTAT  ·  TEMPS DE SESSION", "AGENTS  ·  STATE  ·  SESSION TIME"), 40, 32);
      rows.forEach((lane, index) => {
        const left = Math.floor(index / perColumn) * BOARD_COLUMN;
        const y = BOARD_HEAD + (index % perColumn) * BOARD_ROW + BOARD_ROW / 2;
        const needs = NEEDS_YOU.includes(lane.mood);
        context.fillStyle = lane.color;
        context.beginPath();
        context.arc(left + 50, y, 15, 0, Math.PI * 2);
        context.fill();
        // The cap colour of the runner: the family of its model.
        context.fillStyle = lane.capColor;
        context.beginPath();
        context.arc(left + 50, y, 7, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#f2f4f8";
        context.font = "700 32px system-ui, sans-serif";
        context.fillText(lane.name, left + 80, y - 11);
        context.fillStyle = needs ? "#ffb454" : "#9fabc6";
        context.font = "600 24px system-ui, sans-serif";
        context.fillText(lane.statusLabel, left + 80, y + 18);
        context.textAlign = "right";
        context.fillStyle = "#f2f4f8";
        context.font = "600 30px system-ui, sans-serif";
        context.fillText(lane.sessionMinutes ? formatMinutes(lane.sessionMinutes) : "—", left + BOARD_COLUMN - 36, y - 11);
        if (lane.laps) {
          context.fillStyle = "#9fabc6";
          context.font = "600 22px system-ui, sans-serif";
          context.fillText(`${lane.laps} ${lane.laps > 1 ? t("tours", "laps") : t("tour", "lap")}`, left + BOARD_COLUMN - 36, y + 18);
        }
        context.textAlign = "left";
      });
    }
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    result.generateMipmaps = false;
    result.minFilter = THREE.LinearFilter;
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, width, height]);
  useEffect(() => () => texture.dispose(), [texture]);
  if (!rows.length) return null;
  const boardHeight = (BOARD_WIDTH * height) / width;
  return (
    <group position={[0, 1.8 + boardHeight / 2, -7.2]}>
      <mesh>
        <planeGeometry args={[BOARD_WIDTH, boardHeight]} />
        <meshBasicMaterial map={texture} transparent />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (BOARD_WIDTH / 2 - 0.6), -boardHeight / 2 - 0.4, -0.05]}>
          <capsuleGeometry args={[0.07, 0.8, 4, 8]} />
          <meshLambertMaterial color="#6b7590" />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Hurdles (failures of the turn in progress) and lap flags (session time)
// ---------------------------------------------------------------------------------------------

/** Instanced meshes whose number of instances changes: `capacity` is the most they can hold. */
function useCounted(items: Array<{ position: [number, number, number]; scale?: [number, number, number]; color: string }>, capacity: number) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const instances = mesh.current;
    if (!instances) return;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    const shown = Math.min(items.length, capacity);
    items.slice(0, shown).forEach((item, index) => {
      matrix.compose(new THREE.Vector3(...item.position), new THREE.Quaternion(), new THREE.Vector3(...(item.scale ?? [1, 1, 1])));
      instances.setMatrixAt(index, matrix);
      instances.setColorAt(index, color.set(item.color));
    });
    instances.count = shown;
    instances.instanceMatrix.needsUpdate = true;
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
  }, [items, capacity]);
  return mesh;
}

type Item = { position: [number, number, number]; scale?: [number, number, number]; color: string };

/**
 * A hurdle stays on the spot of each tool failure of the turn in progress (the runner has gone past
 * it, or tripped on it); a blocked agent has a wall of two bars. When the turn ends they go.
 */
function Hurdles({ lanes }: { lanes: RaceLane[] }) {
  const capacity = Math.max(1, lanes.length * MAX_HURDLES * 2);
  const bar = useMemo(() => new THREE.CapsuleGeometry(0.05, 0.62, 4, 10).rotateX(Math.PI / 2), []);
  const post = useMemo(() => new THREE.CapsuleGeometry(0.04, 0.3, 4, 8), []);
  useEffect(() => () => { bar.dispose(); post.dispose(); }, [bar, post]);
  const bars: Item[] = [];
  const posts: Item[] = [];
  lanes.forEach((lane, index) => {
    const z = laneZ(index, lanes.length);
    const wall = lane.mood === "blocked";
    for (const mark of lane.hurdleMarks) {
      const x = progressToX(mark);
      [0.38, ...(wall ? [0.66] : [])].forEach((y) => bars.push({ position: [x, y, z], color: "#ff5d5d" }));
      [-1, 1].forEach((side) => posts.push({ position: [x, wall ? 0.34 : 0.2, z + side * 0.37], scale: [1, wall ? 1.8 : 1, 1], color: "#ffffff" }));
    }
  });
  const barMesh = useCounted(bars, capacity);
  const postMesh = useCounted(posts, capacity);
  return (
    <group>
      <instancedMesh key={`b${capacity}`} ref={barMesh} args={[bar, undefined, capacity]}>
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh key={`p${capacity}`} ref={postMesh} args={[post, undefined, capacity]}>
        <meshLambertMaterial />
      </instancedMesh>
    </group>
  );
}

const MAX_FLAGS = 6;

/** A small flag planted behind the start line for every 30 minutes a session has lasted. */
function LapFlags({ lanes }: { lanes: RaceLane[] }) {
  const capacity = Math.max(1, lanes.length * MAX_FLAGS);
  const poles: Item[] = [];
  const flags: Item[] = [];
  lanes.forEach((lane, index) => {
    const z = laneZ(index, lanes.length);
    for (let k = 0; k < Math.min(MAX_FLAGS, lane.laps); k += 1) {
      const x = START_X - 0.95 - k * 0.24;
      poles.push({ position: [x, 0.34, z - 0.36], scale: [1.4, 1.5, 1.4], color: "#e9edf5" });
      flags.push({ position: [x + 0.16, 0.6, z - 0.36], scale: [1.35, 0.85, 0.3], color: lane.color });
    }
  });
  const poleMesh = useCounted(poles, capacity);
  const flagMesh = useCounted(flags, capacity);
  return (
    <group>
      <instancedMesh key={`p${capacity}`} ref={poleMesh} args={[undefined, undefined, capacity]}>
        <capsuleGeometry args={[0.012, 0.4, 4, 6]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh key={`f${capacity}`} ref={flagMesh} args={[undefined, undefined, capacity]}>
        <sphereGeometry args={[0.13, 10, 8]} />
        <meshLambertMaterial />
      </instancedMesh>
    </group>
  );
}

type Action = { type: RaceLane["cue"]; startedAt: number };

function Runner({ lane, z, bubbleRow, renderOrder, reducedMotion }: { lane: RaceLane; z: number; bubbleRow: number; renderOrder: number; reducedMotion: boolean }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);
  const confetti = useRef<THREE.Group>(null);
  const sparks = useRef<THREE.Group>(null);
  const blob = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Group>(null);
  const loopRing = useRef<THREE.Mesh>(null);
  const motion = useRef({
    x: progressToX(lane.progress),
    phase: seeded(z + 4) * Math.PI * 2,
    stride: 0,
    seenCue: lane.cueKey,
    pendingCue: null as RaceLane["cue"] | null,
    action: null as Action | null,
    confettiAt: -10,
    sparksAt: -10,
    loopAngle: 0,
    heading: 0,
    velocities: Array.from({ length: CONFETTI_COUNT }, () => new THREE.Vector3()),
    sparkVelocities: Array.from({ length: SPARK_COUNT }, () => new THREE.Vector3())
  });
  const capColor = lane.capColor;

  useEffect(() => {
    const state = motion.current;
    if (!lane.cueKey || lane.cueKey === state.seenCue) return;
    state.seenCue = lane.cueKey;
    state.pendingCue = lane.cue;
  }, [lane.cueKey, lane.cue]);

  useFrame((frame, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const time = frame.clock.elapsedTime;
    const state = motion.current;
    if (!root.current || !body.current || !leftArm.current || !rightArm.current || !leftLeg.current || !rightLeg.current) return;

    if (state.pendingCue) {
      state.action = reducedMotion ? null : { type: state.pendingCue, startedAt: time };
      // Only a run of clean turns is celebrated: an ordinary turn just ends with a hop.
      if (state.pendingCue === "finish" && !reducedMotion && lane.celebration !== "none") launchConfetti(state, time, z, confetti.current);
      if (state.pendingCue === "finish" && !reducedMotion && lane.celebration === "fireworks") launchSparks(state, time, z, sparks.current);
      state.pendingCue = null;
    }

    const targetX = progressToX(lane.progress);
    state.x = reducedMotion ? targetX : state.x + (targetX - state.x) * (1 - Math.exp(-delta * 2.2));
    const mood = lane.mood;
    const looping = mood === "looping" && !reducedMotion;
    const halted = mood === "waiting" || mood === "stalled" || mood === "blocked";
    const moving = looping || (!halted && (lane.status === "running" || lane.status === "recent"));
    state.stride += ((moving ? 1 : 0) - state.stride) * (1 - Math.exp(-delta * 5));
    const amplitude = reducedMotion ? 0 : state.stride;
    state.phase += delta * (5 + 7 * amplitude);
    const swing = Math.sin(state.phase);

    let y = Math.abs(Math.cos(state.phase)) * 0.08 * amplitude;
    if (!moving && !reducedMotion) y += (Math.sin(time * 2.1 + z * 3) + 1) * 0.006;
    let tilt = 0;
    let lean = -0.2 * amplitude;
    let legSwing = swing * 0.85 * amplitude;
    let armSwing = swing * 0.9 * amplitude;
    let armsUp = lane.status === "finished" && !reducedMotion ? 0.85 : 0;

    const action = state.action;
    if (action) {
      const elapsed = time - action.startedAt;
      if (action.type === "leap" && elapsed < 0.6) {
        const k = elapsed / 0.6;
        y += Math.sin(Math.PI * k) * 0.55;
        legSwing = 0.75 * Math.sin(Math.PI * k);
        armSwing = -0.4;
        armsUp = Math.max(armsUp, 0.35 * Math.sin(Math.PI * k));
      } else if (action.type === "fall" && elapsed < 1.9) {
        // Trip forward, lie flat for a beat, then get back up.
        tilt = elapsed < 0.35 ? -1.45 * easeIn(elapsed / 0.35) : elapsed < 1.15 ? -1.45 + Math.sin((elapsed - 0.35) * 14) * 0.04 * (1.15 - elapsed) : -1.45 * (1 - easeOut((elapsed - 1.15) / 0.75));
        lean = 0;
        legSwing = elapsed < 1.15 ? -0.5 : 0;
        armSwing = elapsed < 1.15 ? 1.3 : 0;
        armsUp = 0;
      } else if (action.type === "finish" && elapsed < 1.5) {
        y += Math.abs(Math.sin((elapsed / 1.5) * Math.PI * 2)) * 0.45;
        armsUp = 1;
        legSwing = 0.3 * Math.sin(elapsed * 12);
      } else {
        state.action = null;
      }
    }

    // Going round in circles: the runner literally laps a small ring on its lane.
    let offsetX = 0;
    let offsetZ = 0;
    let heading = 0;
    if (looping) {
      state.loopAngle += delta * 3;
      offsetX = Math.cos(state.loopAngle) * 0.7;
      offsetZ = Math.sin(state.loopAngle) * 0.32;
      heading = Math.atan2(-Math.cos(state.loopAngle) * 0.32, -Math.sin(state.loopAngle) * 0.7);
    } else if (halted) {
      // Turn towards the viewer: it is you the agent is waiting for.
      heading = -Math.PI / 2;
    }
    state.heading += (heading - state.heading) * (1 - Math.exp(-delta * (looping ? 30 : 4)));
    if (mood === "stalled" && !reducedMotion) {
      y -= 0.24;
      legSwing = 1.35;
      lean = 0.25;
      armSwing = 0.2;
    } else if (mood === "blocked") {
      lean = -0.55;
      armSwing = 0.5;
    }

    root.current.position.set(state.x + offsetX, y, z + offsetZ);
    if (blob.current) {
      blob.current.position.set(state.x + offsetX, 0.012, z + offsetZ);
      const lift = 1 / (1 + y * 3);
      blob.current.scale.set(0.34 * RUNNER_SCALE * lift, 0.24 * RUNNER_SCALE * lift, 1);
    }
    // Spotlight on a runner that needs you or is focused, ring where it loops.
    if (beam.current) {
      const lit = NEEDS_YOU.includes(lane.mood) || lane.focused;
      beam.current.visible = lit;
      if (lit) {
        beam.current.position.set(state.x + offsetX, 0, z + offsetZ);
        const pulse = reducedMotion ? 1 : 1 + Math.sin(time * 3) * 0.06;
        beam.current.scale.set(pulse, 1, pulse);
      }
    }
    if (loopRing.current) {
      loopRing.current.visible = looping;
      loopRing.current.position.set(state.x, 0.035, z);
    }
    root.current.rotation.y = state.heading;
    root.current.rotation.z = tilt;
    body.current.rotation.z = lean;
    leftLeg.current.rotation.z = legSwing;
    rightLeg.current.rotation.z = -legSwing;
    const wave = armsUp ? Math.sin(time * 7 + z) * 0.18 : 0;
    leftArm.current.rotation.z = armSwing * (1 - armsUp) + armsUp * (Math.PI * 0.92 + wave);
    rightArm.current.rotation.z = -armSwing * (1 - armsUp) + armsUp * (Math.PI * 0.92 - wave);
    if (mood === "waiting" && !reducedMotion) {
      // One hand up, waving: "over here!"
      rightArm.current.rotation.z = Math.PI * 0.85 + Math.sin(time * 6) * 0.35;
    }

    animateConfetti(state, time, delta, confetti.current);
    animateSparks(state, time, delta, sparks.current);
  });

  return (
    <>
      <group
        ref={root}
        position={[motion.current.x, 0, z]}
        scale={RUNNER_SCALE}
        onClick={(event) => { event.stopPropagation(); lane.onSelect?.(); }}
        onPointerOver={() => { if (lane.onSelect) document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { document.body.style.cursor = ""; }}
      >
        <NameTag name={lane.name} model={lane.model} color={lane.color} icon={MOOD_ICONS[lane.mood]} renderOrder={renderOrder} />
        {lane.bubble && <SpeechBubble narration={lane.bubble} color={lane.color} row={bubbleRow} flipped={bubbleFlipped(lane.progress)} renderOrder={renderOrder} />}
        {[-1, 1].map((side) => (
          <group key={side} ref={side < 0 ? leftLeg : rightLeg} position={[0, HIP_HEIGHT, side * 0.09]}>
            <mesh position={[0, -0.1, 0]}>
              <capsuleGeometry args={[0.075, 0.07, 4, 10]} />
              <Low color={SHORTS} />
            </mesh>
            <mesh position={[0, -0.33, 0]}>
              <capsuleGeometry args={[0.05, 0.2, 4, 10]} />
              <Low color={SKIN} />
            </mesh>
            <mesh position={[0.04, -0.52, 0]} scale={[1.5, 0.8, 1]}>
              <sphereGeometry args={[0.065, 14, 10]} />
              <Low color="#fafafa" />
            </mesh>
          </group>
        ))}
        <group ref={body} position={[0, HIP_HEIGHT, 0]}>
          <mesh position={[0, 0.24, 0]}>
            <capsuleGeometry args={[0.155, 0.16, 6, 16]} />
            <Low color={lane.color} />
          </mesh>
          <mesh position={[0.158, 0.26, 0]} rotation={[0, Math.PI / 2, 0]}>
            <circleGeometry args={[0.055, 20]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh position={[0, 0.64, 0]}>
            <sphereGeometry args={[0.165, 24, 16]} />
            <Low color={SKIN} />
          </mesh>
          {/* A cap that is a soft dome with a rounded peak, and a little face */}
          <mesh position={[0, 0.665, 0]}>
            <sphereGeometry args={[0.172, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.46]} />
            <Low color={capColor} />
          </mesh>
          <mesh position={[0.15, 0.70, 0]} scale={[1.1, 0.26, 1]}>
            <sphereGeometry args={[0.1, 14, 8]} />
            <Low color={capColor} />
          </mesh>
          <Face />
          {[-1, 1].map((side) => (
            <group key={side} ref={side < 0 ? leftArm : rightArm} position={[0, 0.4, side * 0.21]}>
              <mesh position={[0, -0.04, 0]}>
                <sphereGeometry args={[0.07, 14, 10]} />
                <Low color={lane.color} />
              </mesh>
              <mesh position={[0, -0.19, 0]}>
                <capsuleGeometry args={[0.04, 0.16, 4, 10]} />
                <Low color={SKIN} />
              </mesh>
            </group>
          ))}
        </group>
      </group>
      {/* Spotlight for a runner that needs you (or that you focus) */}
      <group ref={beam} visible={false}>
        <mesh position={[0, 1.55, 0]}>
          <cylinderGeometry args={[0.3, 0.95, 3.1, 28, 1, true]} />
          <meshBasicMaterial color={lane.color} transparent opacity={0.16} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.62, 0.86, 36]} />
          <meshBasicMaterial color={lane.color} transparent opacity={0.55} depthWrite={false} />
        </mesh>
      </group>
      {/* The loop an agent keeps running on */}
      <mesh ref={loopRing} rotation={[-Math.PI / 2, 0, 0]} scale={[1.4, 0.64, 1]} visible={false}>
        <torusGeometry args={[0.5, 0.03, 6, 44]} />
        <meshBasicMaterial color="#ff8f5a" transparent opacity={0.8} />
      </mesh>
      {/* A soft round shadow instead of a shadow map */}
      <mesh ref={blob} rotation={[-Math.PI / 2, 0, 0]} position={[motion.current.x, 0.012, z]} scale={[0.34 * RUNNER_SCALE, 0.24 * RUNNER_SCALE, 1]}>
        <circleGeometry args={[1, 24]} />
        <meshBasicMaterial color="#1c2a1c" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <group ref={sparks} visible={false}>
        {Array.from({ length: SPARK_COUNT }, (_, index) => (
          <mesh key={index}>
            <sphereGeometry args={[0.06, 8, 6]} />
            <meshBasicMaterial color={SPARK_COLORS[index % SPARK_COLORS.length]} />
          </mesh>
        ))}
      </group>
      <group ref={confetti} visible={false}>
        {Array.from({ length: CONFETTI_COUNT }, (_, index) => (
          <mesh key={index}>
            <sphereGeometry args={[0.05, 8, 6]} />
            <Low color={CONFETTI_COLORS[index % CONFETTI_COLORS.length]} />
          </mesh>
        ))}
      </group>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The face: the same for every runner. Only the clothes (shirt, cap) tell the agents apart.
// ---------------------------------------------------------------------------------------------

const SKIN = "#f1c7a1";
const SKIN_SHADE = "#d8a982";
const DARK = "#2b2f3a";
const BROW = "#3a2c25";
const EYE_SPACING = 0.058;

/** Round eyes, brows, a nose and a smile. The head is a sphere of radius 0.165 centred on (0, 0.64, 0), facing +x. */
function Face() {
  return (
    <group>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[0.15, 0.622, side * EYE_SPACING]} scale={[0.55, 1, 1]}>
            <sphereGeometry args={[0.03, 12, 10]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh position={[0.162, 0.622, side * EYE_SPACING]}>
            <sphereGeometry args={[0.016, 10, 8]} />
            <meshBasicMaterial color={DARK} />
          </mesh>
          <mesh position={[0.15, 0.665, side * EYE_SPACING]} rotation={[Math.PI / 2 + side * 0.18, 0, 0]}>
            <capsuleGeometry args={[0.008, 0.04, 3, 6]} />
            <meshBasicMaterial color={BROW} />
          </mesh>
        </group>
      ))}
      <mesh position={[0.17, 0.592, 0]} scale={[0.9, 1, 0.9]}>
        <sphereGeometry args={[0.02, 10, 8]} />
        <Low color={SKIN_SHADE} />
      </mesh>
      {/* The smile: the lower half of a thin ring, in the plane of the face */}
      <group position={[0.153, 0.548, 0]} rotation={[0, Math.PI / 2, 0]}>
        <mesh rotation={[0, 0, Math.PI]}>
          <torusGeometry args={[0.03, 0.006, 6, 16, Math.PI]} />
          <meshBasicMaterial color="#7a3b3b" />
        </mesh>
      </group>
    </group>
  );
}

/** The agent's name above its head, with its status symbol when it needs you. */
function NameTag({ name, model, color, icon, renderOrder }: { name: string; model: string | null; color: string; icon?: { symbol: string; color: string }; renderOrder: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 160;
    const context = canvas.getContext("2d");
    if (context) {
      context.font = "700 46px system-ui, sans-serif";
      const label = icon ? `${icon.symbol}  ${name}` : name;
      const modelLabel = model ?? "modèle non fourni";
      const width = Math.min(512, Math.max(context.measureText(label).width, context.measureText(modelLabel).width) + 48);
      const left = (512 - width) / 2;
      context.fillStyle = "rgba(15, 19, 26, 0.82)";
      context.beginPath();
      context.roundRect(left, 12, width, 136, 34);
      context.fill();
      context.lineWidth = 6;
      context.strokeStyle = icon?.color ?? color;
      context.stroke();
      context.textAlign = "center";
      context.textBaseline = "middle";
      if (icon) {
        context.fillStyle = icon.color;
        context.fillText(label.split("  ")[0], left + 40, 52);
        context.fillStyle = "#f2f4f8";
        context.fillText(name, 256 + 22, 52);
      } else {
        context.fillStyle = "#f2f4f8";
        context.fillText(name, 256, 52);
      }
      context.fillStyle = "#b8c0d4";
      context.font = "500 30px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillText(modelLabel, 256, 106);
    }
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    result.generateMipmaps = false;
    result.minFilter = THREE.LinearFilter;
    return result;
  }, [name, model, color, icon]);
  useEffect(() => () => texture.dispose(), [texture]);
  // Behind the runner and depth-tested: the body hides part of the tag, never the head.
  return <sprite position={[0, 1.5, -0.55]} scale={[1.5, 0.47, 1]} renderOrder={5 + renderOrder}>
    <spriteMaterial map={texture} transparent depthWrite={false} />
  </sprite>;
}

const BUBBLE_TONES: Record<Narration["tone"], string> = { work: "#3f4b5e", success: "#0b7a0b", failure: "#c02f2f", info: "#3f4b5e" };

/** Two-line speech bubble: what the agent does (wrapped on up to two lines) and the reported detail. */
function SpeechBubble({ narration, color, row, flipped, renderOrder }: { narration: Narration; color: string; row: number; flipped: boolean; renderOrder: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 300;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "rgba(255,255,255,0.97)";
      context.strokeStyle = color;
      context.lineWidth = 10;
      context.beginPath();
      context.roundRect(10, 10, 1004, 236, 36);
      context.fill();
      context.stroke();
      // A soft, curved tail pointing down to the runner's head.
      const x = flipped ? (value: number) => 1024 - value : (value: number) => value;
      context.beginPath();
      context.moveTo(x(62), 240);
      context.quadraticCurveTo(x(66), 276, x(46), 292);
      context.quadraticCurveTo(x(96), 282, x(128), 240);
      context.closePath();
      context.fill();
      context.beginPath();
      context.moveTo(x(62), 244);
      context.quadraticCurveTo(x(66), 276, x(46), 292);
      context.quadraticCurveTo(x(96), 282, x(128), 244);
      context.stroke();
      context.fillStyle = BUBBLE_TONES[narration.tone];
      context.font = "700 58px system-ui, sans-serif";
      context.textBaseline = "middle";
      const lines = wrap(context, narration.text, 940, narration.detail ? 2 : 3);
      const lineHeight = 66;
      const detailHeight = narration.detail ? 56 : 0;
      let y = 128 - ((lines.length - 1) * lineHeight + detailHeight) / 2;
      for (const line of lines) {
        context.fillText(line, 42, y);
        y += lineHeight;
      }
      if (narration.detail) {
        context.fillStyle = "#56627a";
        context.font = "500 44px system-ui, sans-serif";
        context.fillText(wrap(context, narration.detail, 940, 1)[0], 42, y - 8);
      }
    }
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    result.generateMipmaps = false;
    result.minFilter = THREE.LinearFilter;
    result.needsUpdate = true;
    return result;
  }, [narration.text, narration.detail, narration.tone, color, flipped]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <sprite position={[flipped ? -1.4 : 1.4, 2.05 + row * 0.92, 0.08]} scale={[2.95, 0.86, 1]} renderOrder={10 + renderOrder}>
    <spriteMaterial map={texture} transparent depthTest={false} />
  </sprite>;
}

function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (context.measureText(`${last}…`).width > maxWidth && last.length > 4) last = last.slice(0, -2);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines.map((line) => {
    let fitted = line;
    while (context.measureText(fitted).width > maxWidth && fitted.length > 4) fitted = `${fitted.slice(0, -2)}…`;
    return fitted;
  });
}

const SPARK_COUNT = 30;
const SPARK_COLORS = ["#ffd166", "#ff6b9a", "#7be0ff", "#b8ff8a", "#ffffff"];
const SPARK_SECONDS = 1.7;

type MotionState = { confettiAt: number; velocities: THREE.Vector3[]; sparksAt: number; sparkVelocities: THREE.Vector3[] };

/** A round burst over the finish arch: sparks fly out in every direction, then fall and shrink. */
function launchSparks(state: MotionState, time: number, z: number, group: THREE.Group | null) {
  if (!group) return;
  state.sparksAt = time;
  group.visible = true;
  group.children.forEach((spark, index) => {
    spark.position.set(FINISH_X - 0.8, 3.1, z);
    spark.scale.setScalar(1);
    const angle = (index / SPARK_COUNT) * Math.PI * 2;
    const power = 2.2 + seeded(index + time) * 1.4;
    state.sparkVelocities[index].set(Math.cos(angle) * power * 0.35, Math.sin(angle) * power, Math.cos(angle * 3) * power * 0.4);
  });
}

function animateSparks(state: MotionState, time: number, delta: number, group: THREE.Group | null) {
  if (!group || !group.visible) return;
  const age = time - state.sparksAt;
  if (age > SPARK_SECONDS) {
    group.visible = false;
    return;
  }
  const fade = Math.max(0.05, 1 - age / SPARK_SECONDS);
  group.children.forEach((spark, index) => {
    const velocity = state.sparkVelocities[index];
    velocity.y -= 4.2 * delta;
    velocity.multiplyScalar(1 - delta * 1.1);
    spark.position.addScaledVector(velocity, delta);
    spark.scale.setScalar(fade);
  });
}

function launchConfetti(state: MotionState, time: number, z: number, group: THREE.Group | null) {
  if (!group) return;
  state.confettiAt = time;
  group.visible = true;
  group.children.forEach((piece, index) => {
    piece.position.set(FINISH_X + 0.2, 2.3, z + (seeded(index + time) - 0.5) * 0.6);
    state.velocities[index].set((seeded(index * 3 + time) - 0.5) * 3, 1.5 + seeded(index * 5 + time) * 2.5, (seeded(index * 7 + time) - 0.5) * 3);
  });
}

function animateConfetti(state: MotionState, time: number, delta: number, group: THREE.Group | null) {
  if (!group || !group.visible) return;
  if (time - state.confettiAt > 2.4) {
    group.visible = false;
    return;
  }
  group.children.forEach((piece, index) => {
    const velocity = state.velocities[index];
    velocity.y -= 6 * delta;
    velocity.multiplyScalar(1 - delta * 0.8);
    piece.position.addScaledVector(velocity, delta);
    if (piece.position.y < 0.03) {
      piece.position.y = 0.03;
      velocity.set(0, 0, 0);
    }
    piece.rotation.x += delta * 7;
    piece.rotation.y += delta * 5;
  });
}
