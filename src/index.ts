import joplin from "api";
import * as joplinData from "./data";
import { parseTimelineEvents } from "./timeline-data";
import { registerSettings } from "./settings";
import { ColorGroup, DataSpec, GraphData } from "./model";
import { ContentScriptType, MenuItemLocation, ToolbarButtonLocation } from "api/types";
import { panelHtml } from "./panel-html";

let data: GraphData;
let nodeGroupMap = new Map();
let pollCb: any;
let modelChanges = [];
var prevNoteLinks = [];
var prevNoteTitle: string;
var prevSettings: any = {};
var syncOngoing = false;
const USER_INPUT = new Set(["QUERY", "FILTER", "MAX_TREE_DEPTH", "SHOW_TAGS", "SHOW_TAG_NODES", "GROUPS", "INCLUDE_BACKLINKS", "SCOPE_TO_NOTEBOOK"])


joplin.plugins.register({
    onStart: async function () {
        await registerSettings();
        const panels = joplin.views.panels;
        const graphPanel = await (panels as any).create("note-graph-view");

        await registerShowHideCommand(graphPanel);

        // Build Panel
        await drawPanel(graphPanel);
        await panels.addScript(graphPanel, "./webview.css");
        await panels.addScript(graphPanel, "./ui/index.js");

        panels.onMessage(graphPanel, processWebviewMessage);

        await joplin.contentScripts.register(
            ContentScriptType.CodeMirrorPlugin,
            'noteLinker',
            './editor/noteLinker.js'
        );
        await joplin.contentScripts.onMessage('noteLinker', async (message) => {
            if (message.action !== 'searchNotes') return [];
            const query = (message.query || '').trim();
            if (query) {
                const results = await joplin.data.get(['search'], {
                    query: query,
                    fields: ['id', 'title'],
                    limit: 10,
                });
                return results.items || [];
            } else {
                const results = await joplin.data.get(['notes'], {
                    fields: ['id', 'title'],
                    order_by: 'updated_time',
                    order_dir: 'DESC',
                    limit: 10,
                });
                return results.items || [];
            }
        });

        // Setup callbacks
        await joplin.workspace.onNoteChange(async (ev) => {
            if (ev.event === 2) updateUI("noteChange", ev.id);
        });
        await joplin.workspace.onNoteSelectionChange(async () => {
            updateUI("noteSelectionChange");
        });
        await joplin.workspace.onSyncStart(async () => {
            syncOngoing = true;
        });
        await joplin.workspace.onSyncComplete(async () => {
            syncOngoing = false;
            updateUI("syncComplete");
        });
        await joplin.settings.onChange(async (ev) => {
            if (!USER_INPUT.has(ev.keys[0]))
                updateUI("pushSettings");
        });
    },
});

async function collectGraphSettings() {
    return await joplin.settings.values([
        'FILTER', 'MAX_TREE_DEPTH', 'QUERY', 'SHOW_TAGS', 'SHOW_TAG_NODES', 'INCLUDE_BACKLINKS', 'GROUPS',
        'ALPHA', 'CENTER_STRENGTH', 'CHARGE_STRENGTH', 'COLLIDE_RADIUS', 'LINK_DISTANCE',
        'MAX_TEXT_WIDTH', 'SCOPE_TO_NOTEBOOK'
    ]);
}

async function fetchData(spec: DataSpec) {
    const fetchForNoteIds: Array<string> = [];

    if (typeof(spec.spanningTree) === "undefined") {
        const selectedNoteIds = await joplin.workspace.selectedNoteIds();
        fetchForNoteIds.push(...selectedNoteIds);
    } else {
        for (const noteId of spec.spanningTree) {
            fetchForNoteIds.push(noteId); 
        }
    }

    let notebookId: string | undefined;
    const scopeToNotebook = await joplin.settings.value("SCOPE_TO_NOTEBOOK");
    if (scopeToNotebook) {
        const selectedFolder = await joplin.workspace.selectedFolder();
        notebookId = selectedFolder?.id;
    }

    const nodes = await joplinData.getNodes(
        fetchForNoteIds,
        spec.degree,
        spec.filterQuery,
        notebookId
    );

    const data: GraphData = {
        nodes: [],
        edges: [],
        spanningTree: fetchForNoteIds,
        graphSettings: {}
    };

    for (let [id, node] of nodes.entries()) {
        for (let link of node.forwardlinks) {
            // Slice note link if link directs to an anchor
            var index = link.indexOf("#");
            if (index != -1) { link = link.substr(0, index); }

            // The destination note could have been deleted.
            const linkDestExists = nodes.has(link);

            if (!linkDestExists) { continue; }

            data.edges.push({
                source: id,
                target: link,
            });
        }

        data.nodes.push({
            id: id,
            title: node.title,
            color: node.color || "",
            faded: false,
            focused: false,
            is_tag: node.is_tag,
            num_links: node.num_links,
            num_forwardlinks: node.num_forwardlinks,
            num_backlinks: node.num_backlinks,
            distanceToCurrentNode: node.distanceToCurrentNode,
            body_size: node.body_size || 0
        });

    }
    return data;
}

