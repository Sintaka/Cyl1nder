import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// VITE_RENDER_MODE=webgpu aliases ONLY the bare "three" module to the webgpu
// build (regex ^three$), so renderer + addons (OrbitControls/TransformControls)
// share ONE three instance. "three/addons/*" stays on the normal path.
const webgpu = process.env.VITE_RENDER_MODE === "webgpu";

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 8376, strictPort: true },
  resolve: webgpu
    ? { alias: [{ find: /^three$/, replacement: resolve(process.cwd(), "node_modules/three/build/three.webgpu.js") }] }
    : undefined,
  // 多页构建：主应用 + Overview 总管页面（dev 下 Vite 自动服务根目录 html，无需额外配置）
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), "index.html"),
        overview: resolve(process.cwd(), "overview.html"),
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
