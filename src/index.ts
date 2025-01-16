import joplin from "api";
import * as joplinData from "./data";
import { registerSettings } from "./settings";
import { Edge, Node, GraphData, GraphSettings } from "./model";
import { MenuItemLocation, ToolbarButtonLocation } from "api/types";
var deepEqual = require("fast-deep-equal");

let data: GraphData;
let pollCb: any;
let modelChanges = [];
var prevNoteLinks = [];
var prevNoteTitle: string;
var syncOngoing = false;


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

        // Setup callbacks
        await joplin.workspace.onNoteChange(async () => {
            updateUI("noteChange");
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
            updateUI("pushSettings", ev);
        });
    },
});

async function collectGraphSettings() {
    return {
        maxDepth: await joplin.settings.value('MAX_TREE_DEPTH'),
        chargeStrength: await joplin.settings.value('CHARGE_STRENGTH'),
        centerStrength: await joplin.settings.value('CENTER_STRENGTH'),
        collideRadius: await joplin.settings.value('COLLIDE_RADIUS'),
        linkDistance: await joplin.settings.value('LINK_DISTANCE'),
        linkStrength: await joplin.settings.value('LINK_STRENGTH'),
        alpha: await joplin.settings.value('ALPHA'),
    }
}

async function fetchData(maxDegree, fetchForNotes?) {
    // Load settings
    const fetchForNoteIds: Array<string> = [];

    if (typeof(fetchForNotes) === "undefined") {
        const selectedNoteIds = await joplin.workspace.selectedNoteIds();
        fetchForNoteIds.push(...selectedNoteIds);
    } else {
        for (const note of fetchForNotes) {
            fetchForNoteIds.push(note.id); 
        }
    }

    const notes = await joplinData.getNotes(fetchForNoteIds, maxDegree);

    const data: GraphData = {
        nodes: [],
        edges: [],
        spanningTree: fetchForNoteIds,
        graphSettings: {}
    };

    for (let [id, note] of notes.entries()) {
        for (let link of note.links) {
            // Slice note link if link directs to an anchor
            var index = link.indexOf("#");
            if (index != -1) { link = link.substr(0, index); }

            // The destination note could have been deleted.
            const linkDestExists = notes.has(link);
            if (!linkDestExists) { continue; }

            data.edges.push({
                source: id,
                target: link,
            });

            // Mark nodes that are adjacent to the currently selected note.
            if (fetchForNoteIds.includes(id)) {
                notes.get(link).linkedToCurrentNote = true;
            } else if (fetchForNoteIds.includes(link)) {
                notes.get(id).linkedToCurrentNote = true;
            } else {
                const l = notes.get(link);
                l.linkedToCurrentNote = l.linkedToCurrentNote || false;
            }
        }

        data.nodes.push({
            id: id,
            title: note.title,
            parent_id: note.parent_id,
            folder: note.folder,
            distanceToCurrentNode: note.distanceToCurrentNote
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

async function drawPanel(panel) {
    await joplin.views.panels.setHtml(
        panel,
        `
<div class="graph-content">
<div id="container">
<div id="graph-handle">
<div class="drag-handle"></div>
<div id="cb1" class="control-block">
<label for="query-input">Query</label>
<input id="query-input" type="string"></input>
</div>
<div class="control-block">
<label for="distance-slider">Max. distance</label>
<input class="settings slider" id="distance-slider" class="slider" type="range" min="0" max="5" value="2"> </input>
<output id="distance-output">2</output>
</div>
<details>
<summary>Graph Parameters</summary>
<div class="force-block">
<label for="nocollide-radius-input">No Collide Radius</label>
<input class="settings" id="nocollide-radius-input" type="number"></input>
</div>
<div class="force-block">
<label for="link-distance-input">Link Distance</label>
<input class="settings" id="link-distance-input" type="number"></input>
</div>
<div class="force-block">
<label for="link-strength-input">Link Strength</label>
<input class="settings" id="link-strength-input" type="number"></input>
</div>
<div class="force-block">
<label for="charge-strength-input">Charge Strength</label>
<input class="settings" id="charge-strength-input" type="number"></input>
</div>
<div class="force-block">
<label for="center-strength-input">Center Strength</label>
<input class="settings" id="center-strength-input" type="number"></input>
</div>
<div class="control-block">
<label for="temperature-slider">Alpha Target</label>
<input class="settings slider" id="temperature-slider" type="range" class="slider" min="0" max="100" value="30"></input>
</div>
<div class="control-block">
<label for="center-strength-input">Backlinks</label>
<select id="center-strength-input" type="number">
<option value="backlinks-off">Backlinks Off</option>
<option value="backlinks-on">Backlinks On</option>
<option value="directed-graph">Directed Graph</option>
</select>
</div>
</details>
</div>
<div id="note_graph"/></div>
</div>
</div>
`
    );
}

async function registerShowHideCommand(graphPanel) {
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

async function processWebviewMessage(message) {
    let promise: Promise<Object>;
    switch (message.name) {
        case "poll":
            promise = new Promise((resolve) => { pollCb = resolve; });
            if (message.msg === "init") {
                updateUI("initialCall")
            } else {
                notifyUI();
            };
            return promise;
        case "request_update":
            promise = new Promise((resolve) => { pollCb = resolve; });
            updateUI("processRequestedUpdate", message);
            return promise;
        case "open_note":
            return joplin.commands.execute("openNote", message.id);
        case "set_setting":
            return await joplin.settings.setValue(message.key, message.value);
    }
}

async function executeSearchQuery(query, degree): Promise<GraphData> {
    let page = 1;
    const maxNotes = await joplin.settings.value("MAX_NODES")
    const maxDegree = Number(degree);
    const foundNotes = new Array();

    do {
        var notes = await joplin.data.get(['search'], {
            query: query,
            fields: ["id", "parent_id", "title", "body"],
            limit: maxNotes < 100 ? maxNotes : 100,
            page: page
        });

        foundNotes.push(...notes.items);
        page++;
    } while(notes.has_more && foundNotes.length < maxNotes);

    return fetchData(maxDegree, foundNotes);
}

async function updateUI(eventName: string, supplement?) {
    //during sync do nothing;
    if (syncOngoing) { return; }

    let resp = {};
    const maxDegree = await joplin.settings.value("MAX_TREE_DEPTH");
    const graphSettings = await collectGraphSettings()

    // Speed up the inital load by skipping the eventName switch.
    if (!data || eventName === "initialCall") {
        const selectedNote = await joplin.workspace.selectedNote();

        data = await fetchData(maxDegree);
        data.graphSettings = graphSettings;

        eventName = "initialGraph";
        prevNoteTitle = selectedNote.title;

    } else if (eventName === "noteChange") {
        // Don't update the graph is the links in this note haven't changed.
        const selectedNote = await joplin.workspace.selectedNote();
        const noteLinks = Array.from(joplinData.getAllLinksForNote(selectedNote.body));

        if (selectedNote.title !== prevNoteTitle) {

            prevNoteTitle = selectedNote.title;
            eventName += ":title";

            resp = {
                updateType: "updateNodeTitle",
                noteId: selectedNote.id,
                newTitle: selectedNote.title
            };

        } else if (!deepEqual(noteLinks, prevNoteLinks)) {

            prevNoteLinks = noteLinks;
            eventName += ":links";
            data = await fetchData(maxDegree);

        } else {

            eventName += ":other";
        }

    } else if (eventName === "noteSelectionChange") {
        const selectedNoteIds = await joplin.workspace.selectedNoteIds();
        const graphNoteIds = data.nodes.map(note => note.id);

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

        // if draw all notes already then most of the time no need to refetch;
        if (maxDegree == 0) {
            // but if selected note was not in the previous data then refetch
            if (!data.spanningTree.every(n => graphNoteIds.includes(n))) {
                data = await fetchData(maxDegree, data.spanningTree);
            }
        } else {
            data = await fetchData(maxDegree);
            data.graphSettings = graphSettings;
        }
    } else if (eventName === "processRequestedUpdate") {
        const query = supplement.query
        if (query) {
            data = await executeSearchQuery(query, supplement.degree)
        } else {
            data = await fetchData(supplement.degree);
        }
    } else if (eventName === "pushSettings") {
        data.graphSettings = graphSettings;
    }

    modelChanges.push({ name: eventName, data: data, resp: resp});
    notifyUI();
}

