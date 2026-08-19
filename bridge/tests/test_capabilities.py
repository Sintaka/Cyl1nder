"""GET /api/serials/{serial}/capabilities 测试（nodeview 单地址 + 下拉端口）。

路由测试照 test_channels.py 的裸 FastAPI 做法（reset_state 把注册表指到 tmp_path，
conftest 另把快照根隔离到临时目录——绝不写 bridge/data）。

覆盖：hda -> 4+4 geo；tag -> 逻辑名 + 真类型；未注册 -> known=False + 200；
脏 type 归一化/丢弃；排序稳定；以及「吊牌不在 registry.json」这条踩坑的回归锁。
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from bridge.channel_routes import router as channel_router
from bridge.protocol import generate_serial
from bridge.state import get_state, reset_state

CAPS = "/api/serials/{}/capabilities"


def _client(tmp_path: Path) -> TestClient:
    reset_state(tmp_path / "data")
    app = FastAPI()
    app.include_router(channel_router)
    return TestClient(app)


def _register_tag(serial: str, node_path: str = "/obj/geo1/tag1", hip: str = "D:/x.hip") -> None:
    """吊牌只进通道表（registry.json 由 put_inputs 写，吊牌从不调它）。"""
    get_state().channels.register(
        {"kind": "tag", "serial": serial, "nodePath": node_path, "hip": hip, "label": "Tag"}
    )


def _register_param(serial: str, rel: str, type_: object, kind: str = "param", label: str = "") -> None:
    get_state().channels.register(
        {
            "kind": kind,
            "serial": serial,
            "absolutePath": f"/obj/geo1/{rel}",
            "rel": rel,
            "type": type_,
            "label": label,
        }
    )


# --- geo HDA ----------------------------------------------------------------


def test_hda_serial_offers_four_in_four_out_geo(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial, hip="D:/x.hip", nodePath="/obj/geo1/Cyl1nder1")
    r = c.get(CAPS.format(serial))
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "hda"
    assert body["known"] is True
    assert body["nodePath"] == "/obj/geo1/Cyl1nder1"
    assert body["hip"] == "D:/x.hip"
    # key 0 基（web 图内部端口键），label 1 基（用户口语 in1-4）
    assert [o["key"] for o in body["inputs"]] == ["in0", "in1", "in2", "in3"]
    assert [o["key"] for o in body["outputs"]] == ["out0", "out1", "out2", "out3"]
    assert [o["label"] for o in body["inputs"]] == ["In 1", "In 2", "In 3", "In 4"]
    assert [o["label"] for o in body["outputs"]] == ["Out 1", "Out 2", "Out 3", "Out 4"]
    assert {o["type"] for o in body["inputs"] + body["outputs"]} == {"geo"}


# --- 吊牌 -------------------------------------------------------------------


def test_tag_serial_lists_logical_names_with_types(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    _register_tag(serial)
    _register_param(serial, "transform1/tx", "float")
    _register_param(serial, "sceneanimate1/animation", "vec3", kind="data")
    body = c.get(CAPS.format(serial)).json()
    assert body["kind"] == "tag"
    assert body["known"] is True
    assert body["nodePath"] == "/obj/geo1/tag1"
    got = {o["key"]: o["type"] for o in body["inputs"]}
    assert got == {"transform1/tx": "float", "sceneanimate1/animation": "vec3"}
    # 吊牌暴露参数值，读写双向都通 -> 两个方向给同一份清单
    assert body["outputs"] == body["inputs"]


def test_tag_option_label_falls_back_to_logical_name(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    _register_tag(serial)
    _register_param(serial, "transform1/tx", "float")
    _register_param(serial, "transform1/ty", "float", label="Height")
    labels = {o["key"]: o["label"] for o in c.get(CAPS.format(serial)).json()["inputs"]}
    assert labels == {"transform1/tx": "transform1/tx", "transform1/ty": "Height"}


def test_tag_detected_without_registry_entry(tmp_path: Path) -> None:
    """回归锁：吊牌**不在 registry.json** 里（devlog/project-mapping-design.md §5.1）。

    若检测反过来先查 registry，吊牌会被判成未知或 hda（4 口 geo），正是那次线上 bug。
    """
    c = _client(tmp_path)
    serial = generate_serial()
    _register_tag(serial)
    _register_param(serial, "transform1/tx", "float")
    assert get_state().registry.get(serial) is None  # 前提：registry 里确实没有
    body = c.get(CAPS.format(serial)).json()
    assert body["kind"] == "tag"
    assert [o["key"] for o in body["inputs"]] == ["transform1/tx"]


def test_tag_wins_over_registry_touch(tmp_path: Path) -> None:
    """registry 里有记录也不能读作 hda：touch() 对任何合法 serial 都会自动登记。"""
    c = _client(tmp_path)
    serial = generate_serial()
    _register_tag(serial)
    _register_param(serial, "transform1/tx", "float")
    get_state().registry.touch(serial)  # 自动登记，registry 从此有这个 serial
    assert get_state().registry.get(serial) is not None
    body = c.get(CAPS.format(serial)).json()
    assert body["kind"] == "tag"
    assert [o["key"] for o in body["inputs"]] == ["transform1/tx"]


# --- 未知 / 脏数据 / 排序 ----------------------------------------------------


def test_unknown_serial_is_200_not_404(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    r = c.get(CAPS.format(serial))
    assert r.status_code == 200  # 用户逐字输入，404 会让每个按键都变成报错
    body = r.json()
    assert body == {
        "serial": serial,
        "kind": "",
        "known": False,
        "nodePath": "",
        "hip": "",
        "inputs": [],
        "outputs": [],
    }


def test_malformed_serial_is_200_unknown(tmp_path: Path) -> None:
    c = _client(tmp_path)
    r = c.get(CAPS.format("C1-msm6"))  # 半截地址
    assert r.status_code == 200
    assert r.json()["known"] is False
    assert r.json()["kind"] == ""


def test_dirty_type_normalised_or_dropped(tmp_path: Path) -> None:
    """脏 type：去空格+大小写归一；不认识的一律 ""，绝不猜一个默认类型。"""
    c = _client(tmp_path)
    serial = generate_serial()
    _register_tag(serial)
    _register_param(serial, "a/upper", " VEC3 ")     # 归一化到 vec3
    _register_param(serial, "b/mixed", "Float")      # 归一化到 float
    _register_param(serial, "c/bogus", "quaternion")  # 不在 MAPPING_TYPES -> ""
    _register_param(serial, "d/none", None)           # 缺失 -> ""
    _register_param(serial, "e/empty", "")            # 空 -> ""
    got = {o["key"]: o["type"] for o in c.get(CAPS.format(serial)).json()["inputs"]}
    assert got == {
        "a/upper": "vec3",
        "b/mixed": "float",
        "c/bogus": "",
        "d/none": "",
        "e/empty": "",
    }


def test_row_without_logical_name_is_skipped(tmp_path: Path) -> None:
    """没 rel 的行进不了下拉：用户无从选择，也无法解析成绝对路径。"""
    c = _client(tmp_path)
    serial = generate_serial()
    _register_tag(serial)
    get_state().channels.register(
        {"kind": "param", "serial": serial, "absolutePath": "/obj/geo1/transform1/tz", "type": "float"}
    )
    _register_param(serial, "transform1/tx", "float")
    assert [o["key"] for o in c.get(CAPS.format(serial)).json()["inputs"]] == ["transform1/tx"]


def test_ordering_is_deterministic(tmp_path: Path) -> None:
    """按逻辑名排序：注册顺序打乱也不影响下拉顺序，且多次请求一致。"""
    c = _client(tmp_path)
    serial = generate_serial()
    _register_tag(serial)
    for rel in ("zz/last", "transform1/tx", "aa/first", "sceneanimate1/animation"):
        _register_param(serial, rel, "float")
    expected = ["aa/first", "sceneanimate1/animation", "transform1/tx", "zz/last"]
    for _ in range(3):
        body = c.get(CAPS.format(serial)).json()
        assert [o["key"] for o in body["inputs"]] == expected
        assert [o["key"] for o in body["outputs"]] == expected


def test_other_serial_channels_are_not_leaked(tmp_path: Path) -> None:
    """只列本 serial 名下的逻辑名——同一桥上还有别的吊牌。"""
    c = _client(tmp_path)
    mine, other = generate_serial(), generate_serial()
    _register_tag(mine)
    _register_tag(other, node_path="/obj/geo1/tag2")
    _register_param(mine, "transform1/tx", "float")
    _register_param(other, "transform2/ty", "float")
    assert [o["key"] for o in c.get(CAPS.format(mine)).json()["inputs"]] == ["transform1/tx"]
    assert [o["key"] for o in c.get(CAPS.format(other)).json()["inputs"]] == ["transform2/ty"]
