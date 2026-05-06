import * as d3 from "d3";
import * as userInput from "./user-input.ts"

var width = window.innerWidth;
var height = window.innerHeight;

window.onresize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
}


// first functions are for communication with the plugin

async function poll(msg) {
    const resp = await webviewApi.postMessage({ name: "poll", msg: msg })
    if (resp.name === "initialGraph") graph.init(resp.data);
    if (resp.name === "pushSettings") graph.updateSettings(resp.data);
    if (resp.name === "noteChange:title") graph.updateNodeLabel(resp.resp);
    if (resp.name === "noteChange:links"
        || resp.name === "noteSelectionChange"
        || resp.name === "colorsChange")
        graph.updateGraph(resp.data);
    if ((resp.name === "noteSelectionChange" || resp.name === "initialGraph") && activeView === "timeline")
        loadTimeline();
    poll();
}

function setSetting(settingName, newVal) {
    // will automically trigger ui update of graph
    return webviewApi.postMessage({
        name: "set_setting",
        key: settingName,
        value: newVal,
    });
}

function refreshGraph() {
    return webviewApi.postMessage({ name: "refresh_graph" });
}

// next graph functions

function throttle(func, limit) {
    let lastCall = 0;
    return function(...args) {
        const now = Date.now();
        if (now - lastCall >= limit) {
            func.apply(this, args);
            lastCall = now;
        }
    };
}

