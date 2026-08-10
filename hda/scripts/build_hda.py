"""Build the Cyl1nder HDA (subnet, 4 in / 4 out, 4 python SOPs).

Run (Windows):  "C:\Program Files\Side Effects Software\Houdini 22.0.368\bin\hython.exe" hda/scripts/build_hda.py
Output:        hda/otls/Cyl1nder_1.0.hda
"""
from __future__ import annotations

import os

import hou

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.environ.get(
    "CYL1NDER_HDA_OUT",
    os.path.join(ROOT, "otls", "Cyl1nder_1.0.hda"),
)

INPUT_COUNT = 4
PY_CODE = "import cyl1nder_hda\ncyl1nder_hda.cook(role={role})\n"

FORCE_COOK_CALLBACK = (
    "node = hou.pwd()\n"
    "for n in node.children():\n"
    '    if n.type().name() in ("python", "blast", "output"):\n'
    "        n.cook(force=True)\n"
)

OPEN_WEB_CALLBACK = (
    "import webbrowser\n"
    "import threading\n"
    "import urllib.request\n"
    "node = hou.pwd()\n"
    "base = node.parm('web_url').eval().rstrip('/')\n"
    "serial = node.parm('cyl1nder_serial').eval()\n"
    "def _ui_up():\n"
    "    try:\n"
    "        urllib.request.urlopen('http://127.0.0.1:8376/', timeout=0.5)\n"
    "        return True\n"
    "    except Exception:\n"
    "        return False\n"
    "def _open():\n"
    "    if not _ui_up():\n"
    "        exec(open(r'D:/code/dev/Cyl1nder/hda/scripts/bridge_control.py', encoding='utf-8-sig').read())\n"
    "        ensure_frontend()\n"
    "    webbrowser.open(base + '/?serial=' + serial)\n"
    "threading.Thread(target=_open, daemon=True).start()\n"
)

REGEN_CALLBACK = (
    "node = hou.pwd()\n"
    "import cyl1nder_bridge as cb\n"
    'node.parm("cyl1nder_serial").set(cb.generate_serial())\n'
)


def _parm_group() -> hou.ParmTemplateGroup:
    from hou import (
        ButtonParmTemplate,
        IntParmTemplate,
        ParmTemplateGroup,
        StringParmTemplate,
        ToggleParmTemplate,
    )

    group = ParmTemplateGroup()

    serial = StringParmTemplate("cyl1nder_serial", "Serial", 1, default_value=("",))
    try:
        serial.setTag("sidefx::hidden", "1")
    except Exception:  # noqa: BLE001
        pass
    group.append(serial)

    group.append(
        StringParmTemplate(
            "bridge_url", "Bridge URL", 1, default_value=("http://127.0.0.1:8375",)
        )
    )
    group.append(
        StringParmTemplate(
            "web_url", "Web UI URL", 1, default_value=("http://127.0.0.1:8376",)
        )
    )
    auto_push = ToggleParmTemplate("auto_push", "Auto Push", True)
    auto_pull = ToggleParmTemplate("auto_pull", "Auto Pull", True)
    bridge_autostart = ToggleParmTemplate("bridge_autostart", "Bridge Autostart", True)
    auto_push.setJoinWithNext(True)
    auto_pull.setJoinWithNext(True)
    group.append(auto_push)
    group.append(auto_pull)
    group.append(bridge_autostart)
    group.append(IntParmTemplate("sync_fps", "Sync FPS", 1, default_value=(30,), min=1, max=60))

    force_cook = ButtonParmTemplate("force_cook", "Force Cook")
    force_cook.setScriptCallback(FORCE_COOK_CALLBACK)
    force_cook.setScriptCallbackLanguage(hou.scriptLanguage.Python)
    force_cook.setJoinWithNext(True)
    group.append(force_cook)

    open_web = ButtonParmTemplate("open_web", "Open in Browser")
    open_web.setScriptCallback(OPEN_WEB_CALLBACK)
    open_web.setScriptCallbackLanguage(hou.scriptLanguage.Python)
    open_web.setJoinWithNext(True)
    group.append(open_web)

    regen = ButtonParmTemplate("cyl1nder_regenerate", "Regenerate Serial")
    regen.setScriptCallback(REGEN_CALLBACK)
    regen.setScriptCallbackLanguage(hou.scriptLanguage.Python)
    group.append(regen)

    group.append(StringParmTemplate("status", "Status", 1, default_value=("",)))
    return group


def build(output_path: str = OUT) -> hou.Node:
    hou.hipFile.clear(suppress_save_prompt=True)
    geo = hou.node("/obj").createNode("geo", "__cyl1nder_build")
    sub = geo.createNode("subnet", "cyl1nder")

    inds = sub.indirectInputs()
    ins = [sub.createNode("null", f"in{i}") for i in range(INPUT_COUNT)]
    for i in range(INPUT_COUNT):
        ins[i].setInput(0, inds[i])

    # 4 python SOPs, one per output role (0..3). Each python SOP reads ALL 4 inputs
    # (node.inputs()[role]) and pulls ITS OWN output buffer. Network traffic is
    # deduplicated by a process-wide cache in cyl1nder_hda (_role_buffer + lock):
    # the first role to cook pulls all 4 buffers once; the other 3 reuse the cache.
    pys = []
    for i in range(INPUT_COUNT):
        p = sub.createNode("python", f"cyl1nder_py{i}")
        p.parm("python").set(PY_CODE.format(role=i))
        p.parm("maintainstate").set(0)  # re-run every HDA recook -> push/pull on update
        for j in range(INPUT_COUNT):
            p.setInput(j, ins[j], 0)
        pys.append(p)

    for i in range(INPUT_COUNT):
        o = sub.createNode("output", f"out{i}")
        o.parm("outputidx").set(i)
        o.setInput(0, pys[i], 0)

    sub.setParmTemplateGroup(_parm_group())

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    hda_node = sub.createDigitalAsset(
        name="Cyl1nder",
        hda_file_name=output_path,
        description="Cyl1nder - Houdini <-> WebGL middle station (4 in / 4 out)",
        min_num_inputs=0,  # inputs may be left empty (Not enough sources fix)
        max_num_inputs=INPUT_COUNT,
        compress_contents=True,
    )
    d = hda_node.type().definition()
    d.setVersion("1.0")
    d.setComment(
        "Cyl1nder bridge HDA. Internal python SOPs import cyl1nder_hda via PYTHONPATH "
        "(hda/package/cyl1nder.json). See devlog/decisions.md."
    )

    want = {
        "cyl1nder_serial",
        "bridge_url",
        "web_url",
        "auto_push",
        "auto_pull",
        "sync_fps",
        "bridge_autostart",
        "force_cook",
        "open_web",
        "cyl1nder_regenerate",
        "status",
    }
    existing = {t.name() for t in d.parmTemplateGroup().entries()}
    if not want.issubset(existing):
        d.setParmTemplateGroup(_parm_group())
    opts = hou.HDAOptions()
    opts.setLockContents(False)  # Pull Now toggles internal refresh_tick parms
    d.setOptions(opts)
    d.save(output_path, create_backup=False)

    print("HDA written:", output_path)
    print("type:", hda_node.type().name(), "| inputs:", d.minNumInputs(), "to", d.maxNumInputs())
    return hda_node


if __name__ == "__main__":
    build()