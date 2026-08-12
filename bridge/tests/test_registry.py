import time
from pathlib import Path

import pytest

from bridge.protocol import generate_serial, is_valid_serial
from bridge.registry import RegistryError, SerialRegistry


def test_generate_serial_valid() -> None:
    for _ in range(100):
        s = generate_serial()
        assert is_valid_serial(s)
        assert s.startswith("C1-")


def test_register_created_at_immutable(tmp_path: Path) -> None:
    reg = SerialRegistry(tmp_path / "registry.json")
    s = generate_serial()
    r1 = reg.register(s, hip="a.hip", nodePath="/obj/geo1/cyl1nder1", label="Cyl1nder")
    time.sleep(0.01)
    r2 = reg.register(s, hip="a.hip", nodePath="/obj/geo1/cyl1nder1", label="Cyl1nder")
    assert r2.createdAt == r1.createdAt
    assert r2.lastSeen >= r1.lastSeen
    assert r2.nodePath == r1.nodePath


def test_register_updates_identity_on_recontact(tmp_path: Path) -> None:
    reg = SerialRegistry(tmp_path / "registry.json")
    s = generate_serial()
    reg.register(s, nodePath="/obj/old")
    r2 = reg.register(s, nodePath="/obj/new")
    assert r2.nodePath == "/obj/new"
    assert len(reg.serials()) == 1


def test_invalid_serial_raises(tmp_path: Path) -> None:
    reg = SerialRegistry(tmp_path / "registry.json")
    with pytest.raises(RegistryError):
        reg.register("not-a-serial")
    with pytest.raises(RegistryError):
        reg.register("C1-xx-yy")


def test_persistence(tmp_path: Path) -> None:
    path = tmp_path / "registry.json"
    reg = SerialRegistry(path)
    s = generate_serial()
    reg.register(s, nodePath="/obj/x", label="Cyl1nder")
    reg2 = SerialRegistry(path)
    rec = reg2.get(s)
    assert rec is not None
    assert rec.nodePath == "/obj/x"
    assert rec.label == "Cyl1nder"


def test_touch_auto_registers_valid_serial(tmp_path: Path) -> None:
    """Heartbeat touch re-registers a valid serial after a bridge restart
    (registration otherwise only happens via push_inputs on cook)."""
    reg = SerialRegistry(tmp_path / "registry.json")
    s = generate_serial()
    assert reg.get(s) is None
    reg.touch(s)
    rec = reg.get(s)
    assert rec is not None and rec.lastSeen > 0
    assert s in reg.serials()
    # persisted: a fresh registry instance over the same file sees it
    reg2 = SerialRegistry(tmp_path / "registry.json")
    assert reg2.get(s) is not None


def test_touch_ignores_invalid_serial(tmp_path: Path) -> None:
    reg = SerialRegistry(tmp_path / "registry.json")
    reg.touch("not-a-serial")
    assert len(reg.serials()) == 0


def test_mark_activity_auto_registers(tmp_path: Path) -> None:
    reg = SerialRegistry(tmp_path / "registry.json")
    s = generate_serial()
    reg.mark_activity(s)
    rec = reg.get(s)
    assert rec is not None and rec.lastActivity > 0


def _read_records(path: Path) -> list[dict]:
    import json
    return json.loads(path.read_text(encoding="utf-8"))



def test_save_debounced_touch_and_mark_activity(tmp_path: Path) -> None:
    """Rapid touch/mark_activity must not write registry.json every call (sync disk
    I/O at 60Hz blocked the event loop); the file only changes once per second."""
    path = tmp_path / "registry.json"
    reg = SerialRegistry(path)
    s = generate_serial()
    reg.register(s, nodePath="/obj/x")  # register saves immediately
    assert path.exists()
    on_disk = _read_records(path)  # lastSeen snapshot as of register()
    before = reg.get(s).lastSeen
    for _ in range(30):
        reg.touch(s)
        reg.mark_activity(s)
    # in-memory state still updates ...
    assert reg.get(s).lastSeen > before
    # ... but the file is untouched inside the debounce window (no disk write)
    assert _read_records(path) == on_disk
    # after the window a touch persists (single write -> lastSeen moves on disk)
    time.sleep(1.05)
    reg.touch(s)
    assert _read_records(path) != on_disk
    reg2 = SerialRegistry(path)
    assert reg2.get(s) is not None and reg2.get(s).lastSeen >= reg.get(s).lastSeen



def test_register_saves_immediately_after_debounced_touch(tmp_path: Path) -> None:
    """register() is persistence-critical: it writes even right after a debounced touch."""
    path = tmp_path / "registry.json"
    reg = SerialRegistry(path)
    s1 = generate_serial()
    reg.touch(s1)  # first heartbeat auto-registers + saves
    assert path.exists()
    on_disk = _read_records(path)
    reg.touch(s1)  # within the debounce window -> no write
    assert _read_records(path) == on_disk
    s2 = generate_serial()
    reg.register(s2, nodePath="/obj/new")  # must persist immediately
    assert len(_read_records(path)) == len(on_disk) + 1
    reg2 = SerialRegistry(path)
    assert reg2.get(s2) is not None


