import * as d3 from "d3";
import * as userInput from "./user-input.js"


function poll() {
  webviewApi.postMessage({ name: "poll" }).then((event) => {
    if (event.data) {
      buildGraph(event.data);
    }
    poll();
  });
}


poll();


function update() {
  webviewApi.postMessage({ name: "update" }).then((event) => {
    if (event.data) {
      buildGraph(event.data);
    }
  });
}


function getNoteTags(noteId) {
  return webviewApi.postMessage({ name: "get_note_tags", id: noteId });
}


function addMarkerEndDef(defs, distance) {
  const style = `var(--distance-${distance}-primary-color, var(--distance-remaining-primary-color))`;
  _addMarkerEndDef(defs, distance, style);
}


function _addMarkerEndDef(defs, name, style) {
  defs
    .append("marker")
    .attr("id", `line-marker-end-${name}`)
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 20)
    .attr("refY", 0)
    .attr("markerWidth", 15)
    .attr("markerHeight", 15)
    .attr("markerUnits", "userSpaceOnUse")
    .attr("orient", "auto")
    .style("fill", style)
    .append("svg:path")
    .attr("d", "M0,-5L10,0L0,5");
}


function minimalDistanceOfLink(link) {
  return Math.min(
    link.sourceDistanceToCurrentNode,
    link.targetDistanceToCurrentNode
  );
}


function setMaxDistanceSetting(newVal) {
  // will automically trigger ui update of graph
  return webviewApi.postMessage({
    name: "set_setting",
    key: "SETTING_MAX_SEPARATION_DEGREE",
    value: newVal,
  });
}


function getMaxDistanceSetting() {
  return webviewApi.postMessage({
    name: "get_setting",
    key: "SETTING_MAX_SEPARATION_DEGREE",
  });
}


getMaxDistanceSetting().then((v) => {
  // todo: shorten up, when top-level await available
  userInput.init(v, setMaxDistanceSetting, update);
  update();
});


var simulation, svg;
var width, height;
var tooltip = d3
  .select("#joplin-plugin-content")
  .append("div")
  .classed("tooltip", true)
  .classed("hidden", true);


function buildGraph(data) {
  console.log('buildGraph was called!');

  var margin = { top: 10, right: 10, bottom: 10, left: 10 };
  width = window.innerWidth;
  height = window.innerHeight;
  tooltip.classed("hidden", true); // ensure proper popup reset

  if (data.graphIsSelectionBased)
    document
      .querySelector("#note_graph")
      .classList.add("mode-selection-based-graph");
  else
    document
      .querySelector("#note_graph")
      .classList.remove("mode-selection-based-graph");

  //remove old graph
  d3.select("#note_graph > svg").remove();

  svg = d3
    .select("#note_graph")
    .append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
    .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

  const forceLink = d3
    .forceLink()
    .distance(200)
    .id(function (d) {
      return d.id;
    })

  const forceCharge = d3
    .forceManyBody()
    .strength(() => { return -200; })

  if (data.graphIsSelectionBased) { forceLink.strength(setupForceLinkStrength) };

  simulation = d3
    .forceSimulation()
    .force("link", forceLink)
    .force("charge", forceCharge)
    .force("nocollide", d3.forceCollide(data.nodeDistanceRatio * 200))
    .force("center", d3.forceCenter(width / 2, height / 2));

  if (data.showLinkDirection) {
    const defs = svg.append("defs");
    // For now add arrows for ten layers (excl. center).
    // todo: make more dynamic
    const COUNT_LAYERS = 10;
    for (let i = 0; i < COUNT_LAYERS; i++) {
      addMarkerEndDef(defs, i);
    }
    // marker, if whole graph is shown
    addMarkerEndDef(defs, "default");
    // on hover marker
    _addMarkerEndDef(defs, "adjacent-to-hovered", "var(--hover-secondary-color");
  }

  //add zoom capabilities
  var zoom_handler = d3.zoom().scaleExtent([0.1, 10]).on("zoom", zoom_actions);
  zoom_handler(d3.select("svg"));

  function zoom_actions(event) {
    svg.attr("transform", event.transform);
  }

  updateGraph(data);

}