function notifyUI() {
    // resolves Promise created in processWebviewMessage and sends a message back
    // to the WebView;

    if (pollCb && modelChanges.length > 0) {
        let modelChange = modelChanges.shift();
        pollCb(modelChange);
        pollCb = undefined;
    }
}

async function drawPanel(panel: any) {
    await joplin.views.panels.setHtml(panel, panelHtml);
}

async function registerShowHideCommand(graphPanel: any) {
    // Register Show/Hide Graph Command and also create a toolbar button for this
    // command and a menu item.

    const panels = joplin.views.panels;

    await joplin.commands.register({
        name: "showHideGraphUI",
        label: "Show/Hide Graph View",
        iconName: "fas fa-sitemap",
        execute: async () => {
            const isVisible = await (panels as any).visible(graphPanel);
            (panels as any).show(graphPanel, !isVisible);
        },
    });

    await joplin.views.toolbarButtons.create(
        "graphUIButton",
        "showHideGraphUI",
        ToolbarButtonLocation.NoteToolbar
    );

    await joplin.views.menuItems.create(
        "showOrHideGraphMenuItem",
        "showHideGraphUI",
        MenuItemLocation.View,
        { accelerator: "F8" }
    );
}

async function processWebviewMessage(message: any) {
    let promise: Promise<Object>;
    switch (message.name) {
        case "poll":
            promise = new Promise((resolve) => { pollCb = resolve; });
            if (message.msg === "init") {
                updateUI("initialCall");
            } else {
                notifyUI();
            }
            return promise;
        case "open_note":
            return await joplin.commands.execute("openNote", message.id);
        case "open_tag":
            return await joplin.commands.execute("openTag", message.id);
        case "set_setting":
            if (message.key === "GROUPS") {
                updateUI("colorsChange");
            } else if (USER_INPUT.has(message.key)) {
                updateUI("noteSelectionChange");
            } else {
                updateUI("pushSettings");
            }
            return await joplin.settings.setValue(message.key, message.value);
        case "refresh_graph":
            updateUI("noteSelectionChange");
            return;
        case "get_timeline":
            return await getTimelineData();
    }
}

