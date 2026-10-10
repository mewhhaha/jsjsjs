import type { Vector3Tuple } from "three";

export type ModelView =
  | "iso"
  | "front"
  | "back"
  | "left"
  | "right"
  | "top"
  | "bottom";

/** Authored model only. Bounds are world-space; mesh totals include instances. */
export interface ModelInspection {
  animations: { name: string; duration: number; tracks: number }[];
  bounds: {
    min: Vector3Tuple;
    max: Vector3Tuple;
    size: Vector3Tuple;
    center: Vector3Tuple;
  };
  counts: {
    objects: number;
    meshes: number;
    instances: number;
    geometries: number;
    materials: number;
    vertices: number;
    triangles: number;
  };
  objects: {
    name: string;
    type: string;
    visible: boolean;
    vertices: number;
    triangles: number;
    instances: number;
    materials: string[];
  }[];
  materials: {
    name: string;
    type: string;
    color: string | null;
    opacity: number;
    transparent: boolean;
  }[];
  warnings: string[];
}

export interface ViewerAPI {
  ready: boolean;
  revision: number;
  error: string | null;
  exportOBJ(): string;
  /** Base64 GLB for smaller models; the CLI receives files with uploads. */
  exportGLB(): Promise<string>;
  /** POST the GLB to a CLI receiver URL as `model.glb`. */
  uploadGLB(url: string): Promise<void>;
  /** POST each groom asset file to a CLI receiver URL; paths are relative. */
  uploadGrooms(url: string): Promise<GroomExportGroup[]>;
  inspect(): ModelInspection;
  setView(view: ModelView): void;
  fit(): void;
  render(): void;
  animationState(): AnimationState;
  playAnimation(clip?: string, options?: AnimationPlayOptions): AnimationState;
  pauseAnimation(): AnimationState;
  sampleAnimation(
    clip: string,
    time: number,
    options?: AnimationSampleOptions,
  ): AnimationState;
  resetAnimation(): AnimationState;
  captureImposter(
    options?: ImposterOptions,
  ): Promise<{ png: string; manifest: ImposterManifest }>;
}

export interface GroomExportGroup {
  name: string;
  directory: string;
  files: {
    source: string;
    manifest: string;
    coverage: string;
    normal: string;
    tangent: string;
    depth: string;
    attributes: string;
  };
}

declare global {
  interface Window {
    modelViewer: ViewerAPI;
  }
}
import type { ImposterManifest, ImposterOptions } from "./imposter-layout.ts";
export type { ImposterManifest, ImposterOptions } from "./imposter-layout.ts";
import type {
  AnimationPlayOptions,
  AnimationSampleOptions,
  AnimationState,
} from "../src/animation.ts";
export type {
  AnimationPlayOptions,
  AnimationSampleOptions,
  AnimationState,
} from "../src/animation.ts";