function updateGraph(data) {

  console.log('updateGraph was called!');

  // Remove nodes and links from the last graph
  svg.selectAll(".nodes").remove();
  svg.selectAll(".links").remove();

  // Draw links.
  var link = svg
    .append("g")
    .attr("class", "links")
    .selectAll("line")
    .data(data.edges)
    .enter()
    .append("line")
    .classed("adjacent-line", (d) => d.focused)
    .attr("id", (d) => { return domlinkId(d.source, d.target); })
    .on("mouseover", (_ev, d) => { handleLinkHover(this, d, true); })
    .on("mouseout", (_ev, d) => { handleLinkHover(this, d, false); });

  // provide distance classes for links
  if (data.graphIsSelectionBased) {
    link.attr("class", function (d) {
      const linkIsInward =
        d.sourceDistanceToCurrentNode > d.targetDistanceToCurrentNode;
      return [
        ...this.classList,
        `distance-${minimalDistanceOfLink(d)}`,
        ...(linkIsInward ? ["inward-link"] : []),
      ].join(" ");
    });
  }

  configureDistanceMarkerEnd(link);

  function domNodeId(nodeId, withSharp) {
    // dom id needs to start with [a-zA-Z], hence we prefix with "id-"
    return `${withSharp ? "#" : ""}id-${nodeId}`;
  }

  function domlinkId(sourceNodeId, targetNodeId, withSharp) {
    return `${withSharp ? "#" : ""}id-${sourceNodeId}-to-id-${targetNodeId}`;
  }

  function domNodeLabelId(nodeId, withSharp) {
    return `${withSharp ? "#" : ""}id-label-${nodeId}`;
  }

  function handleLinkHover(linkSelector, linkData, isEntered) {
    d3.select(linkSelector).classed("hovered", isEntered);
    // link hover will also trigger source and target node as well as labels hover
    // lines
    linkSelector = d3.select(linkSelector);
    linkSelector.classed("adjacent-to-hovered", isEntered);
    if (isEntered)
      linkSelector.attr("marker-end", "url(#line-marker-end-adjacent-to-hovered)");
    else configureDistanceMarkerEnd(linkSelector);

    // nodes
    // at this point d.source/targets holds *reference* to node data
    d3.select(domNodeId(linkData.source.id, true)).classed(
      "adjacent-to-hovered",
      isEntered
    );
    d3.select(domNodeId(linkData.target.id, true)).classed(
      "adjacent-to-hovered",
      isEntered
    );

    // node labels
    d3.select(domNodeLabelId(linkData.source.id, true)).classed(
      "adjacent-to-hovered",
      isEntered
    );
    d3.select(domNodeLabelId(linkData.target.id, true)).classed(
      "adjacent-to-hovered",
      isEntered
    );
  }

  function handleNodeHover(nodeSelector, nodeId, isEntered) {
    d3.select(nodeSelector).classed("hovered", isEntered);
    // node hover delegates to handleLinkHover
    // for all incoming and outcoming links
    d3.selectAll(
      `line[id^=id-${nodeId}-to-id-],line[id$=-to-id-${nodeId}]`
    ).each(function (d, _i) {
      handleLinkHover(this, d, isEntered);
    });
    return showNodeTooltip(nodeSelector, nodeId, isEntered);
  }

  async function showNodeTooltip(nodeSelector, nodeId, isEntered) {
    if (!isEntered) {
      tooltip.classed("hidden", true);
      return;
    }
    const hoveredBefore = d3.select("circle.hovered").node();
    const tags = await getNoteTags(nodeId);
    const hoveredAfter = d3.select("circle.hovered").node();
    // If we hovered something different in the meanwhile, don't show tooltip
    if (hoveredAfter !== hoveredBefore) return;
    if (tags.length === 0) return;
    const rect = d3.select(nodeSelector).node().getBoundingClientRect();
    tooltip.classed("hidden", false);
    tooltip.html(
      tags
        .map(
          ({ id, title }) =>
            `<div data-tag-id="${id}" class="node-hover-tag">${title}</div>`
        )
        .join(" ")
    );
    // center tooltip text at bottom of circle
    // (Note: CSS tranform translate does not work with flex:wrap)
    const leftPos =
      window.pageXOffset +
      rect.x +
      rect.width / 2 -
      tooltip.node().getBoundingClientRect().width / 2;
    tooltip
      .style("left", `${leftPos >= 0 ? leftPos : 0}px`)
      .style("top", `${window.pageYOffset + rect.y + rect.height}px`);
  }

  function configureDistanceMarkerEnd(link) {
    if (data.showLinkDirection) {
      link.attr("marker-end", (d) => {
        if (data.graphIsSelectionBased) {
          const minDistance = minimalDistanceOfLink(d);
          return `url(#line-marker-end-${minDistance})`;
        } else return `url(#line-marker-end-default)`;
      });
    }
  }

  // Draw nodes.
  var node = svg
    .append("g")
    .attr("class", "nodes")
    .selectAll("g")
    .data(data.nodes)
    .enter()
    .append("g")//;
    .call(
      d3
        .drag()
        .on("start", dragStart)
        .on("drag", drag)
        .on("end", dragEnd)
    );

  const circle = node.append("circle");

  circle
    .attr("id", function (d) {
      return domNodeId(d.id, false);
    })
    .classed("current-note", (d) => d.id === data.currentNoteID)
    .classed("adjacent-note", (d) => d.focused)
    .on("click", function (_, i) {
      webviewApi.postMessage({
        name: "navigateTo",
        id: i.id,
      });
    })
    .on("mouseover", function (_evN, dN) {
      handleNodeHover(this, dN.id, true);
    })
    .on("mouseout", function (_evN, dN) {
      handleNodeHover(this, dN.id, false);
    });

  // provide distance classes for circles
  if (data.graphIsSelectionBased) {
    circle.attr("class", function (d) {
      return [...this.classList, `distance-${d.distanceToCurrentNode}`].join(
        " "
      );
    });
  }

  const nodeLabel = node.append("text");

  nodeLabel
    .attr("class", "node-label")
    .attr("id", function (d) {
      return domNodeLabelId(d.id, false);
    })
    .attr("font-size", data.nodeFontSize + "px")
    .text(function (d) {
      return d.title;
    })
    .attr("x", (d) => (d.id === data.currentNoteID ? 20 : 14))
    .attr("y", 5);

  // provide distance classes for node labels
  if (data.graphIsSelectionBased) {
    nodeLabel.attr("class", function (d) {
      return [...this.classList, `distance-${d.distanceToCurrentNode}`].join(
        " "
      );
    });
  }

  //  update simulation nodes, links, and alpha
  simulation.nodes(data.nodes).on("tick", ticked);

  simulation.force("link").links(data.edges);

  simulation.alpha(1).alphaTarget(0).restart();

  function ticked() {
    node.attr("transform", function (d) {
      if (d.id == data.currentNoteID) {
        // Center the current note in the svg.
        d.x = width / 2;
        d.y = height / 2;
      }
      return "translate(" + d.x + "," + d.y + ")";
    });

    link
      .attr("x1", function (d) {
        return d.source.x;
      })
      .attr("y1", function (d) {
        return d.source.y;
      })
      .attr("x2", function (d) {
        return d.target.x;
      })
      .attr("y2", function (d) {
        return d.target.y;
      });
  }
}


function dragStart(d) {
  //console.log('drag start');
  simulation.alphaTarget(0.1).restart();
  d.fx = d.x;
  d.fy = d.y;
}


function drag(event, d) {
  //console.log('dragging');
  // simulation.alpha(0.5).restart()
  d.fx = event.x;
  d.fy = event.y;
}


function dragEnd(d) {
  //console.log('drag end');
  simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}


function setupForceLinkStrength(link) {
  const minDistance = minimalDistanceOfLink(link);

  if (minDistance === 0) { return 1; }
  if (minDistance === 1) { return 0.5; }

  return 0.1;
}

