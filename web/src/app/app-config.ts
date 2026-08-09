// App-level config (version + renderer mode). RENDER_MODE: "webgl" (default) or "webgpu".
// WebGPU path is reserved (three r180+ WebGPURenderer); v1 ships WebGLRenderer behind a
// unified Renderer interface so swapping is a one-liner.
export const APP_VERSION = "0.1.00005";
export const RENDER_MODE: "webgl" | "webgpu" = "webgl";