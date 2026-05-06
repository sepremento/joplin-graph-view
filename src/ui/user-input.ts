const graphContainer = document.getElementById('container');
const draggables = document.querySelectorAll('div.drag-handle');

const queryInput = document.getElementById("query-input") as HTMLInputElement;
const filterInput = document.getElementById("filter-input") as HTMLInputElement;
const distOutput = document.getElementById("distance-output") as HTMLOutputElement;

const groupInput = document.getElementById("group-stub") as HTMLInputElement;
const addGroupBtn = document.getElementById("add-group-btn") as HTMLInputElement;
const refreshGraphBtn = document.getElementById("refresh-graph-btn") as HTMLInputElement;

const textWidthInput = document.getElementById("text-width-input") as HTMLInputElement;
const centerStrengthInput = document.getElementById("center-strength-input") as HTMLInputElement;
const chargeStrengthInput = document.getElementById("charge-strength-input") as HTMLInputElement;
const collideRadiusInput = document.getElementById("nocollide-radius-input") as HTMLInputElement;
const linkDistanceInput = document.getElementById("link-distance-input") as HTMLInputElement;
const showTagNodesSwitch = document.getElementById("show-tag-nodes-switch") as HTMLInputElement;
const showTagsSwitch = document.getElementById("show-tags-switch") as HTMLInputElement;
const includeBacklinksSwitch = document.getElementById("include-backlinks-switch") as HTMLInputElement;
const scopeNotebookSwitch = document.getElementById("scope-notebook-switch") as HTMLInputElement;
const maxDistInput = document.getElementById("distance-slider") as HTMLInputElement;
const temperatureInput = document.getElementById("temperature-slider") as HTMLInputElement;
const clusterHopSwitch = document.getElementById("cluster-hop-switch") as HTMLInputElement;
const hopRingSpacingInput = document.getElementById("hop-ring-spacing-input") as HTMLInputElement;

const scale = [
    "#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99", "#e31a1c",
    "#fdbf6f", "#ff7f00", "#cab2d6", "#6a3d9a", "#ffff99", "#b15928"
]

let isDragging = false;
let offsetX: number, offsetY: number;

for (const draggable of draggables) {
    draggable.addEventListener('mousedown', startDragging);
    document.addEventListener('mouseup', stopDragging);
}

function startDragging(ev) {
    if (!ev.target.classList.contains('drag-handle')) return;

    isDragging = true;
    offsetX = ev.clientX - ev.target.parentNode.offsetLeft;
    offsetY = ev.clientY - ev.target.parentNode.offsetTop;
    document.addEventListener('mousemove', drag);
}

function stopDragging() {
    isDragging = false;
    document.removeEventListener('mousemove', drag);
}

function drag(ev) {
    if (!isDragging) return;

    requestAnimationFrame(() => {
        const newX = Math.min(
            Math.max(0, ev.clientX - offsetX),
            graphContainer.offsetWidth - ev.target.parentNode.offsetWidth
        )
        const newY = Math.min(
            Math.max(0, ev.clientY - offsetY),
            graphContainer.offsetHeight - ev.target.parentNode.offsetHeight
        );
        ev.target.parentNode.style.left = `${newX}px`;
        ev.target.parentNode.style.top = `${newY}px`;
    })
}

function chromeRangeInputFix() {
    // Chrome bug: range inputs block drag without this. https://stackoverflow.com/q/69490604
    document
        .querySelectorAll('input[type="range"]')
        .forEach((input) => {
            input.addEventListener("mousedown", () =>
                window.getSelection().removeAllRanges()
            );
        });
}