function createGraph() {

    const canvas = d3.select('#note_graph')
    .append('canvas')
    .attr("width", width)
    .attr("height", height)
    .node();

    const context = canvas.getContext('2d');

    let graphNodes = [];
    let graphNodesMap = new Map();
    let graphLinks = [];
    let spanningTree = [];
    let graphSettings = {};

    let simulation;
    let transform;
    let timer;
    let zoom;

    d3.select('#center-graph-btn').on('click', centerGraph);

    function dragstarted(event) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
    };

    function dragged(event) {
        const [px, py] = d3.pointer(event, canvas);
        event.subject.fx = transform.invertX(px);
        event.subject.fy = transform.invertY(py);
    };

    function dragended(event) {
        if (!event.active) simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
    };

    function drawNode(node) {
        let r = node.is_tag ? 12 : Math.max(4, Math.min(24, 3 + Math.log((node.body_size || 1) + 1) * 1.8));
        context.beginPath();
        context.globalAlpha = 1;
        context.strokeStyle = "#999";
        context.fillStyle = "#999";
        context.lineWidth = 1.0;
        if (spanningTree.includes(node.id)) {
            context.fillStyle = "#595";
        }

        if (node.focused) {
            context.strokeStyle = "#595";
            context.fillStyle = "#595";
        }

        if (node.faded) {
            context.globalAlpha = 0.5;
            context.fillStyle = "#A0A0A0";
            context.strokeStyle = "#A0A0A0";
        }

        if (node.is_tag) {
            context.fillStyle = "#834983";
        }

        if (node.color) {
            context.fillStyle = node.color;
        }

        context.moveTo(node.x + r, node.y);
        context.arc(node.x, node.y, r, 0, 2 * Math.PI);
        context.fill();
        if (transform.k >= 0.7) {
            wrapNodeText(context, node, r, graphSettings.MAX_TEXT_WIDTH);
        }
        context.stroke();
    };

    function drawLink(link) {
        context.beginPath();        
        context.globalAlpha = 0.1;
        context.strokeStyle = "#999";

        if (link.focused) {
            context.globalAlpha = 0.8;
        }

        if (link.faded) {
            context.globalAlpha = 0.05;
        }

        if (transform.k <= 0.7 && !(link.focused || link.faded)) return;

        const x1 = link.source.x,
        x2 = link.target.x,
        y1 = link.source.y,
        y2 = link.target.y;
        const arrowLen = 10;
        const depth = link.target.distanceToCurrentNode
            ? link.target.distanceToCurrentNode
            : 0;
        const offset = Math.max(10 - 3 * depth, 4);
        const lineLength = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const xa = x2 - (offset / lineLength) * (x2 - x1);
        const ya = y2 - (offset / lineLength) * (y2 - y1);
        const angle = Math.atan2(y2 - y1, x2 - x1);

        context.moveTo(x1, y1);
        context.lineTo(x2, y2);

        // Конечная точка стрелки
        context.moveTo(xa, ya);

        // Линия стрелки (левое крыло)
        context.lineTo(
            xa - arrowLen * Math.cos(angle - Math.PI / 6),
            ya - arrowLen * Math.sin(angle - Math.PI / 6)
        );

        // Линия стрелки (правое крыло)
        context.moveTo(xa, ya);
        context.lineTo(
            xa - arrowLen * Math.cos(angle + Math.PI / 6),
            ya - arrowLen * Math.sin(angle + Math.PI / 6)
        );
        context.stroke();
    };
    
    const throttledDraw = throttle(draw, 20);

    function draw() {
        context.clearRect(0, 0, width, height);

        context.save();

        context.translate(transform.x, transform.y);
        context.scale(transform.k, transform.k);

        graphLinks.forEach(drawLink);

        const postponedNodes = [];
        for (const d of graphNodes) {
            if (d.focused) { 
                postponedNodes.push(d);
                continue; 
            }
            drawNode(d);
        }
        postponedNodes.forEach(drawNode)

        context.restore();
    };

    function findNode(event, nodes) {
        const [px, py] = d3.pointer(event, canvas);
        const xi = transform.invertX(px);
        const yi = transform.invertY(py);
        const node = d3.least(nodes, ({x, y}) => {
            const dist2 = (x - xi) ** 2 + (y - yi) ** 2;
            if (dist2 < 400) return dist2;
        });
        if (node) {
            node.px = px;
            node.py = py;
        }
        return node;
    };

    function highlightRegion(event) {
        clearTimeout(timer);
        timer = setTimeout(() => {
            const node = findNode(event, graphNodes);
            if (!node) {
                for (let link of graphLinks) {
                    link.focused = false;
                    link.faded = false;
                }
                for (let node of graphNodes) {
                    node.focused = false;
                    node.faded = false;
                }
            } else {
                const adjacentNodes = [node.id];
                for (let link of graphLinks) {
                    if (link.source.id === node.id || link.target.id === node.id) {
                        link.faded = false;
                        link.focused = true;
                        adjacentNodes.push(link.target.id);
                        adjacentNodes.push(link.source.id);
                    } else {
                        link.faded = true;
                        link.focused = false;
                    }
                }
                for (let n of graphNodes) {
                    if (adjacentNodes.includes(n.id)) {
                        n.faded = false;
                        n.focused = true;
                    } else {
                        n.faded = true;
                        n.focused = false;
                    }
                }
            }

            simulation.nodes(graphNodes);
            simulation.force("link").links(graphLinks);
            draw();
        }, 85)
    };

    function initSimulation() {
        const clusterMode = !!graphSettings.CLUSTER_BY_HOP;
        const ringSpacing = graphSettings.HOP_RING_SPACING || 150;
        const cx = width / 2, cy = height / 2;

        const hopDistances = graphNodes
            .map(n => n.distanceToCurrentNode)
            .filter(d => d !== undefined && isFinite(d));
        const maxHop = hopDistances.length > 0 ? Math.max(...hopDistances) : 0;
        const fallbackRadius = (maxHop + 1) * ringSpacing;

        const sim = d3.forceSimulation(graphNodes)
            .force("link", d3.forceLink(graphLinks)
                .id(d => d.id)
                .distance(graphSettings.LINK_DISTANCE)
                .strength(link => {
                    if (!clusterMode) return 1;
                    return link.isBidirectional ? 2.0 : 0.5;
                })
            )
            .force("charge", d3.forceManyBody()
                .strength(graphSettings.CHARGE_STRENGTH)
            )
            .force("nocollide", d3.forceCollide(graphSettings.COLLIDE_RADIUS))
            .alpha(graphSettings.ALPHA / 100)
            .on("tick", throttledDraw);

        if (clusterMode) {
            sim.force("posX", d3.forceX(cx).strength(d =>
                d.distanceToCurrentNode === 0 ? 0.8 : 0
            ));
            sim.force("posY", d3.forceY(cy).strength(d =>
                d.distanceToCurrentNode === 0 ? 0.8 : 0
            ));
            sim.force("radial", d3.forceRadial(d => {
                const dist = d.distanceToCurrentNode;
                if (dist === 0) return 0;
                if (dist === undefined || !isFinite(dist)) return fallbackRadius;
                return dist * ringSpacing;
            }, cx, cy).strength(0.6));
        } else {
            sim.force("posX", d3.forceX(cx)
                .strength(graphSettings.CENTER_STRENGTH / 100)
            );
            sim.force("posY", d3.forceY(cy)
                .strength(graphSettings.CENTER_STRENGTH / 100)
            );
            sim.force("radial", null);
        }

        return sim;
    };

    function navigateTo(event) {
        const node = findNode(event, graphNodes);
        if (!node) return;
        const command = node.is_tag ? "open_tag" : "open_note";
        webviewApi.postMessage({
            name: command,
            id: node.id
        });
    };

    function centerGraph() {
        const xCoords = graphNodes.map(node => node.x);
        const yCoords = graphNodes.map(node => node.y);
        const bottoms = graphNodes.map(node => node.textLowEdge);

        const minX = Math.min(...xCoords) - graphSettings.MAX_TEXT_WIDTH / 2;
        const maxX = Math.max(...xCoords) + graphSettings.MAX_TEXT_WIDTH / 2;
        const minY = Math.min(...yCoords) - 30;
        const maxY = Math.max(...bottoms) + 30;

        const graphWidth = maxX - minX;
        const graphHeight = maxY - minY;

        const scaleX = width / graphWidth;
        const scaleY = height / graphHeight;
        const k = Math.min(scaleX, scaleY);

        const centerGraphX = (minX + maxX) / 2;
        const centerGraphY = (minY + maxY) / 2;

        const centerViewportX = width / 2;
        const centerViewportY = height / 2;

        const x = centerViewportX - centerGraphX * k;
        const y = centerViewportY - centerGraphY * k;

        let centered = new d3.ZoomTransform(k, x, y);

        d3.select('canvas').transition()
            .duration(750)
            .call(zoom.transform, centered);
    }

    function wrapNodeText(context, d, r, width) {
        var text = d.title, lineHeight = 16,
        words = text.split(/\s+/).reverse(),
        word, line = [], len, N = 1,
        offset = r, lastLineLeftOffset;

        while (word = words.pop()) {
            line.push(word);
            len = context.measureText(line.join(" ")).width;
            if (len > width) {
                line.pop();
                context.fillText(line.join(" "), d.x - width / 2, d.y + offset + N * lineHeight);
                N += 1;
                line = [word]
                len = context.measureText(line.join(" ")).width;
            }
        }
        lastLineLeftOffset = N === 1 ? len : width;
        context.fillText(line.join(" "), d.x - lastLineLeftOffset / 2 , d.y + offset + N * lineHeight);
        d.textLowEdge = d.y + offset + N * lineHeight;
    }

    function zoomed(event) {
        transform = event.transform;
        draw();
    }

    function resetZoom() {
        d3.select('canvas').transition()
            .duration(750)
            .call(zoom.transform, d3.zoomIdentity);
    }

    return Object.assign(canvas, {

        graphInitialized: false,

        init(data) {

            if (this.graphInitialized) return;

            graphNodes = data.nodes;
            graphLinks = data.edges;
            graphSettings = data.graphSettings;
            spanningTree = data.spanningTree;

            userInput.initFront(graphSettings, setSetting, refreshGraph);

            for (let node of graphNodes) graphNodesMap.set(node.id, node);

            transform = d3.zoomIdentity;
            simulation = initSimulation();

            zoom = d3.zoom().scaleExtent([1/10, 8]).on('zoom', zoomed)

            d3.select(canvas)
                .on('mousemove', highlightRegion)
                .on('click', navigateTo)
                .call(d3.drag()
                    .subject(event => findNode(event, graphNodes))
                    .on("start", dragstarted)
                    .on("drag", dragged)
                    .on("end", dragended))
                .call(zoom);

            this.graphInitialized = true;
        },

        updateGraph(data) {
            if (!simulation) { simulation = initSimulation(); }
            if (!transform) { transform = d3.zoomIdentity; }

            simulation.stop();

            graphNodes = data.nodes.map(d => {
                if (!graphNodesMap.has(d.id)) graphNodesMap.set(d.id, d);
                return Object.assign(graphNodesMap.get(d.id) || {}, d);
            });
            graphLinks = data.edges;
            spanningTree = data.spanningTree;

            if (graphSettings.CLUSTER_BY_HOP) {
                simulation = initSimulation();
            } else {
                if (!simulation) simulation = initSimulation();
                simulation.nodes(graphNodes);
                simulation.force("link").links(graphLinks);
            }

            if (graphNodes.length < 20 && transform.k < 0.7) resetZoom();
            simulation.alpha(graphSettings.ALPHA / 100).restart();
        },

        updateNodeLabel(data) {
            const node = graphNodes.find((n) => n.id === data.noteId);
            if (!node) return;
            node.title = data.newTitle;

            if (transform.k > 0.7) draw();
        },

        updateSettings(data) {
            const wasCluster = !!graphSettings.CLUSTER_BY_HOP;
            graphSettings = Object.assign(graphSettings, data.graphSettings);
            userInput.setupGraphHandle(graphSettings);
            const isCluster = !!graphSettings.CLUSTER_BY_HOP;

            if (wasCluster !== isCluster || isCluster) {
                simulation.stop();
                simulation = initSimulation();
                simulation.alpha(graphSettings.ALPHA / 100).restart();
                return;
            }

            simulation.force("link").distance(graphSettings.LINK_DISTANCE);
            simulation.force("posX").strength(graphSettings.CENTER_STRENGTH / 100);
            simulation.force("posY").strength(graphSettings.CENTER_STRENGTH / 100);
            simulation.force("charge").strength(graphSettings.CHARGE_STRENGTH);
            simulation.force("nocollide").radius(graphSettings.COLLIDE_RADIUS);

            simulation.alpha(graphSettings.ALPHA / 100);
            simulation.restart();
        },
    });
}

