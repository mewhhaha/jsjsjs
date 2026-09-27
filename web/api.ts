export type ModelView =
  | "iso"
  | "front"
  | "back"
  | "left"
  | "right"
  | "top"
  | "bottom";

export type Vector3Tuple = [number, number, number];

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
  /** Convenience export for smaller models; the CLI uses bounded chunks. */
  exportGLB(): Promise<string>;
  beginGLBExport(): Promise<GLBExportTransfer>;
  readGLBExportChunk(id: string, index: number): string;
  endGLBExport(id: string): void;
  beginGroomExport(): GroomExportTransfer;
  prepareGroomExportFile(
    id: string,
    fileIndex: number,
  ): Promise<GroomFileExportTransfer>;
  readGroomExportChunk(id: string, fileIndex: number, index: number): string;
  endGroomExport(id: string): void;
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

/** A pinned binary export transferred in independently encoded base64 chunks. */
export interface GLBExportTransfer {
  id: string;
  byteLength: number;
  chunkSize: number;
  chunks: number;
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

export interface GroomExportTransfer {
  id: string;
  grooms: GroomExportGroup[];
  files: { path: string; kind: "json" | "png" }[];
}

/** Only the selected groom file is encoded and pinned at any one time. */
export interface GroomFileExportTransfer extends GLBExportTransfer {
  fileIndex: number;
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
