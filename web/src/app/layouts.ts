/**
 * Named default layouts for the dockview docking system.
 * Default.json = the user's current Desk1 layout, versioned in the project folder
 * (web/src/app/layouts/Default.json) so every browser/session starts from the same
 * arrangement without depending on the bridge or Documents\Cyl1nder\Layouts.
 */
import DefaultLayout from "./layouts/Default.json";

export const DEFAULT_LAYOUT: unknown = DefaultLayout;
export const DEFAULT_LAYOUT_NAME = "Default";
