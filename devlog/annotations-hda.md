# HDA 子系统改动标注 / HDA annotations

## v0.1.0-cyl1nder.1
- 形态：Subnet HDA（SOP），**4 输入 / 4 输出**（4 个 Output SOP `outputidx` 0-3）。
- 内部：4 个 Python SOP（role 0..3）；Pull Now 回调对内部 python SOP `cook(force=True)` 强制重跑。
- 序列号：首次 cook 生成 `C1-<base36ms>-<4rand>` 写入隐藏参数 `cyl1nder_serial`，之后永不变；**Regenerate Serial** 按钮手动换新号（复制/粘贴节点用）。
- 数据流：role0 序列化 4 输入 → 防抖线程 POST；各 role GET `outputs?since=rev` → 构建输出几何。
- 运行时逻辑在 `hda/src/*.py`（package 的 PYTHONPATH 注入，**热更新免重建 HDA**）。
- 构建：`hython hda/scripts/build_hda.py` → `hda/otls/Cyl1nder_1.0.hda`（create_backup=False）。
- 关键坑（已解决）：python SOP 默认缓存（`cook()` 不重跑）→ `cook(force=True)`；H22 Button parm 用 `pressButton()`/回调；压缩内容默认锁定内部参数（已 setLockContents False）。
- 冒烟：`hython hda/scripts/hython_smoke.py` 全绿（serial 不可变、4 输入推送、编辑→pull→out0 几何）。
## v0.1.0-cyl1nder.2（2026-08-10）
- **空输入修复**：`min_num_inputs=0`（原 4 会让空输入报 `Not enough sources specified.`）。
- **maintainstate=0**：4 个内部 Python SOP 每次 HDA recook 都重跑 → Houdini 一更新（改参数/输入/手动 cook）就推输入给桥，不再受 python SOP 缓存影响。
- **Open in Browser 按钮**：`open_web` 参数回调 `webbrowser.open(bridge_url + '/?serial=' + cyl1nder_serial)`，默认浏览器打开对应工作区。
- 热重载：`hou.hda.reloadFile(path)` 可直接替换活动会话中的定义，实例保留 serial 等参数值。
## v0.1.0-cyl1nder.3（2026-08-10）
- **web_url 参数**：Open in Browser 按钮改开前端地址（默认 `http://127.0.0.1:5173`，参数 `web_url`），不再误开数据桥 8375。
- **Shelf 工具架**：`hda/shelf/Cyl1nder.shelf`（Reload HDA / Reload Bridge，python 图标），装入 `Documents\houdini22.0\toolbar\`，Houdini 下次启动出现（或右键工具架手动加）。
## v0.1.00002（2026-08-10）
- **Force Cook**：`pull_now` 改名 `force_cook`（label "Force Cook"），回调对内部 python SOP `cook(force=True)`。
- **双向同步（30fps 上限）**：新增 `sync_fps` 参数（默认 30，1-60）。role0 cook 时启动守护轮询线程，按 1/sync_fps 间隔调 `GET /api/hda/{serial}/pending?since=`；检测到待拉输出（web 在 Cyl1nder 里改过）→ `hdefereval.executeDeferred` 主线程安全地把 HDA `status` 标记为 `dirty` 并强制重跑 python SOP → 拉回结果 → status 回 `ok`。headless hython 无 hdefereval 时退化为手动 Force Cook。
- 实测：web 推编辑 → ~0.6s 内 Houdini 自动拉回 out0（P=[0,0,0]/[1.5,1.5,0]/[3,3,0]）。