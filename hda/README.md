# Cyl1nder HDA（Houdini 侧）

Subnet 型 SOP HDA：**4 输入 / 4 输出**，内部 4 个 Python SOP（role 0..3）+ 4 个 Output SOP。

## 数据流
- cook 时 role0 序列化 4 输入 → 防抖线程 POST 到桥（127.0.0.1:8375，serial 路由）
- 每个 role 从桥 GET outputs?since=rev → 构建自己的输出几何 → 对应 Output SOP
- 桥不可用时 HDA 不崩：role0 推失败仅记录，status 显示 offline；auto_pull=off 时退化为 passthrough（输出=对应输入）

## 热更新（重点）
HDA 是薄壳，逻辑全在 `hda/src/*.py`（经 package 的 PYTHONPATH 加载）。改代码后无需重建 HDA，
在 Houdini Python shell 执行：
```python
import importlib, cyl1nder_hda, cyl1nder_bridge, cyl1nder_serializer
importlib.reload(cyl1nder_serializer); importlib.reload(cyl1nder_bridge); importlib.reload(cyl1nder_hda)
```
或直接重启 Houdini。重建 HDA 本体（一般不需要）：
```powershell
"$env:HFS\bin\hython.exe" hda/scripts/build_hda.py
```

## 安装
把 `hda/package/cyl1nder.json` 复制到 `%USERPROFILE%\Documents\houdini22.0\packages\`，重启 Houdini，
SOP 层 Tab 搜索 **Cyl1nder**。

## 序列号
节点创建后首次 cook 生成 `C1-<base36毫秒>-<4位随机>` 写入隐藏参数 `cyl1nder_serial`，此后永不变。
复制/粘贴节点后请点 **Regenerate Serial** 按钮生成新号（避免两个节点共用一个工作区）。

## 冒烟测试
```powershell
"$env:HFS\bin\hython.exe" hda/scripts/hython_smoke.py
```
（需桥已启动：`cd bridge; .venv\Scripts\python -m bridge`）