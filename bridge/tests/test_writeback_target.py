"""写回指向 + passthrough 测试（用户设计：见 cook_txn.py「写回指向」小节）。

用户的话就是验收标准：
「用户要是没搭建对应的链路, hda cook 就直接把 input 搬回去就好, 这一部分由桥负责,
 output 节点被修改目的地时需要更新在桥中指向的对象, 然后 cook 请求发出时桥去找有没有
 指向, 如果是类似空指针的东西就直接把 input 塞回去给 hda, 如果是 tag 类那就更简单了,
 因为完全不用同步」

风格照 test_mapping.py：注册表纯单测 + 路由走 create_app 的 TestClient。
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from bridge.cook_txn import (
    WritebackTargets,
    get_writeback_targets,
    is_tag_serial,
    passthrough_outputs,
    resolve_target,
)
from bridge.main import create_app
from bridge.protocol import (
    InputPayload,
    generate_project_serial,
    generate_serial,
)
from bridge.state import get_state, reset_state

TAG_PATH = "/obj/geo1/apex_ctrl_tag"
REL = "sandbox_sceneanimate/point_1"
NAME = "apex/point_1"


def _client(tmp_path: Path) -> TestClient:
    reset_state(tmp_path / "data")
    return TestClient(create_app())


def _inputs(*ports: int) -> list[InputPayload]:
    return [
        InputPayload(index=p, name=f"in{p}", pointCount=2, primCount=0,
                     points=[[float(p), 0.0, 0.0], [float(p), 1.0, 0.0]])
        for p in ports
    ]


def _cook_body(**kw) -> dict:
    body = {"inputs": [], "frame": 1.0, "hip": "", "nodePath": "/obj/geo1/c1", "label": "c1"}
    body.update(kw)
    return body


# --- WritebackTargets 存储 ---------------------------------------------------


def test_set_get_and_clear_roundtrip(tmp_path: Path) -> None:
    t = WritebackTargets(tmp_path / "writeback.json")
    s, p = generate_serial(), generate_project_serial()
    rec = t.set(s, 1, p, NAME)
    assert rec["project"] == p and rec["name"] == NAME and rec["updatedAt"] > 0
    assert t.get(s, 1) == rec
    assert t.get_all(s) == {1: rec}
    assert t.clear(s, 1) is True
    assert t.get(s, 1) is None and t.get_all(s) == {}
    assert t.clear(s, 1) is False       # 二次 clear 不报错，只说没删到


def test_ports_are_independent(tmp_path: Path) -> None:
    """重指向 2 号口不能动 0 号——这正是按端口存而不是整节点存的理由。"""
    t = WritebackTargets(tmp_path / "writeback.json")
    s, p = generate_serial(), generate_project_serial()
    t.set(s, 0, p, "a")
    t.set(s, 2, p, "b")
    t.clear(s, 2)
    assert sorted(t.get_all(s)) == [0]
    assert t.get_all(s)[0]["name"] == "a"


def test_set_rejects_empty_and_get_all_is_a_copy(tmp_path: Path) -> None:
    t = WritebackTargets(tmp_path / "writeback.json")
    s, p = generate_serial(), generate_project_serial()
    with pytest.raises(ValueError):
        t.set(s, 0, "", NAME)
    with pytest.raises(ValueError):
        t.set(s, 0, p, "")
    with pytest.raises(ValueError):
        t.set("", 0, p, NAME)
    t.set(s, 0, p, NAME)
    snap = t.get_all(s)
    snap[0]["name"] = "mutated"
    assert t.get(s, 0)["name"] == NAME   # 外部改副本改不到内部


def test_persists_across_instances_with_int_ports(tmp_path: Path) -> None:
    """落盘的端口 key 是字符串（JSON 规范），读回必须还是 int。"""
    path = tmp_path / "writeback.json"
    s, p = generate_serial(), generate_project_serial()
    WritebackTargets(path).set(s, 3, p, NAME)
    again = WritebackTargets(path)
    assert list(again.get_all(s)) == [3]
    assert again.get(s, 3)["name"] == NAME
    assert again.serials() == [s]


def test_load_tolerates_garbage(tmp_path: Path) -> None:
    """坏文件当空表：桥绝不能因为一个坏 json 起不来。"""
    bad = tmp_path / "writeback.json"
    bad.write_text("{not json", encoding="utf-8")
    assert WritebackTargets(bad).serials() == []
    bad.write_text('{"C1-x": {"nope": {"project": "P1-a", "name": "n"},'
                   ' "0": {"project": "", "name": ""}, "1": "notadict"}}', encoding="utf-8")
    assert WritebackTargets(bad).serials() == []   # 三条全是坏行，一条都不该留


def test_clear_serial_drops_every_port(tmp_path: Path) -> None:
    t = WritebackTargets(tmp_path / "writeback.json")
    s, p = generate_serial(), generate_project_serial()
    t.set(s, 0, p, "a")
    t.set(s, 1, p, "b")
    assert t.clear_serial(s) == 2
    assert t.get_all(s) == {} and t.clear_serial(s) == 0


# --- 指向解析（空指针的三种成因）--------------------------------------------


def _seed_mapping(tmp_path: Path) -> tuple[str, str]:
    """建锚点 + 一条 entry，返回 (pid, anchor serial)。"""
    reset_state(tmp_path / "data")
    reg = get_state().mappings
    pid, anchor = generate_project_serial(), generate_serial()
    reg.upsert_anchor(anchor, TAG_PATH)
    reg.put_entry(pid, NAME, {"anchor": anchor, "rel": REL, "kind": "param",
                              "adapter": None, "type": "float", "label": ""})
    return pid, anchor


def test_resolve_no_pointer_is_not_an_error(tmp_path: Path) -> None:
    """没搭链路是**正常状态**，要能和「坏了」区分开。"""
    reset_state(tmp_path / "data")
    out = resolve_target(0, None)
    assert out["ok"] is False and out["reason"] == "no-pointer"
    assert out["port"] == 0 and out["resolved"] is None


def test_resolve_dangling_when_entry_missing(tmp_path: Path) -> None:
    reset_state(tmp_path / "data")
    pid = generate_project_serial()
    out = resolve_target(1, {"project": pid, "name": "gone"})
    assert out["ok"] is False and out["reason"] == "dangling"
    assert out["project"] == pid and out["name"] == "gone"


def test_resolve_dangling_on_half_written_pointer(tmp_path: Path) -> None:
    reset_state(tmp_path / "data")
    assert resolve_target(0, {"project": "", "name": NAME})["reason"] == "dangling"
    assert resolve_target(0, {"project": generate_project_serial(), "name": ""})["reason"] == "dangling"


def test_resolve_ok_when_link_is_built(tmp_path: Path) -> None:
    pid, _ = _seed_mapping(tmp_path)
    out = resolve_target(2, {"project": pid, "name": NAME})
    assert out["ok"] is True and out["reason"] == "ok"
    assert (out["resolved"] or {}).get("absolutePath", "").endswith(REL)


def test_resolve_unresolved_when_anchor_dies(tmp_path: Path) -> None:
    """条目在、但锚点解析不出来 -> unresolved（≠ dangling，成因不同要分开报）。"""
    reset_state(tmp_path / "data")
    reg = get_state().mappings
    pid, anchor = generate_project_serial(), generate_serial()
    reg.upsert_anchor(anchor, "")          # nodePath 空 = 锚点无效
    reg.put_entry(pid, NAME, {"anchor": anchor, "rel": REL, "kind": "param",
                              "adapter": None, "type": "float", "label": ""})
    out = resolve_target(0, {"project": pid, "name": NAME})
    assert out["ok"] is False and out["reason"].startswith("unresolved")


# --- 吊牌识别（registry 有记录 ≠ 是 HDA）-------------------------------------


def test_registry_presence_does_not_make_a_tag(tmp_path: Path) -> None:
    """`SerialRegistry.touch()` 会给任何合法 serial 自动建行，不能当判据。"""
    reset_state(tmp_path / "data")
    s = generate_serial()
    get_state().registry.touch(s)
    assert is_tag_serial(s) is False


def test_tag_detected_only_from_channel_row(tmp_path: Path) -> None:
    reset_state(tmp_path / "data")
    s, hda = generate_serial(), generate_serial()
    get_state().channels.register({"kind": "tag", "serial": s, "nodePath": TAG_PATH})
    get_state().channels.register({"kind": "hda", "serial": hda, "nodePath": "/obj/geo1/c1"})
    assert is_tag_serial(s) is True
    assert is_tag_serial(hda) is False
    assert is_tag_serial("") is False


# --- passthrough（「没搭链路就把 input 搬回去」）------------------------------


def test_passthrough_hands_back_every_unwired_port(tmp_path: Path) -> None:
    reset_state(tmp_path / "data")
    s = generate_serial()
    plan = passthrough_outputs(s, _inputs(0, 1, 2))
    assert plan["skipped"] is False
    assert plan["ports"] == [0, 1, 2]
    assert [b.index for b in plan["buffers"]] == [0, 1, 2]
    # 几何原样搬回：点数与坐标都不该被动过
    assert plan["buffers"][1].pointCount == 2
    assert plan["buffers"][1].points == [[1.0, 0.0, 0.0], [1.0, 1.0, 0.0]]
    assert [r["reason"] for r in plan["resolved"]] == ["no-pointer"] * 3


def test_passthrough_skips_ports_with_a_live_pointer(tmp_path: Path) -> None:
    """链路搭好的端口写回走映射，**不**passthrough；同一个 HDA 的其他端口照搬。"""
    pid, _ = _seed_mapping(tmp_path)
    s = generate_serial()
    t = WritebackTargets(tmp_path / "wb.json")
    t.set(s, 1, pid, NAME)
    plan = passthrough_outputs(s, _inputs(0, 1), targets=t)
    assert plan["ports"] == [0]
    by_port = {r["port"]: r for r in plan["resolved"]}
    assert by_port[1]["ok"] is True and by_port[0]["reason"] == "no-pointer"


def test_dangling_pointer_behaves_like_no_pointer(tmp_path: Path) -> None:
    """用户说的「类似空指针的东西」：指向在、但解析不出来，照样把 input 塞回去。"""
    reset_state(tmp_path / "data")
    s = generate_serial()
    t = WritebackTargets(tmp_path / "wb.json")
    t.set(s, 0, generate_project_serial(), "deleted/name")
    plan = passthrough_outputs(s, _inputs(0), targets=t)
    assert plan["ports"] == [0]
    assert plan["resolved"][0]["reason"] == "dangling"


def test_tag_serial_never_enters_the_geometry_path(tmp_path: Path) -> None:
    """吊牌「完全不用同步」：连指向都不查，一个 buffer 都不产。"""
    reset_state(tmp_path / "data")
    s = generate_serial()
    get_state().channels.register({"kind": "tag", "serial": s, "nodePath": TAG_PATH})
    plan = passthrough_outputs(s, _inputs(0, 1))
    assert plan["skipped"] is True
    assert plan["buffers"] == [] and plan["ports"] == []
    assert plan["resolved"] == [] and "tag" in plan["reason"]


def test_existing_output_is_never_clobbered(tmp_path: Path) -> None:
    """web/gizmo 编辑过的端口不能被 passthrough 打回原形。"""
    reset_state(tmp_path / "data")
    s = generate_serial()
    plan = passthrough_outputs(s, _inputs(0, 1), existing_ports={0})
    assert plan["ports"] == [1]
    kept = {r["port"]: r for r in plan["resolved"]}[0]
    assert "kept existing output" in kept["reason"]


def test_passthrough_with_no_inputs_is_a_noop(tmp_path: Path) -> None:
    reset_state(tmp_path / "data")
    plan = passthrough_outputs(generate_serial(), [])
    assert plan["ports"] == [] and plan["reason"] == "nothing to passthrough"
    assert plan["flush"]["errors"] == {}


# --- cook 路径（PUT /inputs 是 cook 推送入口）--------------------------------


def test_cook_without_a_link_returns_inputs_as_outputs(tmp_path: Path) -> None:
    """用户需求的主线：没搭链路 -> HDA 立刻能从 /outputs 取回自己的 input。"""
    c = _client(tmp_path)
    s = generate_serial()
    body = _cook_body(inputs=[{"index": 0, "name": "in0", "pointCount": 2, "primCount": 0,
                               "points": [[1, 2, 3], [4, 5, 6]]}])
    r = c.put(f"/api/hda/{s}/inputs", json=body)
    assert r.status_code == 200
    wb = r.json()["writeback"]
    assert wb["applied"] == [0] and wb["resolved"][0]["reason"] == "no-pointer"
    out = c.get(f"/api/hda/{s}/outputs").json()
    assert [b["index"] for b in out["outputs"]] == [0]
    assert out["outputs"][0]["points"] == [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]


def test_cook_never_fails_even_with_a_broken_pointer(tmp_path: Path) -> None:
    c = _client(tmp_path)
    s = generate_serial()
    get_writeback_targets().set(s, 0, generate_project_serial(), "nope")
    r = c.put(f"/api/hda/{s}/inputs", json=_cook_body(inputs=[{"index": 0, "pointCount": 1,
                                                              "points": [[0, 0, 0]]}]))
    assert r.status_code == 200 and r.json()["ok"] is True
    assert r.json()["writeback"]["applied"] == [0]


def test_second_cook_does_not_bump_rev_for_identical_inputs(tmp_path: Path) -> None:
    """echo guard 仍然生效：同样的 input 搬两次不该把 rev 越推越高。"""
    c = _client(tmp_path)
    s = generate_serial()
    body = _cook_body(inputs=[{"index": 0, "pointCount": 1, "points": [[7, 7, 7]]}])
    c.put(f"/api/hda/{s}/inputs", json=body)
    rev1 = c.get(f"/api/hda/{s}/outputs").json()["rev"]
    r2 = c.put(f"/api/hda/{s}/inputs", json=body)
    assert r2.json()["writeback"]["applied"] == []   # 第二趟已有 output，不再回填
    assert c.get(f"/api/hda/{s}/outputs").json()["rev"] == rev1


def test_cook_on_a_tag_serial_produces_no_outputs(tmp_path: Path) -> None:
    c = _client(tmp_path)
    s = generate_serial()
    get_state().channels.register({"kind": "tag", "serial": s, "nodePath": TAG_PATH})
    r = c.put(f"/api/hda/{s}/inputs", json=_cook_body(inputs=[{"index": 0, "pointCount": 1,
                                                              "points": [[1, 1, 1]]}]))
    assert r.status_code == 200
    assert r.json()["writeback"]["applied"] == []
    assert c.get(f"/api/hda/{s}/outputs").json()["outputs"] == []


# --- 指向端点 ----------------------------------------------------------------


def test_pointer_endpoints_roundtrip(tmp_path: Path) -> None:
    c = _client(tmp_path)
    s, pid = generate_serial(), generate_project_serial()
    assert c.get(f"/api/hda/{s}/writeback").json() == {
        "ok": True, "serial": s, "isTag": False, "targets": {}, "resolved": []}
    r = c.put(f"/api/hda/{s}/writeback/1", json={"project": pid, "name": NAME})
    assert r.status_code == 200 and r.json()["port"] == 1
    got = c.get(f"/api/hda/{s}/writeback").json()
    assert got["targets"]["1"]["name"] == NAME
    assert c.delete(f"/api/hda/{s}/writeback/1").json()["removed"] is True
    assert c.get(f"/api/hda/{s}/writeback").json()["targets"] == {}


def test_retarget_overwrites_the_same_port(tmp_path: Path) -> None:
    """「output 节点被修改目的地时需要更新在桥中指向的对象」——重指向是覆盖。"""
    c = _client(tmp_path)
    s, pid = generate_serial(), generate_project_serial()
    c.put(f"/api/hda/{s}/writeback/0", json={"project": pid, "name": "first"})
    c.put(f"/api/hda/{s}/writeback/0", json={"project": pid, "name": "second"})
    targets = c.get(f"/api/hda/{s}/writeback").json()["targets"]
    assert list(targets) == ["0"] and targets["0"]["name"] == "second"


def test_unregistered_and_half_typed_serials_stay_permissive(tmp_path: Path) -> None:
    """半打出来的 serial 回正常 200 形状，不是 404（既有端点的一贯做法）。"""
    c = _client(tmp_path)
    r = c.get("/api/hda/C1-abc/writeback")
    assert r.status_code == 200 and r.json()["targets"] == {}
    # 从没注册过的合法 serial 同样是 200 空视图
    assert c.get(f"/api/hda/{generate_serial()}/writeback").status_code == 200
    # 删一个没指向过的端口不是错误
    assert c.delete(f"/api/hda/{generate_serial()}/writeback/0").json()["removed"] is False


def test_pointer_endpoint_rejects_tag_and_bad_project(tmp_path: Path) -> None:
    c = _client(tmp_path)
    s, tag = generate_serial(), generate_serial()
    get_state().channels.register({"kind": "tag", "serial": tag, "nodePath": TAG_PATH})
    # 吊牌不用同步 -> 拒绝存指向（409），且 GET 明确报 isTag
    assert c.put(f"/api/hda/{tag}/writeback/0",
                 json={"project": generate_project_serial(), "name": NAME}).status_code == 409
    assert c.get(f"/api/hda/{tag}/writeback").json()["isTag"] is True
    # 写指向必须给项目 serial（P1-），不是 HDA serial
    assert c.put(f"/api/hda/{s}/writeback/0", json={"project": s, "name": NAME}).status_code == 400
    assert c.put("/api/hda/not-a-serial/writeback/0",
                 json={"project": generate_project_serial(), "name": NAME}).status_code == 400


def test_pointer_resolves_after_the_mapping_is_created(tmp_path: Path) -> None:
    """先指向、后建条目：解析要跟着变活（指向存的是引用，不是快照）。"""
    c = _client(tmp_path)
    reg = get_state().mappings
    s, pid, anchor = generate_serial(), generate_project_serial(), generate_serial()
    c.put(f"/api/hda/{s}/writeback/0", json={"project": pid, "name": NAME})
    assert c.get(f"/api/hda/{s}/writeback").json()["resolved"][0]["reason"] == "dangling"
    reg.upsert_anchor(anchor, TAG_PATH)
    reg.put_entry(pid, NAME, {"anchor": anchor, "rel": REL, "kind": "param",
                              "adapter": None, "type": "float", "label": ""})
    assert c.get(f"/api/hda/{s}/writeback").json()["resolved"][0]["ok"] is True
    # 链路搭好之后 cook 就不再 passthrough 这个端口
    r = c.put(f"/api/hda/{s}/inputs", json=_cook_body(inputs=[{"index": 0, "pointCount": 1,
                                                              "points": [[2, 2, 2]]}]))
    assert r.json()["writeback"]["applied"] == []
