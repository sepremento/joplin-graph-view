import joplin from "api";
import { ColorGroup, JoplinNote, Node, PreprocessedFilter } from './model'

const tagColorCache = new Map<string, string>();

function getTagColor(tagId: string): string {
    if (!tagColorCache.has(tagId)) {
        let hash = 0;
        for (let i = 0; i < tagId.length; i++) {
            hash = ((hash << 5) - hash) + tagId.charCodeAt(i);
            hash |= 0;
        }
        const hue = Math.abs(hash * 137) % 360;
        tagColorCache.set(tagId, `hsl(${hue}, 65%, 55%)`);
    }
    return tagColorCache.get(tagId);
}

async function applyTagColors(nodeMap: Map<string, Node>): Promise<void> {
    const noteIds = Array.from(nodeMap.keys()).filter(id => !nodeMap.get(id).is_tag);
    const promises = noteIds.map(id =>
        joplin.data.get(["notes", id, "tags"], { fields: ["id"] })
    );
    const results = await Promise.all(promises.map(p => p.catch(e => e)));
    for (let i = 0; i < noteIds.length; i++) {
        if (results[i] instanceof Error) continue;
        const tags = results[i].items;
        if (!tags || tags.length === 0) continue;
        nodeMap.get(noteIds[i]).color = getTagColor(tags[0].id);
    }
}


export interface Notebook {
    title: string;
    parent_id: string;
}


// Fetch notes
export async function getNodes(
    selectedNotes: Array<string>,
    maxDegree: number,
    filterQuery: string,
    notebookId?: string
): Promise<Map<string, Node>> {

    const maxNotes = await joplin.settings.value("MAX_NODES");

    const noteIdsToExclude: Set<string> = new Set();

    let nodes = new Map<string, Node>();

    const prep = preprocessFilter(filterQuery);

    if (prep.query) {
        const searchResult: Array<JoplinNote> = await executeSearch(prep.query);
        for (let n of searchResult) noteIdsToExclude.add(n.id);
    }

    if (maxDegree >= 0) {
        nodes = await getLinkedNodes(
            selectedNotes,
            maxDegree,
            noteIdsToExclude,
            notebookId,
        );
        nodes = filterByNumLinks(nodes, prep);
    } else {
        nodes = await getAllNodes(maxNotes, noteIdsToExclude, notebookId);
    }

    const showTagNodes = await joplin.settings.value('SHOW_TAG_NODES');
    if (showTagNodes) {
        const tagNodes = await buildTagNodes(nodes, maxDegree < 0);
        for (const [id, node] of tagNodes.entries()) nodes.set(id, node);
    }

    const showTags = await joplin.settings.value('SHOW_TAGS');
    if (showTags) {
        await applyTagColors(nodes);
    }

    return nodes;
}

// Fetches every note.
async function getAllNodes(
    maxNotes: number,
    noteIdsToExclude: Set<string>,
    notebookId?: string,
): Promise<Map<string, Node>> {
    var allNotes = new Array<JoplinNote>();
    var page_num = 1;
    const notePath = notebookId ? ["folders", notebookId, "notes"] : ["notes"];

    do {
        var notes = await joplin.data.get(notePath, {
            fields: ["id", "title", "body", "parent_id"],
            order_by: "updated_time",
            order_dir: "DESC",
            limit: maxNotes < 100 ? maxNotes : 100,
            page: page_num,
        });
        allNotes.push(...notes.items);
        page_num++;
    } while (notes.has_more && allNotes.length < maxNotes);

    const nodeMap = new Map<string, Node>();

    for (const joplinNote of allNotes) {
        if (noteIdsToExclude.has(joplinNote.id)) continue;

        const note = buildNodeFromNote(joplinNote);
        nodeMap.set(note.id, note);
    }

    return nodeMap;
}


function buildNodeFromNote(joplinNote: JoplinNote): Node {
    const links: Set<string> = getAllLinksForNote(joplinNote.body);
    const body_size = joplinNote.body ? joplinNote.body.length : 0;
    joplinNote.body = null;
    return {
        id: joplinNote.id,
        title: joplinNote.title,
        is_tag: false,
        forwardlinks: links,
        backlinks: new Array<string>(),
        num_links: links.size,
        body_size,
        num_forwardlinks: links.size,
        num_backlinks: 0
    };
}


