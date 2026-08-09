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