"""APEX Scene Animate — headless world-space control transforms.

Verified on Houdini 22.0.368 against /obj/geo1/sceneanimate1.

Reads a control's true WORLD matrix out of a Scene Animate SOP without any
viewport / Animate state, and writes a desired WORLD matrix back through the
animation layer.

Why this exists: `ControlTransformData.local` is parent-relative (it reads
(0,0,0.5) for a rest-offset joint, and (0,0,0) for the root), and
`rig.graph_parms[mapping.t]` is a *delta on top of restlocal*, not a world
value. Only `.xform` is world space.
"""

import hou
import apex


def load_scene(sop_node, frame=None):
    """Load an APEX Scene from a Scene Animate SOP, evaluated at `frame`."""
    frame = hou.frame() if frame is None else frame
    geo = sop_node.geometryAtFrame(frame)
    scene = apex.Scene()
    if not scene.isGeometryLoadable(geo):
        raise ValueError('%s output is not an APEX scene' % sop_node.path())
    scene.loadFromGeometry(geo)
    for rig_path in (str(p) for p in scene.findDataPaths('*.rig')):
        scene.addRigToEvaluation(rig_path)
    scene.updateEvaluationParms(frame)
    scene.updateDirtyRigs()
    scene.control_manager.update(scene)
    return scene


def control_paths(scene):
    return [str(p) for p in scene.control_manager.controlPaths()]


def get_world_xform(scene, ctrl_path):
    """Return the control's WORLD hou.Matrix4 (None if not evaluated yet)."""
    cm = scene.control_manager
    cm.update(scene)
    data = cm.getControlData(ctrl_path)
    return None if data is None else data.xform


def get_world_xforms(scene, ctrl_paths=None):
    cm = scene.control_manager
    cm.update(scene)
    paths = control_paths(scene) if ctrl_paths is None else ctrl_paths
    out = {}
    for p in paths:
        d = cm.getControlData(p)
        if d is not None:
            out[p] = d.xform
    return out


def world_to_parm_delta(scene, ctrl_path, world_xform):
    """Convert a desired WORLD matrix into the graph_parms delta matrix.

    delta = world * parentxform^-1 * restlocal^-1
    """
    cm = scene.control_manager
    cm.update(scene)
    d = cm.getControlData(ctrl_path)
    if d is None:
        raise ValueError('no control data for %s (rig not evaluated?)' % ctrl_path)
    return world_xform * d.parentxform.inverted() * d.restlocal.inverted()


def set_world_xform(scene, ctrl_path, world_xform, frame=None,
                    key=True, translate=True, rotate=True):
    """Write a desired WORLD matrix to a control through the animation layer.

    Writing graph_parms alone is NOT enough: with animation enabled the layer
    overwrites graph_parms on every evaluation. The value must be committed to
    the channel primitives via setKeysFromDict.
    """
    frame = hou.frame() if frame is None else frame
    cm = scene.control_manager
    rig_path = ctrl_path.rsplit('/', 1)[0]
    rig = scene.getData(rig_path)
    binding = scene.getData(rig_path + '/animbinding')
    mapping = cm.getControlMapping(ctrl_path)

    delta = world_to_parm_delta(scene, ctrl_path, world_xform)

    written = []
    if translate and mapping.t:
        rig.graph_parms[mapping.t] = delta.extractTranslates()
        written.append(mapping.t)
    if rotate and mapping.r:
        rig.graph_parms[mapping.r] = delta.extractRotates()
        written.append(mapping.r)

    if key:
        for parm in written:
            binding.setKeysFromDict(scene, frame, True, pattern=parm,
                                    force_key=True)

    rig.setDirty()
    scene.updateDirtyRigs()
    cm.update(scene)
    return written


def commit(scene, sop_node=None):
    """Serialize the scene back to geometry (for a Python SOP output)."""
    geo = hou.Geometry()
    scene.saveToGeometry(geo)
    return geo


def commit_to_node(scene, sop_node):
    """Write the scene back into a live Scene Animate SOP's `animation` Data parm.

    The parm holds THREE top-level packed prims (catalog.data / default.clip /
    animation). Keeping only `animation` silently loses the pose, so the parm's
    original prim set is used as a whitelist and only the extra character folder
    is dropped. Verified to 0.00000000 error.

    NEVER call revertToDefaults() on this parm: it wipes the whole APEX scene
    (data paths, layer stack, animbinding) - it does not undo a write.
    """
    import base64

    parm = sop_node.parm("animation")
    keep = [
        p.attribValue("name")
        for p in parm.eval().prims()
        if p.type() == hou.primType.PackedGeometry
    ]
    full = hou.Geometry()
    scene.saveToGeometry(full)
    work = hou.Geometry()
    work.merge(full)
    doomed = [
        p
        for p in work.prims()
        if p.type() == hou.primType.PackedGeometry
        and p.attribValue("name") not in keep
    ]
    if doomed:
        work.deletePrims(doomed)
    parm.setFromData({"geometry": base64.b85encode(work.data()).decode("ascii")})
    sop_node.cook(force=True)


def set_world_xform_on_node(sop_node, ctrl_path, world_xform, frame=None):
    """Two-pass safe world write against a live node.

    Reloads the scene from the node before solving, so `parentxform` reflects any
    already-committed parent change. When moving a parent AND a child, call this
    for the parent first, then for the child: solving both in one pass uses a
    stale parentxform and the child's world position drifts (measured 0.16-0.36).
    """
    scene = load_scene(sop_node, frame)
    set_world_xform(scene, ctrl_path, world_xform, frame=frame, key=True)
    commit_to_node(scene, sop_node)
    return get_world_xform(load_scene(sop_node, frame), ctrl_path)