// Fetch all notes linked to a given source note, up to a maximum degree of
// separation.
async function getLinkedNodes(
    source_ids: Array<string>,
    maxDegree: number,
    noteIdsToExclude: Set<string>,
    notebookId?: string,
): Promise<Map<string, Node>> {

    var pending = source_ids;
    var visited = new Set();
    const nodeMap = new Map();
    const backlinksMap = new Map();
    var degree = 0;

    const opts = await joplin.settings.values(['INCLUDE_BACKLINKS']);

    do {
        // Traverse a new batch of pending note ids, storing the note data in
        // the resulting map, and stashing the newly found linked notes for the
        // next iteration.

        // applyFilters
        if (degree !== 0) pending = pending.filter(n => !noteIdsToExclude.has(n));

        const joplinNotes = await getNoteArray(pending);
        for (const pendingNoteId of pending) {
            visited.add(pendingNoteId)
        }
        pending = [];

        if (opts.INCLUDE_BACKLINKS) {
            const backlinksPromises = joplinNotes.map(n => getAllBacklinksForNote(n.id));
            let backlinks = await Promise.all(backlinksPromises.map((p) => p.catch((e) => e)));
            backlinks = backlinks.filter((r) => !(r instanceof Error))

            for (let lnk of backlinks) {
                const filtered = lnk.backlinks.filter(link => !noteIdsToExclude.has(link.id));
                backlinksMap.set(lnk.id, filtered.map(({ id, }) => id));
            }
        }

        for (const joplinNote of joplinNotes) {
            // Skip notes outside the target notebook when scoping is active.
            if (notebookId && joplinNote.parent_id !== notebookId) continue;

            // store note data to be returned at the end of the traversal
            const node = buildNodeFromNote(joplinNote);

            node.distanceToCurrentNode = degree;

            node.backlinks = opts.INCLUDE_BACKLINKS ? backlinksMap.get(node.id) : [];
            node.num_backlinks = node.backlinks.length;
            node.num_links = node.num_forwardlinks + node.num_backlinks;

            nodeMap.set(joplinNote.id, node);

            const allLinks = [
                ...node.forwardlinks, // these are the forward-links
                ...node.backlinks,
            ];

            // stash any new links for the next iteration
            for (const link of allLinks) {
                // prevent cycles by filtering notes we've already seen.
                if (!visited.has(link)) {
                    pending.push(link);
                }
            }
        }


        degree++;

        // stop whenever we've reached the maximum degree of separation, or
        // we've exhausted the adjacent nodes.
    } while (pending.length > 0 && degree <= maxDegree);

    return nodeMap;
}


interface Tag {
    id: string,
    title: string
}


interface JoplinDataResponse {
    items: any,
    has_more?: boolean
}


export async function buildTagNodes(nodes: Map<string, Node>, all: boolean): Promise<Map<string, Node>> {
    const tagNodes = new Map();

    // keep only nodes that are built from notes;
    const notesNodes = new Map(Array.from(nodes).filter(([_, v]) => !v.is_tag))
    const noteIdsArr = Array.from(notesNodes.keys());
    let uniqueTags: Array<Tag> = [];

    if (all) {
        // if building Global View
        let pageNum = 1;
        let response: JoplinDataResponse;
        do {
            response = await joplin.data.get(["tags"], {
                fields: ["id", "title"],
                page: pageNum++,
            });
            uniqueTags.push(...response.items);
        } while (response.has_more);

    } else {
        // collect all tags present in given notes
        const uniqueTagIds = new Set();
        const tagsPromises = noteIdsArr.map((id) =>
            joplin.data.get(["notes", id, "tags"], {
                fields: ["id", "title"]
            }));
        const tagsResult = await Promise.all(tagsPromises.map((p) => p.catch((e) => e)));
        const validTags = tagsResult.filter((r) => !(r instanceof Error));
        for (let res of validTags) {
            const tags = res.items;
            for (let tag of tags) {
                if (!uniqueTagIds.has(tag.id)) {
                    uniqueTagIds.add(tag.id);
                    uniqueTags.push(tag)
                }
            }
        }

    }

    // collect all notes associated with deduced tags
    const tagIdsArr = uniqueTags.map(tag => tag.id);
    const notesPromises = tagIdsArr.map((id) =>
        joplin.data.get(["tags", id, "notes"], { fields: ["id"] }));

    const notesForTags = await Promise.all(notesPromises.map((p) => p.catch((e) => e)));

    for (let i=0; i < uniqueTags.length; i++) {
        if (notesForTags[i] instanceof Error) continue;

        const { id: tagId, title } = uniqueTags[i];
        const links = notesForTags[i].items.map(({ id }) => id);

        if (links.length === 0) continue;

        if (!tagNodes.has(tagId)) tagNodes.set(tagId, {
            id: tagId,
            title: title,
            is_tag: true,
            forwardlinks: links
        });
    }
    return tagNodes;
}