// ── Timeline ──────────────────────────────────────────────────────────────────

function noteColor(noteId) {
    let hash = 0;
    for (let i = 0; i < noteId.length; i++) {
        hash = ((hash << 5) - hash) + noteId.charCodeAt(i);
        hash |= 0;
    }
    const hue = Math.abs(hash * 137) % 360;
    return `hsl(${hue}, 65%, 55%)`;
}

async function loadTimeline() {
    const container = document.getElementById("timeline_view");
    container.innerHTML = "";
    try {
        const data = await webviewApi.postMessage({ name: "get_timeline" });
        renderTimeline(data);
    } catch(e) {
        container.innerHTML = '<p style="color:red;padding:1em;">Error: ' + e.message + '</p>';
    }
}

function renderTimeline(data) {
    const container = document.getElementById("timeline_view");
    container.innerHTML = "";

    const events = (data && data.events) || [];
    if (events.length === 0) {
        container.innerHTML = '<p style="text-align:center;padding:2em;opacity:0.6;">No @date / @start events found in this note or its links.</p>';
        return;
    }

    const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));

    const seenNotes = new Set();
    const noteOrder = [];
    for (const ev of sorted) {
        if (!seenNotes.has(ev.noteId)) {
            noteOrder.push({ id: ev.noteId, title: ev.noteTitle });
            seenNotes.add(ev.noteId);
        }
    }

    const ROW_H  = 68;
    const DATE_W = 90;   // left column for date labels
    const TRUNK_X = 12;  // x of the vertical trunk line (within chart area)
    const M = { top: 32, right: 16, bottom: 24, left: DATE_W };
    const containerW = container.getBoundingClientRect().width || window.innerWidth || 600;
    const svgW  = Math.max(containerW - 4, 240);
    const svgH  = sorted.length * ROW_H + M.top + M.bottom;
    const chartW = svgW - M.left - M.right;

    const rangeSpans = new Map();
    sorted.forEach((ev, i) => {
        if (ev.type === "range" && ev.end) rangeSpans.set(i, ev.end);
    });

    const svg = d3.select(container).append("svg")
        .attr("width", svgW)
        .attr("height", svgH);


    // Legend at top
    const legendG = svg.append("g").attr("transform", `translate(${M.left + TRUNK_X + 20}, 10)`);
    noteOrder.forEach((note, i) => {
        const lx = i * 150;
        const isRoot = note.id === data.rootNoteId;
        legendG.append("rect")
            .attr("x", lx).attr("y", 0).attr("width", 10).attr("height", 10)
            .attr("rx", 2).attr("fill", noteColor(note.id));
        legendG.append("text")
            .attr("x", lx + 14).attr("y", 9)
            .attr("font-size", 11).attr("class", "tl-row-label")
            .attr("font-weight", isRoot ? "bold" : "normal")
            .style("cursor", "pointer")
            .text(note.title)
            .on("click", () => webviewApi.postMessage({ name: "open_note", id: note.id }));
    });

    const chart = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);

    // Trunk line spanning full height
    chart.append("line")
        .attr("x1", TRUNK_X).attr("y1", 0)
        .attr("x2", TRUNK_X).attr("y2", sorted.length * ROW_H)
        .attr("stroke", "currentColor").attr("opacity", 0.2).attr("stroke-width", 2);

    function rowY(i) { return i * ROW_H + ROW_H / 2; }


    // Note lane x offsets for range bars (so multi-note ranges don't collide)
    const LANE_W = 10;
    const LANE_GAP = 5;
    const laneBaseX = TRUNK_X + 18;

    sorted.forEach((ev, i) => {
        const color = noteColor(ev.noteId);
        const noteIdx = noteOrder.findIndex(n => n.id === ev.noteId);
        const cy = rowY(i);
        const laneX = laneBaseX + noteIdx * (LANE_W + LANE_GAP);

        chart.append("text")
            .attr("x", -8).attr("y", cy + 4)
            .attr("text-anchor", "end")
            .attr("font-size", 10).attr("class", "tl-axis")
            .attr("opacity", 0.7)
            .text(ev.start);

        if (i > 0) {
            chart.append("line")
                .attr("x1", -DATE_W + 8).attr("x2", chartW)
                .attr("y1", i * ROW_H).attr("y2", i * ROW_H)
                .attr("stroke", "currentColor").attr("opacity", 0.06).attr("stroke-width", 1);
        }

        const g = chart.append("g")
            .attr("class", ev.type === "range" ? "tl-event-range" : "tl-event-point")
            .on("click", () => webviewApi.postMessage({ name: "open_note", id: ev.noteId }))
        if (ev.type === "range" && ev.end) {
            const endIdx = sorted.findIndex((e2, j) => j > i && e2.noteId === ev.noteId && e2.start >= ev.end);
            const barBottom = endIdx > 0 ? rowY(endIdx) : cy + ROW_H * 0.35;

            g.append("rect")
                .attr("x", laneX).attr("y", cy)
                .attr("width", LANE_W).attr("height", Math.max(barBottom - cy, ROW_H * 0.3))
                .attr("rx", 3).attr("fill", color).attr("opacity", 0.75);

            g.append("circle").attr("cx", TRUNK_X).attr("cy", cy).attr("r", 6).attr("fill", color);
            g.append("circle").attr("cx", TRUNK_X).attr("cy", cy + Math.max(barBottom - cy, ROW_H * 0.3))
                .attr("r", 4).attr("fill", "none").attr("stroke", color).attr("stroke-width", 2);

            g.append("text")
                .attr("x", laneX + LANE_W + 8).attr("y", cy - 2)
                .attr("font-size", 12).attr("class", "tl-row-label").attr("font-weight", "600")
                .text(ev.label);
            g.append("text")
                .attr("x", laneX + LANE_W + 8).attr("y", cy + 13)
                .attr("font-size", 10).attr("class", "tl-row-label").attr("opacity", 0.6)
                .text(`until ${ev.end} · ${ev.noteTitle}`);

        } else {
            g.append("circle").attr("cx", TRUNK_X).attr("cy", cy).attr("r", 6).attr("fill", color);

            g.append("text")
                .attr("x", laneX + LANE_W + 8).attr("y", cy - 2)
                .attr("font-size", 12).attr("class", "tl-row-label").attr("font-weight", "600")
                .text(ev.label);
            g.append("text")
                .attr("x", laneX + LANE_W + 8).attr("y", cy + 13)
                .attr("font-size", 10).attr("class", "tl-row-label").attr("opacity", 0.6)
                .text(ev.noteTitle);
        }

    });
}

var activeView = "graph";

document.querySelectorAll(".view-tab").forEach(btn => {
    btn.addEventListener("click", () => {
        const view = btn.dataset.view;
        activeView = view;
        document.querySelectorAll(".view-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("note_graph").style.display    = view === "graph"    ? "" : "none";
        document.getElementById("graph-handle").style.display  = view === "graph"    ? "" : "none";
        document.getElementById("timeline_view").style.display = view === "timeline" ? "block" : "none";
        if (view === "timeline") loadTimeline();
    });
});

var graph = createGraph();

poll("init");

