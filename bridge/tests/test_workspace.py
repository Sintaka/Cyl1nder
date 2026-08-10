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


def test_echo_identical_content_not_bumped() -> None:
    ws = WorkspaceStore()
    w = ws.get_or_create(SERIAL)
    buf = OutputBuffer(index=0, rev=0, pointCount=2, primCount=1,
                       points=[[0, 0, 0], [1, 0, 0]], curves=[{"pointIndices": [0, 1], "widths": None}])
    rev1, acc1 = w.put_outputs([buf])
    assert len(acc1) == 1 and rev1 >= 1
    # identical echo must NOT bump rev
    rev2, acc2 = w.put_outputs([buf.model_copy()])
    assert len(acc2) == 0 and rev2 == rev1
    # real change bumps
    buf2 = buf.model_copy(deep=True)
    buf2.points = [[0, 0, 0], [5, 5, 5]]
    rev3, acc3 = w.put_outputs([buf2])
    assert len(acc3) == 1 and rev3 > rev1