export async function buildNodeGroupMap(groups: Map<string, ColorGroup>): Promise<Map<string, Map<string, string>>> {
    const nodeGroupMap: Map<string, Map<string, string>> = new Map();
    const groupsArr = Array.from(Object.entries(groups));
    const promises = groupsArr.map(([_, group]) => executeSearch(group.filter));
    const results = await Promise.all(promises.map((p) => p.catch((e) => e)));
    
    for (let i=0; i<groupsArr.length; i++) {
        if (results[i] instanceof Error) continue;

        const groupName = groupsArr[i][0];
        const groupColor = groupsArr[i][1].color;
        const nodeColorMap: Map<string, string> = new Map();
        const nodeArr = results[i];
        for (let note of nodeArr) {
            nodeColorMap.set(note.id, groupColor);
        }
        nodeGroupMap.set(groupName, nodeColorMap);
    }
    return nodeGroupMap
}

export async function executeSearch(query: string): Promise<Array<JoplinNote>> {
    let page = 1;
    const maxNotes = await joplin.settings.value("MAX_NODES")
    const foundNotes = new Array();

    do {
        var notes = await joplin.data.get(['search'], {
            query: query,
            fields: ["id", "title", "body"],
            limit: maxNotes < 100 ? maxNotes : 100,
            page: page
        });

        foundNotes.push(...notes.items);
        page++;
    } while(notes.has_more && foundNotes.length < maxNotes);

    return foundNotes;
}


export async function getNoteArray(ids: string[]): Promise<Array<JoplinNote>> {
    var promises = ids.map((id) =>
        joplin.data.get(["notes", id], {
            fields: ["id", "title", "body", "parent_id"],
        })
    );

    // joplin queries could fail -- make sure we catch errors.
    const results = await Promise.all(promises.map((p) => p.catch((e) => e)));

    // remove from results any promises that errored out, returning the valid
    // subset of queries.
    const valid = results.filter((r) => !(r instanceof Error));
    return valid;
}


export function getAllLinksForNote(noteBody: string): Set<string> {
    const links = new Set<string>();
    if (!noteBody) return links;
    // TODO: needs to handle resource links vs note links. see 4. Tips note for
    // webclipper screenshot.
    // https://stackoverflow.com/questions/37462126/regex-match-markdown-link
    const linkRegexp = /\[.*?\]\(:\/(.*?)\)/g;
    var match = null;
    do {
        match = linkRegexp.exec(noteBody);
        if (match != null && match[1] !== undefined) {
            links.add(match[1]);
        }
    } while (match != null);
    return links;
}


async function getAllBacklinksForNote(noteId: string): Promise<Object> {
    const links: string[] = [];
    let pageNum = 1;
    let response;
    do {
        response = await joplin.data.get(["search"], {
            query: noteId,
            fields: ["id"],
            page: pageNum++,
        });
        links.push(...response.items);
    } while (response.has_more);
    return {id: noteId, backlinks: links};
}

function preprocessFilter(filterQuery: string): PreprocessedFilter {
    if (!filterQuery) return { query: filterQuery };
    let query = filterQuery;
    let result: PreprocessedFilter = { query: filterQuery };
    const patterns = [
        /(min_links):\s*(\d+)/,
        /(max_links):\s*(\d+)/,
        /(min_forwardlinks):\s*(\d+)/,
        /(max_forwardlinks):\s*(\d+)/,
        /(min_backlinks):\s*(\d+)/,
        /(max_backlinks):\s*(\d+)/,
    ]
    for (let pat of patterns) {
        const match = filterQuery.match(pat);
        if (match) {
            const key = match[1], value = match[2];
            query = query.replace(match[0], '');
            result[key] = +value;
        }
    }
    result.query = query.trim();
    return result;
}

function filterByNumLinks(
    nodeMap: Map<string, Node>,
    filter: PreprocessedFilter
): Map<string, Node> {
    const filteredMap = new Map<string, Node>();

    for (const [id, node] of nodeMap) {
        // Проверяем условия для num_links
        const meetsMinLinks = filter.min_links === undefined || node.num_links >= filter.min_links;
        const meetsMaxLinks = filter.max_links === undefined || node.num_links <= filter.max_links;

        // Проверяем условия для num_forwardlinks
        const meetsMinForwardLinks = filter.min_forwardlinks === undefined || node.num_forwardlinks >= filter.min_forwardlinks;
        const meetsMaxForwardLinks = filter.max_forwardlinks === undefined || node.num_forwardlinks <= filter.max_forwardlinks;

        // Проверяем условия для num_backlinks
        const meetsMinBacklinks = filter.min_backlinks === undefined || node.num_backlinks >= filter.min_backlinks;
        const meetsMaxBacklinks = filter.max_backlinks === undefined || node.num_backlinks <= filter.max_backlinks;

        // Если все условия выполнены, добавляем узел в отфильтрованную карту
        if (meetsMinLinks && meetsMaxLinks && meetsMinForwardLinks && meetsMaxForwardLinks && meetsMinBacklinks && meetsMaxBacklinks) {
            filteredMap.set(id, node);
        }
    }

    return filteredMap;
}
