// App-level config (version + renderer mode). RENDER_MODE: "webgl" (default) or "webgpu".
// WebGPU uses three's WebGPURenderer (three r180+, import from "three/webgpu").
// To actually RUN with WebGPU, also set VITE_RENDER_MODE=webgpu so vite aliases the
// whole "three" module to the webgpu build (avoids two THREE copies in one bundle).
export const APP_VERSION = "0.1.00182";
export const RENDER_MODE: "webgl" | "webgpu" = (import.meta.env.VITE_RENDER_MODE as "webgpu" | undefined) ?? "webgl";
