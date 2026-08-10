import * as THREE from "three";
import { RENDER_MODE } from "../app/app-config";

/** Unified renderer surface: WebGLRenderer (default) or WebGPURenderer (r180+). */
export interface RendererLike {
  domElement: HTMLCanvasElement;
  setSize(w: number, h: number): void;
  setPixelRatio(n: number): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
}

/**
 * Create the viewport renderer. Default is WebGLRenderer (stable hot-loop);
 * when RENDER_MODE === "webgpu" (and VITE_RENDER_MODE=webgpu aliases "three" to
 * the webgpu build), use three's WebGPURenderer. Falls back to WebGL on failure.
 */
export async function createRenderer(): Promise<RendererLike> {
  if (RENDER_MODE === "webgpu") {
    try {
      const { WebGPURenderer } = await import("three/webgpu");
      const r = new WebGPURenderer({ antialias: true });
      await r.init();
      return r as unknown as RendererLike;
    } catch (e) {
      console.warn("WebGPU unavailable, falling back to WebGL:", e);
    }
  }
  return new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
}
