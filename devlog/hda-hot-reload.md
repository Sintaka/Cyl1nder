# HDA 热重载手册（免重启 Houdini）

> 目标：改代码/改 HDA 定义都不用重启 Houdini。共分 3 层，按改动类型选。

## 层级总览
| 层 | 改什么 | 路径 | 免重启手段 |
|---|---|---|---|
| 1 | 运行时 Python（序列化/推拉/cook 逻辑） | `hda/src/cyl1nder_*.py` | `importlib.reload` + `cook(force=True)`（最快） |
| 2 | HDA 定义（内部网络/参数/按钮回调） | `hda/scripts/build_hda.py` → `otls/Cyl1nder_1.0.hda` | 重建 + `hou.hda.reloadFile` |
| 3 | bridge 进程（REST/WS/MCP） | `bridge/bridge/*.py` | 重启 bridge 进程（与 Houdini 无关） |

---

## 第 1 层：hda/src Python 运行时（最常用）

HDA 是薄壳，逻辑全在 `hda/src/`（package 的 PYTHONPATH 注入）。改完直接热加载：

**Houdini 里：Windows → Python Shell，执行**
```python
exec(open(r"D:/code/dev/Cyl1nder/hda/scripts/reload_hda.py").read())
reload_cyl1nder()          # 重载 3 个模块 + 强制重跑所有 Cyl1nder 实例的内部 python SOP
```
手动等价版（不想用脚本时）：
```python
import importlib, sys
sys.path.insert(0, r"D:/code/dev/Cyl1nder/hda/src")
import cyl1nder_serializer, cyl1nder_bridge, cyl1nder_hda
importlib.reload(cyl1nder_serializer); importlib.reload(cyl1nder_bridge); importlib.reload(cyl1nder_hda)
import hou
for n in hou.nodeType(hou.sopNodeTypeCategory(), "Cyl1nder").instances():
    for c in n.children():
        if c.type().name() == "python":
            c.cook(force=True)      # 关键：普通 cook() 命中缓存不重跑
```

**原理与要点**
- python SOP 默认 `maintainstate=1` 会缓存，`cook()` 不重跑脚本 → 必须 `cook(force=True)`。
- 我们的实例已设 `maintainstate=0`：之后**每次 HDA recook（改参数/输入/Pull Now）都会自动重跑新代码**，所以 reload 之后点一下 **Pull Now** 或改任意参数即可看到效果。
- 改 `hda/src/*.py` 后**不需要**重建 HDA 文件，也**不需要**重启。

---

## 第 2 层：HDA 定义（内部网络 / 参数 / 按钮）

改了 `hda/scripts/build_hda.py`（例如加按钮、改回调、改内部结构）时：

```powershell
# 1) 重建 .hda 文件（hython 无头，不影响当前 Houdini 会话）
"C:\Program Files\Side Effects Software\Houdini 22.0.368\bin\hython.exe" hda/scripts/build_hda.py
```
```python
# 2) 在当前会话热重载定义（实例保留 serial 等参数值）
exec(open(r"D:/code/dev/Cyl1nder/hda/scripts/reload_hda.py").read())
reload_cyl1nder(definition=True)     # = 重建 + reloadFile + 强制重跑
```
手动等价：`hou.hda.reloadFile(r"D:/code/dev/Cyl1nder/hda/otls/Cyl1nder_1.0.hda")`

---

## 第 3 层：bridge 进程

`bridge/bridge/*.py` 是独立 Python 进程（127.0.0.1:8375），改完重启它即可，Houdini/Codex 都不用动：
```powershell
cd D:\code\dev\Cyl1nder\bridge
# 停旧进程（端口 8375）后：
.venv\Scripts\python -m bridge
```
HDA 下次 cook 会自动重连（推拉都带超时，桥不可用也不崩）。

---

## UI 手操（不写代码，直接改 HDA 内部）

1. **进 HDA 内部**：网络编辑器双击 Cyl1nder 节点（或选中后按 Enter）。内容已解锁（lockContents=False），可直接编辑内部节点/连线/参数。
2. **改完写回 .hda**：网络编辑器里右键该节点 → **Save Operator Type (Preferred)**（或 File 菜单同项）。
3. **改参数 UI / 回调 / 脚本**：右键 HDA 节点 → **Type Properties…**（Edit Operator Type Properties）→ 改完 **Apply**，需要持久化就 **Save**；也可在这里看/改 Event Handler。
4. **改内部 python SOP 的内联代码**：进内部选 python SOP → 参数编辑器里直接改 `python` 参数 → 改完自动 recook（maintainstate=0 保证重跑）。注意内联代码只是薄壳 `import cyl1nder_hda; cook(role=i)`，真正的逻辑在 `hda/src/`——**优先走第 1 层**。
5. **Python Shell 入口**：Windows → Python Shell 跑 reload 脚本（第 1 层）。

## 常见坑
- 忘了 `cook(force=True)`：改完没效果，其实模块已换、脚本没重跑。
- 改了内部网络但没 Save Operator Type：重启后回到旧定义。
- 改了 bridge 却只 reload HDA：桥代码是独立进程，必须重启桥。
- HDA 文件被锁：确保没有在 Houdini 里以"外部编辑"方式占用；`create_backup=False` 已避免 backup 堆积。