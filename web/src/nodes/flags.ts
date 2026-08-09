/** Node flag model (Houdini SOP style): display / bypass / freeze / wireframe.
 *  Stored on the X6 node via getData()/setData(); styling derived from flags. */
export interface NodeFlags {
  display: boolean;   // show this node's geometry in the 3D viewport
  bypass: boolean;    // dashed outline, node is skipped (data flows through)
  freeze: boolean;    // locked: no editing / no data changes
  wireframe: boolean; // render the node's geometry as a wireframe reference
}

export const DEFAULT_FLAGS: NodeFlags = {
  display: true,
  bypass: false,
  freeze: false,
  wireframe: false,
};

export const FLAG_LABELS: Record<keyof NodeFlags, string> = {
  display: "Display",
  bypass: "Bypass",
  freeze: "Freeze",
  wireframe: "Wireframe",
};

export function isFrozen(f: NodeFlags): boolean {
  return f.freeze;
}

