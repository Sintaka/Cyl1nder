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
