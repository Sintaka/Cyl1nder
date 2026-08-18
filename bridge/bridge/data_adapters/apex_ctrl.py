"""apex-ctrl 适配器：读写 APEX Scene Animate 控制器的**世界位姿**。

与 apex-anim 的区别：apex-anim 操作一个 Data parm（asData/setFromData 直通），
apex-ctrl 操作的是 sceneanimate 节点里的一个**控制器**——没有对应 parm，必须经
apex runtime 求值。target_parm 因此复用为控制器名（如 "point_1"）。

铁律（devlog/apex-runtime-knowledge.md 实机验证）：
- 世界位姿只在 ControlManager.getControlData(ctrl).xform；local 不含 restlocal。
- graph_parms 是叠加在 restlocal 上的 delta：
  delta = world × parentxform⁻¹ × restlocal⁻¹
- 只写 graph_parms 会被动画层覆盖，必须 setKeysFromDict 提交。
- 写回 animation Data parm 时必须**保留该 parm 原有的全部顶层 packed prim**
  （catalog.data / default.clip / animation），只删多出来的 char 折叠；
  丢掉任何一个都会让姿态塌回 rest。
- 绝不对 animation parm 调 revertToDefaults()（会清空整个场景状态）。
- 父级先提交、重载后再解子级（两趟），否则 parentxform 是旧的 → 世界坐标漂移。
"""
from __future__ import annotations

import json

from bridge import houdini_mcp

# 在 Houdini 里执行的公共前导：定位节点 + 求值 scene + 取控制器数据。
_PRELUDE = """
import hou, apex, base64, json

def _load(node):
    sc = apex.Scene()
    sc.loadFromGeometry(node.geometry())
    rig = None
    for p in sc.findDataPaths('*.rig'):
        rig = str(p)
        sc.addRigToEvaluation(rig)
    sc.updateEvaluationParms(hou.frame())
    sc.updateDirtyRigs()
    cm = sc.control_manager
    cm.update(sc)
    return sc, cm, rig

def _commit(sc, node):
    # 保留 parm 原有顶层 prim 集合，只删多余的（见模块 docstring）
    keep = [p.attribValue('name') for p in node.parm('animation').eval().prims()
            if p.type() == hou.primType.PackedGeometry]
    full = hou.Geometry(); sc.saveToGeometry(full)
    work = hou.Geometry(); work.merge(full)
    doomed = [p for p in work.prims()
              if p.type() == hou.primType.PackedGeometry
              and p.attribValue('name') not in keep]
    if doomed:
        work.deletePrims(doomed)
    node.parm('animation').setFromData(
        {'geometry': base64.b85encode(work.data()).decode('ascii')})
    node.cook(force=True)
"""


_COMPONENTS = {
    "tx": ("t", 0), "ty": ("t", 1), "tz": ("t", 2),
    "rx": ("r", 0), "ry": ("r", 1), "rz": ("r", 2),
}


