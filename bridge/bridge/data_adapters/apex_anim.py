"""apex-anim 适配器：经 code.execute_python 读写 Houdini 数据参数（asData/setFromData）。

适配器只做「生成 python 代码 + 调用 MCP」，不做数据解释（保持 HDA 薄、桥通用）。"""
from __future__ import annotations

import json

from bridge import houdini_mcp


class ApexAnimDataAdapter:
    name = "apex-anim"

    def read(self, port: int, target_node: str, target_parm: str) -> dict:
        """code: import hou; n=hou.node(<node_path>); p=n.parm(<parm_name>)（两者不存在即抛
        → {"ok": False, "error": ...}）；return_expression: "p.asData()"
        → {"ok": True, "value": <返回的 data dict>}"""
        code = (
            "import hou; "
            f"n = hou.node({json.dumps(target_node)}); "
            f"p = n.parm({json.dumps(target_parm)})"
        )
        result = self._rpc(port, code, "p.asData()")
        if not result.get("ok"):
            return result
        return {"ok": True, "value": result.get("value")}

    def write(self, port: int, target_node: str, target_parm: str, value) -> dict:
        """value 经 json.dumps 紧凑嵌入 python 字面量；code: import hou,json; n=hou.node(...);
        n.parm(...).setFromData(json.loads(<value_json>))；return_expression: "True"
        → {"ok": True, "value": <value 原样回显>}"""
        value_json = json.dumps(value, separators=(",", ":"))  # 紧凑 JSON 文本
        code = (
            "import hou, json; "
            f"n = hou.node({json.dumps(target_node)}); "
            f"p = n.parm({json.dumps(target_parm)}); "
            f"p.setFromData(json.loads({json.dumps(value_json)}))"
        )
        result = self._rpc(port, code, "True")
        if not result.get("ok"):
            return result
        return {"ok": True, "value": value}

    def _rpc(self, port: int, code: str, expr: str) -> dict:
        """经 houdini_mcp.execute_python 执行；信封 = {success, executed, return_value}
        （实机核实），取 return_value 为值。"""
        try:
            envelope = houdini_mcp.execute_python(port, code, expr)
        except Exception as exc:  # noqa: BLE001 - HoudiniMcpError/解析失败归一到 ok=False
            return {"ok": False, "error": str(exc)[:200]}
        if not isinstance(envelope, dict) or envelope.get("error") or not envelope.get("success"):
            return {"ok": False, "error": str(envelope)[:200]}
        return {"ok": True, "value": envelope.get("return_value")}
