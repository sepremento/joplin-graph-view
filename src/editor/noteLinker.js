/* global module, require */

module.exports = {
    default: function(context) {
        return {
            plugin: function(editorControl) {
                const completionSource = async function(completionContext) {
                    const match = completionContext.matchBefore(/@@\S*/);
                    if (!match || (match.from === match.to && !completionContext.explicit)) {
                        return null;
                    }

                    const query = match.text.slice(2);

                    let notes;
                    try {
                        notes = await context.postMessage({
                            action: 'searchNotes',
                            query: query,
                        });
                    } catch (e) {
                        return null;
                    }

                    if (completionContext.aborted) return null;
                    if (!notes || !notes.length) return null;

                    return {
                        from: match.from,
                        options: notes.map(function(note) {
                            return {
                                label: note.title,
                                apply: '[' + note.title + '](:/' + note.id + ')',
                                type: 'text',
                                detail: 'note',
                            };
                        }),
                        validFor: /@@\S*/,
                    };
                };

                try {
                    const extensions = [
                        editorControl.joplinExtensions.completionSource(completionSource),
                    ];
                    if (editorControl.joplinExtensions.enableLanguageDataAutocomplete) {
                        extensions.push(editorControl.joplinExtensions.enableLanguageDataAutocomplete.of(true));
                    }
                    editorControl.addExtension(extensions);
                } catch (e) {
                    // addExtension unavailable in this Joplin version
                }
            },
        };
    },
};