async function updateUI(eventName: string, changedNoteId?: string) {
    //during sync do nothing;
    if (syncOngoing) { return; }

    let resp = {};
    const maxDegree = await joplin.settings.value("MAX_TREE_DEPTH");
    const graphSettings = await collectGraphSettings()

    // Speed up the inital load by skipping the eventName switch.
    if (!data || eventName === "initialCall") {
        const selectedNote = await joplin.workspace.selectedNote();

        data = await fetchData({degree: maxDegree});
        data.graphSettings = graphSettings;
        prevSettings = Object.assign({}, graphSettings);

        eventName = "initialGraph";
        prevNoteTitle = selectedNote.title;
        nodeGroupMap = await joplinData.buildNodeGroupMap(graphSettings.GROUPS as Map<string, ColorGroup>);

    } else if (eventName === "noteChange") {
        const selectedNote = await joplin.workspace.selectedNote();

        // If a linked note (not the selected one) changed and is in the current
        // graph, refetch so edges to/from it stay current.
        if (changedNoteId && changedNoteId !== selectedNote.id) {
            if (data && data.nodes.some(n => n.id === changedNoteId)) {
                eventName += ":links";
                data = await fetchData({
                    degree: maxDegree,
                    filterQuery: graphSettings.FILTER as string,
                });
            } else {
                eventName += ":other";
            }
        } else {
            const noteLinks = Array.from(joplinData.getAllLinksForNote(selectedNote.body));

            if (selectedNote.title !== prevNoteTitle) {

                prevNoteTitle = selectedNote.title;
                eventName += ":title";

                resp = {
                    updateType: "updateNodeTitle",
                    noteId: selectedNote.id,
                    newTitle: selectedNote.title
                };

            } else if (!arraysEqual(noteLinks, prevNoteLinks)) {

                prevNoteLinks = noteLinks;
                eventName += ":links";
                data = await fetchData({
                    degree: maxDegree,
                    filterQuery: graphSettings.FILTER as string,
                });

            } else {

                eventName += ":other";
            }
        }

    } else if (eventName === "noteSelectionChange") {
        let selectedNoteIds: string[];
        const query = (graphSettings.QUERY as string).trim()

        if (query) {
            const searchResult = await joplinData.executeSearch(query);
            selectedNoteIds = searchResult.map(n => n.id);

        } else {
            selectedNoteIds = await joplin.workspace.selectedNoteIds();
        }

        if (selectedNoteIds.length === 1) {
            const newSelectedNote = await joplin.workspace.selectedNote();

            data.spanningTree = [newSelectedNote.id];
            prevNoteTitle = newSelectedNote.title;
            prevNoteLinks = Array.from(joplinData.getAllLinksForNote(newSelectedNote.body));
        } else {
            data.spanningTree = selectedNoteIds;
            prevNoteTitle = undefined;
            prevNoteLinks = undefined;
        }

        data = await fetchData({
            degree: graphSettings.MAX_TREE_DEPTH as number,
            spanningTree: data.spanningTree,
            filterQuery: graphSettings.FILTER as string
        });
        data.graphSettings = graphSettings;
        prevSettings = Object.assign({}, graphSettings);
    } else if (eventName === "colorsChange") {
        // don't need to fetch new nodes, just update node to color map and
        // update nodes
        const change = getGroupChange(graphSettings.GROUPS, prevSettings.GROUPS);
        const action = change.action, groupName = change.group;

        if (action === "add" || action === "filter") {
            const groupFilter = graphSettings.GROUPS[groupName].filter;
            const searchResult = await joplinData.executeSearch(groupFilter);
            const nodeIds = searchResult.map(({ id }) => id)
            const nodeColorMap = new Map();

            for (let nodeId of nodeIds) {
                nodeColorMap.set(nodeId, graphSettings.GROUPS[groupName].color);
            }
            nodeGroupMap.set(groupName, nodeColorMap);
        } else if (action === "color") {
            const group = nodeGroupMap.get(groupName)
            for (const key of group.keys()) {
                group.set(key, graphSettings.GROUPS[groupName].color);
            }
        } else if (action === "remove") {
            nodeGroupMap.delete(groupName);
        }
        data.graphSettings = graphSettings;
        prevSettings = Object.assign({}, graphSettings);

    } else if (eventName === "pushSettings") {
        if (JSON.stringify(graphSettings) === JSON.stringify(prevSettings)) return;
        data.graphSettings = graphSettings;
        prevSettings = Object.assign({}, graphSettings);
    }

    for (let node of data.nodes) {
        for (let [_, nodeColorMap] of nodeGroupMap.entries())
            if (nodeColorMap.has(node.id)) node.color = nodeColorMap.get(node.id);
    }

    modelChanges.push({ name: eventName, data: data, resp: resp});
    notifyUI();
}

async function getTimelineData(): Promise<object> {
    const selectedNote = await joplin.workspace.selectedNote();
    if (!selectedNote) return { events: [], rootNoteId: '' };

    const events = parseTimelineEvents(selectedNote.id, selectedNote.title, selectedNote.body);

    const linkedIds = Array.from(joplinData.getAllLinksForNote(selectedNote.body));
    if (linkedIds.length > 0) {
        const linkedNotes = await joplinData.getNoteArray(linkedIds);
        for (const note of linkedNotes)
            events.push(...parseTimelineEvents(note.id, note.title, note.body));
    }

    events.sort((a, b) => a.start.localeCompare(b.start));
    return { events, rootNoteId: selectedNote.id };
}

function getGroupChange(cur: any, prev: any) {
    for (let key in cur) {
        if (!(key in prev)) return { action: "add", group: key };
        if (cur[key].filter !== prev[key].filter) return { action: "filter", group: key };
        if (cur[key].color !== prev[key].color) return { action: "color", group: key };
    }
    for (let key in prev) {
        if (!(key in cur)) return { action: "remove", group: key };
    };
    return { action: "other" }
}

function arraysEqual(arr1: Array<string>, arr2: Array<string>): boolean {
    if (arr1.length !== arr2.length) return false;
    const sortedArr1 = arr1.sort();
    const sortedArr2 = arr2.sort();
    return sortedArr1.every((val, idx) => val === sortedArr2[idx]);
}

