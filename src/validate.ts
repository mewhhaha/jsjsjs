/** Argument validators shared by js3 modules; the prelude does not re-export them. */
import * as THREE from "three";
import type { XYZ } from "./primitives.ts";

export function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}
export function positive(
  value: number,
  label: string,
  allowZero = false,
): number {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new RangeError(
      `${label} must be finite and ${allowZero ? "nonnegative" : "positive"}`,
    );
  }
  return value;
}
export function range(
  value: number,
  min: number,
  max: number,
  label: string,
): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(
      `${label} must be finite and between ${min} and ${max}`,
    );
  }
  return value;
}
/** A safe integer in [min, max]; pass Infinity for no upper bound. */
export function integer(
  value: number,
  min: number,
  max: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(
      `${label} must be an integer ${
        max === Infinity ? `>= ${min}` : `between ${min} and ${max}`
      }`,
    );
  }
  return value;
}
export function vector(value: XYZ, label: string): THREE.Vector3 {
  if (value.length !== 3 || !value.every(Number.isFinite)) {
    throw new RangeError(`${label} must contain three finite numbers`);
  }
  return new THREE.Vector3(...value);
}
