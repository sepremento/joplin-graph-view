import joplin from "api";
import { SettingItemType } from "api/types";

export async function registerSettings() {
  const sectionName = "graph-ui.settings";
  await joplin.settings.registerSection(sectionName, {
    label: "Graph UI",
    // Check out https://forkaweso.me/Fork-Awesome/icons/ for available icons.
    iconName: "fas fa-sitemap",
  });

  await joplin.settings.registerSettings({
    MAX_NODES: {
      value: 5000,
      type: SettingItemType.Int,
      section: sectionName,
      public: true,
      label: "Max nodes in graph",
      description:
        "Maximum number of nodes shown in the graph. Most recent nodes have priority.",
    },
    QUERY: {
      value: "",
      type: SettingItemType.String,
      section: sectionName,
      public: false,
      label: "User query",
      description: "",
    },
    FILTER: {
      value: "",
      type: SettingItemType.String,
      section: sectionName,
      public: false,
      label: "User set filters",
      description: "",
    },
    GROUPS: {
      value: "",
      type: SettingItemType.Object,
      section: sectionName,
      public: false,
      label: "Colored groups",
      description: "",
    },
    MAX_TREE_DEPTH: {
      value: 2,
      type: SettingItemType.Int,
      minimum: -1,
      section: sectionName,
      public: false,
      label: "Max degree of separation",
      description:
        "Maximum number of link jumps from selected note. Set to -1 (displayed as G) to show all notes. Zero shows only the selected note.",
    },
    SCOPE_TO_NOTEBOOK: {
      value: false,
      type: SettingItemType.Bool,
      section: sectionName,
      public: true,
      label: "Scope to current notebook",
      description: "When enabled, only notes from the currently open notebook are shown.",
    },
    SHOW_TAG_NODES: {
      value: true,
      type: SettingItemType.Bool,
      section: sectionName,
      public: true,
      label: "Show tag nodes",
      description: "When enabled, tags appear as nodes in the graph.",
    },
    SHOW_TAGS: {
      value: true,
      type: SettingItemType.Bool,
      section: sectionName,
      public: true,
      label: "Color nodes by tag",
      description:
        "When enabled, note nodes are colored based on their first tag.",
    },
    INCLUDE_BACKLINKS: {
      value: true,
      type: SettingItemType.Bool,
      section: sectionName,
      public: true,
      label: "Include backlinks into the graph",
      description:
        "Backlinks refer to links from other notes",
    },
    CHARGE_STRENGTH: {
      advanced: true,
      value: 20,
      type: SettingItemType.Int,
      section: sectionName,
      public: true,
      label: "Electric charge force strength",
      description:
        "Positive number defines gravity for nodes, negative number defines electric charge repulsion for nodes",
    },
    CENTER_STRENGTH: {
      advanced: true,
      value: 100,
      type: SettingItemType.Int,
      section: sectionName,
      public: true,
      label: "Center force strength",
      description:
        "How strong nodes try to reach the center.",
    },
    COLLIDE_RADIUS: {
      advanced: true,
      value: 48,
      type: SettingItemType.Int,
      section: sectionName,
      public: true,
      label: "Collide force radius",
      description:
        "You can't move two nodes closer together than this setting.",
    },
    LINK_DISTANCE: {
      advanced: true,
      value: 200,
      type: SettingItemType.Int,
      section: sectionName,
      public: true,
      label: "Link force distance",
      description:
        "The desired distance between nodes.",
    },
    MAX_TEXT_WIDTH: {
      advanced: true,
      value: 180,
      type: SettingItemType.Int,
      section: sectionName,
      public: false,
      label: "Maximum width of the node text",
      description:
        "",
    },
    ALPHA: {
      advanced: true,
      value: 30,
      type: SettingItemType.Int,
      section: sectionName,
      public: true,
      label: "Alpha Target",
      description:
        "The higher this setting the slower and the better the simulation will converge.",
    },
    CLUSTER_BY_HOP: {
      value: false,
      type: SettingItemType.Bool,
      section: sectionName,
      public: true,
      label: "Cluster by hop distance",
      description: "Arrange nodes in rings by link distance from the selected note.",
    },
    HOP_RING_SPACING: {
      advanced: true,
      value: 150,
      type: SettingItemType.Int,
      minimum: 50,
      maximum: 600,
      section: sectionName,
      public: true,
      label: "Hop ring spacing (px)",
      description: "Distance between hop rings when cluster mode is active.",
    },
  });
}