class ApexCtrlDataAdapter:
    """两种寻址形式（bridge 的 _resolve_data_target 按最后一个 `/` 切分）：

    整体形式  `<sceneanimate 节点>/<控制器名>`      → target_parm = 控制器名
      read  → {"t":[x,y,z], "r":[rx,ry,rz], "ctrl": ...}
      write ← {"t":[...]} / {"r":[...]}（世界空间；缺的键不动）

    分量形式  `<sceneanimate 节点>/<控制器名>/<tx|ty|tz|rx|ry|rz>`
              → target_node 末段是控制器名，target_parm 是分量名
      read  → 标量；write ← 标量
      分量形式让 web 侧既有「通道引用绑定」（putChannelValues 走标量）能直接驱动
      控制器，无需改动 web 绑定链路。
    """

    name = "apex-ctrl"

    @staticmethod
    def _split(target_node: str, target_parm: str) -> tuple[str, str, tuple[str, int] | None]:
        """→ (节点路径, 控制器名, 分量) ；分量为 None 表示整体形式。"""
        comp = _COMPONENTS.get(target_parm)
        if comp is None:
            return target_node, target_parm, None
        node, _, ctrl = target_node.rpartition("/")
        return node, ctrl, comp

    def read(self, port: int, target_node: str, target_parm: str) -> dict:
        node_path, ctrl_name, comp = self._split(target_node, target_parm)
        code = _PRELUDE + f"""
node = hou.node({json.dumps(node_path)})
sc, cm, rig = _load(node)
ctrl = rig + '/' + {json.dumps(ctrl_name)}
d = cm.getControlData(ctrl)
if d is None:
    RES = {{'error': 'no control data for ' + ctrl}}
else:
    x = d.xform
    RES = {{'ctrl': ctrl,
            't': [round(v, 6) for v in x.extractTranslates()],
            'r': [round(v, 6) for v in x.extractRotates()]}}
"""
        result = self._unwrap(self._rpc(port, code, "json.dumps(RES)"))
        if not result.get("ok") or comp is None:
            return result
        chan, idx = comp
        return {"ok": True, "value": result["value"][chan][idx]}

    def write(self, port: int, target_node: str, target_parm: str, value) -> dict:
        """value: {"t": [x,y,z]} / {"r": [...]}，世界空间。

        两趟语义由调用方决定：本方法只解一个控制器；若同时要动父级，
        先对父级 write（内部已 commit），再对子级 write（会重载拿到新 parentxform）。
        """
        node_path, ctrl_name, comp = self._split(target_node, target_parm)
        if comp is not None:
            # 分量形式：读当前世界位姿 → 只改这一个分量 → 整体写回
            try:
                scalar = float(value)
            except (TypeError, ValueError):
                return {"ok": False, "error": "component value must be a number"}
            cur = self.read(port, node_path, ctrl_name)
            if not cur.get("ok"):
                return cur
            chan, idx = comp
            vec = list(cur["value"][chan])
            vec[idx] = scalar
            value = {chan: vec}
        elif not isinstance(value, dict):
            return {"ok": False, "error": "value must be an object with t/r"}
        code = _PRELUDE + f"""
node = hou.node({json.dumps(node_path)})
want = json.loads({json.dumps(json.dumps(value))})
sc, cm, rig = _load(node)
ctrl = rig + '/' + {json.dumps(ctrl_name)}
d = cm.getControlData(ctrl)
if d is None:
    RES = {{'error': 'no control data for ' + ctrl}}
else:
    cur = d.xform
    t = want.get('t') or [round(v, 6) for v in cur.extractTranslates()]
    r = want.get('r') or [round(v, 6) for v in cur.extractRotates()]
    goal = hou.hmath.buildRotate(r[0], r[1], r[2]) * hou.hmath.buildTranslate(hou.Vector3(*t))
    delta = goal * d.parentxform.inverted() * d.restlocal.inverted()
    mp = cm.getControlMapping(ctrl)
    rg = sc.getData(rig)
    b = sc.getData(rig + '/animbinding')
    wrote = []
    if want.get('t') is not None and mp.t:
        rg.graph_parms[mp.t] = delta.extractTranslates(); wrote.append(mp.t)
    if want.get('r') is not None and mp.r:
        rg.graph_parms[mp.r] = delta.extractRotates(); wrote.append(mp.r)
    for parm in wrote:
        b.setKeysFromDict(sc, hou.frame(), True, pattern=parm, force_key=True)
    _commit(sc, node)
    sc2, cm2, _ = _load(node)
    got = cm2.getControlData(ctrl).xform
    RES = {{'ctrl': ctrl, 'wrote': wrote,
            't': [round(v, 6) for v in got.extractTranslates()],
            'r': [round(v, 6) for v in got.extractRotates()]}}
"""
        result = self._unwrap(self._rpc(port, code, "json.dumps(RES)"))
        if not result.get("ok") or comp is None:
            return result
        chan, idx = comp
        return {"ok": True, "value": result["value"][chan][idx]}

    def _unwrap(self, result: dict) -> dict:
        if not result.get("ok"):
            return result
        try:
            payload = json.loads(result.get("value") or "{}")
        except (TypeError, ValueError) as exc:
            return {"ok": False, "error": f"bad adapter payload: {exc}"}
        if payload.get("error"):
            return {"ok": False, "error": payload["error"]}
        return {"ok": True, "value": payload}

    def _rpc(self, port: int, code: str, expr: str) -> dict:
        try:
            envelope = houdini_mcp.execute_python(port, code, expr)
        except Exception as exc:  # noqa: BLE001 - 归一到 ok=False
            return {"ok": False, "error": str(exc)[:200]}
        if not isinstance(envelope, dict) or envelope.get("error") or not envelope.get("success"):
            return {"ok": False, "error": str(envelope)[:200]}
        return {"ok": True, "value": envelope.get("return_value")}
