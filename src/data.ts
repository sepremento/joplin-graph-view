import joplin from "api";


export interface Notebook {
  id: string;
  title: string;
  parent_id: string;
}


async function getNotebooks(): Promise<Array<Notebook>> {
  var notebooks = [];
  var page_num = 1;
  do {
    var notebooksBatch = await joplin.data.get(
      ["folders"], 
      {
        fields: ["id", "title", "parent_id"],
        page: page_num,
      }
    );
    notebooks.push(...notebooksBatch.items);
    page_num++;
  } while (notebooksBatch.has_more);

  return notebooks;
}


function getFilteredNotebooks(
  notebooks: Array<Notebook>,
  filteredNotebookNames: Array<string>,
  shouldFilterChildren: boolean,
  isIncludeFilter: boolean
): Array<Notebook> {
  const notebookIdsByName = new Map<string, string>();
  notebooks.forEach((n) => notebookIdsByName.set(n.title, n.id));
  const notebooksById = new Map<string, Notebook>();
  notebooks.forEach((n) => notebooksById.set(n.id, n));

  // Get a list of valid notebook names to filter out.
  filteredNotebookNames = filteredNotebookNames.filter((name) =>
    notebookIdsByName.has(name)
  );

  function shouldIncludeNotebook(parent_id: string): boolean {
    var parentNotebook: Notebook = notebooksById.get(parent_id);
    // Filter out the direct parent.
    if (filteredNotebookNames.includes(parentNotebook.title)) {
      return isIncludeFilter;
    }

    // Filter a note if any of its ancestor notebooks are filtered.
    if (shouldFilterChildren) {
      while (parentNotebook !== undefined) {
        if (filteredNotebookNames.includes(parentNotebook.title)) {
          return isIncludeFilter;
        }
        parentNotebook = notebooksById.get(parentNotebook.parent_id);
      }
    }
    return !isIncludeFilter;
  }

  const filteredNotebooksArray = notebooks.filter((nb) => !shouldIncludeNotebook(nb.id));

  return filteredNotebooksArray
}


export interface Note {
  id: string;
  parent_id: string;
  title: string;
  links: Set<string>;
  backlinks?: Array<string>;
  linkedToCurrentNote?: boolean;
  /**
   * (Minimal) distance of this note to current/selected note in Joplin
   * 0 => current note itself
   * 1 => directly adjacent note
   * x => ... and so on
   */
  distanceToCurrentNote?: number;
}


interface JoplinNote {
  id: string;
  parent_id: string;
  title: string;
  body: string;
}


// Fetch notes
export async function getNotes(
  selectedNotes: Array<string>,
  maxDegree: number,
): Promise<Map<string, Note>> {

  //console.log('getNotes was called!')

  const maxNotes = await joplin.settings.value("MAX_NODES");
  const notebooksToFilter = (await joplin.settings.value('NOTEBOOK_NAMES_TO_FILTER')).split(",");

  const shouldFilterChildren = await joplin.settings.value("SETTING_FILTER_CHILD_NOTEBOOKS");
  const includeBacklinks = await joplin.settings.value("SETTING_INCLUDE_BACKLINKS");
  const isIncludeFilter = (await joplin.settings.value("FILTER_IS_INCLUDE_FILTER")) === "include" ? true : false;

  const notebooks = await getNotebooks();

  var notes = new Map<string, Note>();
  var filteredNotebooks = [];

  if (notebooksToFilter.length >0) {
    filteredNotebooks = getFilteredNotebooks(
      notebooks,
      notebooksToFilter,
      shouldFilterChildren,
      isIncludeFilter
    )
  }
  if (maxDegree > 0) {
    notes = await getLinkedNotes(selectedNotes, maxDegree, includeBacklinks, filteredNotebooks, isIncludeFilter);
  } else {
    notes = await getAllNotes(maxNotes);
  }
  if (notebooksToFilter.length > 0) {
    notes = await filterNotesByNotebookName(
      notes,
      notebooks,
      notebooksToFilter,
      shouldFilterChildren,
      isIncludeFilter
    );
  }
  return notes;
}

/**
 * Returns a filtered map of notes by notebook name.
 */
export async function filterNotesByNotebookName(
  notes: Map<string, Note>,
  notebooks: Array<Notebook>,
  filteredNotebookNames: Array<string>,
  shouldFilterChildren: boolean,
  isIncludeFilter: boolean
): Promise<Map<string, Note>> {
  // No filtering needed.
  if (filteredNotebookNames.length < 1) return notes;

  const notebookIdsByName = new Map<string, string>();
  notebooks.forEach((n) => notebookIdsByName.set(n.title, n.id));
  const notebooksById = new Map<string, Notebook>();
  notebooks.forEach((n) => notebooksById.set(n.id, n));

  // Get a list of valid notebook names to filter out.
  filteredNotebookNames = filteredNotebookNames.filter((name) =>
    notebookIdsByName.has(name)
  );

  function shouldIncludeNote(parent_id: string): boolean {
    var parentNotebook: Notebook = notebooksById.get(parent_id);
    // Filter out the direct parent.
    if (filteredNotebookNames.includes(parentNotebook.title)) {
      return isIncludeFilter;
    }

    // Filter a note if any of its ancestor notebooks are filtered.
    if (shouldFilterChildren) {
      while (parentNotebook !== undefined) {
        if (filteredNotebookNames.includes(parentNotebook.title)) {
          return isIncludeFilter;
        }
        parentNotebook = notebooksById.get(parentNotebook.parent_id);
      }
    }
    return !isIncludeFilter;
  }

  var filteredNotes = new Map<string, Note>();
  notes.forEach(function (n, id) {
    if (shouldIncludeNote(n.parent_id)) {
      filteredNotes.set(id, n);
    }
  });

  return filteredNotes;
}