export function setupGraphHandle(settings) {
    queryInput.value = settings.QUERY;
    filterInput.value = settings.FILTER;
    showTagNodesSwitch.checked = settings.SHOW_TAG_NODES;
    showTagsSwitch.checked = settings.SHOW_TAGS;
    includeBacklinksSwitch.checked = settings.INCLUDE_BACKLINKS;
    scopeNotebookSwitch.checked = settings.SCOPE_TO_NOTEBOOK;
    maxDistInput.value = settings.MAX_TREE_DEPTH;
    distOutput.innerHTML = Number(settings.MAX_TREE_DEPTH) >= 0 ? settings.MAX_TREE_DEPTH : "G";

    textWidthInput.value = settings.MAX_TEXT_WIDTH;
    centerStrengthInput.value = settings.CENTER_STRENGTH;
    chargeStrengthInput.value = settings.CHARGE_STRENGTH;
    collideRadiusInput.value = settings.COLLIDE_RADIUS;
    linkDistanceInput.value = settings.LINK_DISTANCE;
    temperatureInput.value = settings.ALPHA;
    clusterHopSwitch.checked = !!settings.CLUSTER_BY_HOP;
    hopRingSpacingInput.value = settings.HOP_RING_SPACING ?? 150;

}

function makeGroupValues() {
    const groupDivs = document.querySelectorAll(".groups");

    const groupValues = {};

    for (let i=0; i<groupDivs.length; i++) {
        const input = groupDivs[i].querySelector(".group-input") as HTMLInputElement;
        const name = groupDivs[i].id
        const filter = input.value.trim();
        const color = (groupDivs[i].querySelector(".group-color") as HTMLInputElement).value;

        if (filter) groupValues[name] ={
            filter: filter,
            color: color
        };

    }

    return groupValues
}

export function addGroupEventListeners(setSetting) {
    const oldInputs = document.querySelectorAll(".group-input");
    const oldColors = document.querySelectorAll(".group-color");
    const oldDels = document.querySelectorAll(".del-btn");

    const newInputs = [];
    const newColors = [];
    const newDels = [];

    for (let i=0; i<oldInputs.length; i++) {
        const oldGroupInput = oldInputs[i];
        const oldGroupColor = oldColors[i];
        const oldDel = oldDels[i];
        const newGroupInput = oldGroupInput.cloneNode(true);
        const newGroupColor = oldGroupColor.cloneNode(true);
        const newDel = oldDel.cloneNode(true);

        oldGroupInput.parentNode.replaceChild(newGroupInput, oldGroupInput);
        oldGroupColor.parentNode.replaceChild(newGroupColor, oldGroupColor);
        oldDel.parentNode.replaceChild(newDel, oldDel);

        newInputs.push(newGroupInput);
        newColors.push(newGroupColor);
        newDels.push(newDel);

    };

    for (let i=0; i<newInputs.length; i++) {
        const newGroupColor = newColors[i];
        const newGroupInput = newInputs[i];
        const newDel = newDels[i];

        newGroupInput.addEventListener("keypress", (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                setSetting("GROUPS", makeGroupValues());
            }
        })
        newGroupColor.addEventListener("change", () => {
            setSetting("GROUPS", makeGroupValues());
        });

        newDel.addEventListener("click", () => {
            newDel.parentNode.parentNode.removeChild(newDel.parentNode);
            const remainedElements = document.querySelectorAll(".groups");
            let n = 1;
            for (let el of remainedElements) {
                // el.setAttribute("id", n);
                const input = el.querySelector(".group-input");
                const delBtn = el.querySelector(".del-btn");
                input.setAttribute("data", `${n}`);
                delBtn.setAttribute("id", `del-group-${n}`);
                n++;
            }
            setSetting("GROUPS", makeGroupValues());
        });
    }
}

