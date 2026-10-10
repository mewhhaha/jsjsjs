/** Helpers shared by the rigging and animation modules; the prelude does not re-export them. */
import * as THREE from "three";
import type { XYZ } from "./primitives.ts";

interface RestTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}
/** Reference transforms, captured on first use. */
export const rest = new WeakMap<THREE.Object3D, RestTransform>();

export function checkedVector(value: XYZ, label: string): THREE.Vector3 {
  if (value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error(`${label} must contain three finite numbers.`);
  }
  return new THREE.Vector3(...value);
}
export function degrees(value: XYZ): THREE.Quaternion {
  const v = checkedVector(value, "rotation").multiplyScalar(Math.PI / 180);
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(v.x, v.y, v.z));
}
export function restTransform(object: THREE.Object3D): RestTransform {
  let value = rest.get(object);
  if (!value) {
    value = {
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    };
    rest.set(object, value);
  }
  return value;
}
/** Names must be unambiguous; object references avoid name collisions. */
export function resolveTarget(
  root: THREE.Object3D,
  target: string | THREE.Object3D,
): THREE.Object3D {
  const matches: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (
      typeof target === "string" ? object.name === target : object === target
    ) {
      matches.push(object);
    }
  });
  if (matches.length !== 1) {
    throw new Error(
      `Target ${
        typeof target === "string" ? target : target.name || target.uuid
      } ${matches.length ? "is ambiguous" : "was not found"} in the model.`,
    );
  }
  return matches[0];
}
