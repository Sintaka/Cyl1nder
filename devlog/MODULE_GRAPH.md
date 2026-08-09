# 模块依赖图 / MODULE GRAPH (web/src)

> 机器生成（2026-08-09），由 `node scripts/gen-graph.mjs` 产出。

- `app/app-config.ts`
- `app/layout.ts`
- `app/log.ts`
- `bridge/client.ts`
  - protocol/types
- `main.ts`
  - app/app-config
  - app/layout
  - bridge/client
  - nodes/cyl1nderNode
  - protocol/types
  - stores/workspace
  - styles.css
  - viewport/renderer
- `nodes/cyl1nderNode.ts`
  - @antv/x6
- `protocol/types.ts`
- `stores/workspace.ts`
  - protocol/types
- `tools/transform.ts`
  - protocol/types
- `viewport/controls.ts`
  - three
  - three/addons/controls/OrbitControls.js
- `viewport/geometry.ts`
  - protocol/types
  - three
- `viewport/renderer.ts`
  - protocol/types
  - stores/workspace
  - three
  - three/addons/controls/TransformControls.js
  - tools/transform
  - viewport/controls
  - viewport/geometry
