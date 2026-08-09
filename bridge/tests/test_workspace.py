from bridge.protocol import InputPayload, OutputBuffer
from bridge.workspace import WorkspaceStore

SERIAL = "C1-aaaaaaaa-bbbb"


def test_inputs_rev_increments() -> None:
    ws = WorkspaceStore()
    w = ws.get_or_create(SERIAL)
    assert w.input_rev == 0
    w.set_inputs([InputPayload(index=0, pointCount=3)])
    assert w.input_rev == 1
    w.set_inputs([])
    assert w.input_rev == 2


def test_outputs_rev_monotonic_and_since() -> None:
    ws = WorkspaceStore()
    w = ws.get_or_create(SERIAL)
    w.put_outputs([OutputBuffer(index=0, rev=0, points=[[0, 0, 0]])])
    r1 = w.output_rev()
    assert r1 >= 1
    w.put_outputs([OutputBuffer(index=0, rev=0, points=[[1, 0, 0]])])
    assert w.output_rev() > r1
    changed = w.get_outputs_since(r1)
    assert len(changed) == 1
    assert changed[0].points == [[1, 0, 0]]
    # nothing changed since current rev
    assert w.get_outputs_since(w.output_rev()) == []


def test_outputs_per_index_independent() -> None:
    ws = WorkspaceStore()
    w = ws.get_or_create(SERIAL)
    w.put_outputs([OutputBuffer(index=1, rev=0, points=[[0, 0, 0]])])
    w.put_outputs([OutputBuffer(index=2, rev=0, points=[[5, 5, 5]])])
    changed = w.get_outputs_since(0)
    assert sorted(b.index for b in changed) == [1, 2]