// Fetches every note.
async function getAllNotes(maxNotes: number): Promise<Map<string, Note>> {
  var allNotes = new Array<JoplinNote>();
  var page_num = 1;

  do {
    // `parent_id` is the ID of the notebook containing the note.
    var notes = await joplin.data.get(["notes"], {
      fields: ["id", "parent_id", "title", "body"],
      order_by: "updated_time",
      order_dir: "DESC",
      limit: maxNotes < 100 ? maxNotes : 100,
      page: page_num,
    });
    allNotes.push(...notes.items);
    page_num++;
  } while (notes.has_more && allNotes.length < maxNotes);

  const noteMap = new Map();
  allNotes.map((note) => noteMap.set(note.id, buildNote(note)));
  return noteMap;
}


function buildNote(joplinNote: JoplinNote): Note {
  const links: Set<string> = getAllLinksForNote(joplinNote.body);
  joplinNote.body = null;
  return {
    id: joplinNote.id,
    title: joplinNote.title,
    parent_id: joplinNote.parent_id,
    links: links,
    backlinks: new Array<string>()
  };
}


// Fetch all notes linked to a given source note, up to a maximum degree of
// separation.
async function getLinkedNotes(
  source_ids: Array<string>,
  maxDegree: number,
  includeBacklinks: boolean,
  filteredNotebooks: Array<Notebook>,
  isIncludeFilter: boolean
): Promise<Map<string, Note>> {
  var pending = source_ids;
  var visited = new Set();
  const noteMap = new Map();
  var degree = 0;

  //pending.push(source_ids);
  do {
    // Traverse a new batch of pending note ids, storing the note data in
    // the resulting map, and stashing the newly found linked notes for the
    // next iteration.
    const joplinNotes = await getNoteArray(pending);
    pending.forEach((pendingNoteId) => visited.add(pendingNoteId));
    pending = [];

    for (const joplinNote of joplinNotes) {
      // store note data to be returned at the end of the traversal
      const note = buildNote(joplinNote);
      note.distanceToCurrentNote = degree;
      noteMap.set(joplinNote.id, note);


      let backlinks = includeBacklinks ? await getAllBacklinksForNote(note.id) : [];

      if (backlinks.length > 0) {
        backlinks = await filterBacklinks(backlinks, filteredNotebooks, isIncludeFilter);
      }

      //console.log(`Backlinks for note "${note.title}" are: ${backlinks}`)
      note.backlinks = backlinks;

      const allLinks = [
        ...note.links, // these are the forward-links
        ...backlinks,
      ];

      // stash any new links for the next iteration
      allLinks.forEach((link) => {
        // prevent cycles by filtering notes we've already seen.
        if (!visited.has(link)) {
          pending.push(link);
        }
      });
    }

    degree++;

    // stop whenever we've reached the maximum degree of separation, or
    // we've exhausted the adjacent nodes.
  } while (pending.length > 0 && degree <= maxDegree);

  return noteMap;
}


async function filterBacklinks(
  backlinks: Array<string>,
  filteredNotebooks: Array<Notebook>,
  isIncludeFilter: boolean
): Promise<Array<string>> {

  const joplinNotes = await getNoteArray(backlinks);

  const filteredNotebookIds = filteredNotebooks.map((nb) => nb.id);

  const filteredBacklinks = [];

  for (const joplinNote of joplinNotes) {
      const note = buildNote(joplinNote);

      if (isIncludeFilter) {
        if (filteredNotebookIds.includes(note.parent_id)) { filteredBacklinks.push(note.id) };
      } else {
        if (!filteredNotebookIds.includes(note.parent_id)) { filteredBacklinks.push(note.id) };
      }
  }

  return filteredBacklinks;
}


async function getNoteArray(ids: string[]): Promise<Array<JoplinNote>> {
  var promises = ids.map((id) =>
    joplin.data.get(["notes", id], {
      fields: ["id", "parent_id", "title", "body"],
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
  // TODO: needs to handle resource links vs note links. see 4. Tips note for
  // webclipper screenshot.
  // https://stackoverflow.com/questions/37462126/regex-match-markdown-link
  const linkRegexp = /\[\]|\[.*?\]\(:\/(.*?)\)/g;
  var match = null;
  do {
    match = linkRegexp.exec(noteBody);
    if (match != null && match[1] !== undefined) {
      links.add(match[1]);
    }
  } while (match != null);
  return links;
}


async function getAllBacklinksForNote(noteId: string) {
  const links: string[] = [];
  let pageNum = 1;
  let response;
  do {
    response = await joplin.data.get(["search"], {
      query: noteId,
      fields: ["id"],
      page: pageNum++,
    });
    links.push(...response.items.map(({ id }) => id));
  } while (response.has_more);
  return links;
}


type Tag = {
  id: string;
  title: string;
};


export async function getNoteTags(noteId: string) {
  const tags: Tag[] = [];
  let pageNum = 1;
  let response;
  do {
    response = await joplin.data.get(["notes", noteId, "tags"], {
      fields: ["id", "title"],
      page: pageNum++,
    });
    tags.push(...response.items);
  } while (response.has_more);
  return tags;
}