export function initFront(initialValues, setSetting, refreshGraph) {

    chromeRangeInputFix();
    setupGraphHandle(initialValues);

    const groupNames = Object.keys(initialValues.GROUPS)

    //setting up color groups separately because setupGraphHandle is called
    //in another part of code so stands in the way
    for (let i=0; i<groupNames.length; i++) {
        const groupBlockStub = document.getElementById("group-block-stub");
        const name = groupNames[i] ? groupNames[i] : generateRandomString(8);
        const filter = initialValues.GROUPS[name].filter;
        const color = initialValues.GROUPS[name].color;
        const n = i+1;
        groupBlockStub.insertAdjacentHTML("beforebegin",
            `<div class="control-block groups" id="${name}">
             <input class="group-input" type="string" data="${n}" value="${filter}"></input>
             <input class="group-color" type="color" value="${color}"></input>
             <input class="del-btn" id="del-group-${n}" type="button" value="🗑"></input>
             </div>`
        )
    }

    textWidthInput.addEventListener("change", () => {
        setSetting("MAX_TEXT_WIDTH", textWidthInput.valueAsNumber);
    });
    centerStrengthInput.addEventListener("change", () => {
        setSetting("CENTER_STRENGTH", centerStrengthInput.valueAsNumber);
    });
    chargeStrengthInput.addEventListener("change", () => {
        setSetting("CHARGE_STRENGTH", chargeStrengthInput.valueAsNumber);
    });
    collideRadiusInput.addEventListener("change", () => {
        setSetting("COLLIDE_RADIUS", collideRadiusInput.valueAsNumber);
    });
    linkDistanceInput.addEventListener("change", () => {
        setSetting("LINK_DISTANCE", linkDistanceInput.valueAsNumber);
    });
    temperatureInput.addEventListener("change", () => {
        setSetting("ALPHA", temperatureInput.valueAsNumber);
    });
    clusterHopSwitch.addEventListener("change", () => {
        setSetting("CLUSTER_BY_HOP", clusterHopSwitch.checked);
    });
    hopRingSpacingInput.addEventListener("change", () => {
        setSetting("HOP_RING_SPACING", hopRingSpacingInput.valueAsNumber);
    });
    showTagNodesSwitch.addEventListener("change", () => {
        setSetting("SHOW_TAG_NODES", showTagNodesSwitch.checked);
    });
    showTagsSwitch.addEventListener("change", () => {
        setSetting("SHOW_TAGS", showTagsSwitch.checked);
    });
    includeBacklinksSwitch.addEventListener("change", () => {
        setSetting("INCLUDE_BACKLINKS", includeBacklinksSwitch.checked);
    });
    scopeNotebookSwitch.addEventListener("change", () => {
        setSetting("SCOPE_TO_NOTEBOOK", scopeNotebookSwitch.checked);
    });
    maxDistInput.addEventListener("change", () => {
        setSetting("MAX_TREE_DEPTH", maxDistInput.value);
    });
    queryInput.addEventListener("keypress", (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            setSetting("QUERY", queryInput.value);
        }
    });
    filterInput.addEventListener("keypress", (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            setSetting("FILTER", filterInput.value);
        }
    });
    maxDistInput.addEventListener("input", () => {
        distOutput.value = Number(maxDistInput.value) < 0 ? "G" : maxDistInput.value;
    });

    groupInput.addEventListener("keypress", (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            addGroupBtn.click();
        }
    });

    addGroupBtn.addEventListener("click", () => {
        const groupDivs = document.querySelectorAll("div.groups");
        const n = groupDivs.length + 1;
        const groupBlockStub = document.getElementById("group-block-stub");
        const name = generateRandomString(8);
        const filterText = groupInput.value;
        const colorEl = (document.getElementById("color-stub") as HTMLInputElement);
        const color = colorEl.value;
        groupBlockStub.insertAdjacentHTML("beforebegin",
            `<div class="control-block groups" id="${name}">
             <input class="group-input" type="string" data="${n}" value="${filterText}"></input>
             <input class="group-color" type="color" value="${color}"></input>
             <input class="del-btn" id="del-group-${n}" type="button" value="🗑"></input>
             </div>`
        )
        groupInput.value = "";
        groupInput.focus()
        const newColor = pickRandomColor(color);
        colorEl.value = newColor;

        addGroupEventListeners(setSetting);
        setSetting("GROUPS", makeGroupValues());
    });

    addGroupEventListeners(setSetting);

    refreshGraphBtn.addEventListener("click", () => { refreshGraph(); });
}

function generateRandomString(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters.charAt(randomIndex);
  }
  return result;
}

function pickRandomColor(curColor) {
    let color = '';
    do {
        color = scale[Math.floor(Math.random()*scale.length)];
    } while (color === curColor)
    return color;
}
