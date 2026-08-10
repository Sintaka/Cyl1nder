/**
 * Named default layouts for the dockview docking system.
 * DESK1 = captured from the user's manually arranged layout (v0.1.00021):
 *   viewport top-left (large), log bottom-left, inspector top-right, graph bottom-right.
 * Restore priority: bridge file (user's latest) -> DESK1 (built-in default) -> fallback.
 */
export const DESK1_LAYOUT = {
  "grid": {
    "root": {
      "type": "branch",
      "data": [
        {
          "type": "branch",
          "orientation": "VERTICAL",
          "data": [
            {
              "type": "leaf",
              "data": {
                "views": [
                  "viewport"
                ],
                "activeView": "viewport",
                "id": "2"
              },
              "size": 722
            },
            {
              "type": "leaf",
              "data": {
                "views": [
                  "log"
                ],
                "activeView": "log",
                "id": "4"
              },
              "size": 255
            }
          ],
          "size": 1492
        },
        {
          "type": "branch",
          "orientation": "VERTICAL",
          "data": [
            {
              "type": "leaf",
              "data": {
                "views": [
                  "inspector"
                ],
                "activeView": "inspector",
                "id": "3"
              },
              "size": 488
            },
            {
              "type": "leaf",
              "data": {
                "views": [
                  "graph"
                ],
                "activeView": "graph",
                "id": "1"
              },
              "size": 360
            },
            {
              "type": "leaf",
              "data": {
                "views": [
                  "spreadsheet"
                ],
                "activeView": "spreadsheet",
                "id": "5"
              },
              "size": 200
            }
          ],
          "size": 667
        }
      ],
      "size": 977
    },
    "width": 2159,
    "height": 977,
    "orientation": "HORIZONTAL"
  },
  "panels": {
    "graph": {
      "id": "graph",
      "contentComponent": "graph",
      "title": "Node Graph"
    },
    "viewport": {
      "id": "viewport",
      "contentComponent": "viewport",
      "title": "Viewport"
    },
    "inspector": {
      "id": "inspector",
      "contentComponent": "inspector",
      "title": "Inspector"
    },
    "log": {
      "id": "log",
      "contentComponent": "log",
      "title": "Log"
    },
    "spreadsheet": {
      "id": "spreadsheet",
      "contentComponent": "spreadsheet",
      "title": "Spreadsheet"
    }
  },
  "activeGroup": "2"
};

export const DEFAULT_LAYOUT_NAME = "Desk1";
