import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function createNavigation(
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  hooks: { change(): void; start(): void; end(): void },
) {
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.mouseButtons = {
    LEFT: undefined,
    MIDDLE: THREE.MOUSE.ROTATE,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.addEventListener("change", hooks.change);
  controls.addEventListener("start", hooks.start);
  controls.addEventListener("end", hooks.end);
  const pressed = new Set<string>();
  const movementKeys = new Set([
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "KeyQ",
    "KeyE",
  ]);
  let frame = 0;
  let last = 0;
  let fast = false;
  function step(time: number) {
    const dt = Math.min((time - last) / 1000, 0.05);
    last = time;
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().setFromMatrixColumn(
      camera.matrixWorld,
      0,
    );
    const delta = new THREE.Vector3();
    if (pressed.has("KeyW")) delta.add(forward);
    if (pressed.has("KeyS")) delta.sub(forward);
    if (pressed.has("KeyD")) delta.add(right);
    if (pressed.has("KeyA")) delta.sub(right);
    if (pressed.has("KeyE")) delta.y++;
    if (pressed.has("KeyQ")) delta.y--;
    const speed = Math.max(
      camera.position.distanceTo(controls.target) * 0.5,
      0.1,
    );
    delta.normalize().multiplyScalar(dt * speed * (fast ? 3 : 1));
    camera.position.add(delta);
    controls.target.add(delta);
    controls.update();
    hooks.change();
    frame = requestAnimationFrame(step);
  }
  function stop() {
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
    hooks.end();
  }
  addEventListener("keydown", (event) => {
    if (
      (event.target as HTMLElement)?.closest(
        "input, select, button, textarea, [contenteditable]",
      )
    ) return;
    fast = event.shiftKey;
    if (
      !movementKeys.has(event.code) || event.ctrlKey || event.metaKey ||
      event.altKey
    ) return;
    event.preventDefault();
    pressed.add(event.code);
    if (!frame) {
      last = performance.now();
      hooks.start();
      frame = requestAnimationFrame(step);
    }
  });
  addEventListener("keyup", (event) => {
    fast = event.shiftKey;
    pressed.delete(event.code);
    if (!pressed.size) stop();
  });
  addEventListener("blur", () => {
    pressed.clear();
    fast = false;
    stop();
  });
  return controls;
}
