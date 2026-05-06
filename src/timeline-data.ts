import { TimelineEvent } from "./model";

// Supports both formats:
//   @date(2026, label)         — year only, comma separator
//   @date(2026-01-01, label)   — full date, comma separator
//   @date(2026-01-01 "label")  — full date, space + quoted label (legacy)
const DATE_PAT = `(\\d{4}(?:-\\d{2}-\\d{2})?)(?:,\\s*|\\s+"?)([^")]+)"?`;
const dateRe  = new RegExp(`@date\\(${DATE_PAT}\\)`, 'g');
const startRe = new RegExp(`@start\\(${DATE_PAT}\\)`, 'g');
const endRe   = new RegExp(`@end\\(${DATE_PAT}\\)`, 'g');

function normalizeDate(d: string): string {
    return d.length === 4 ? d + '-01-01' : d;
}

function trimLabel(s: string): string {
    return s.trim().replace(/"+$/, '').trim();
}

export function parseTimelineEvents(noteId: string, noteTitle: string, body: string): TimelineEvent[] {
    if (!body) return [];
    const events: TimelineEvent[] = [];

    let m: RegExpExecArray | null;

    dateRe.lastIndex = 0;
    while ((m = dateRe.exec(body)) !== null)
        events.push({ noteId, noteTitle, label: trimLabel(m[2]), start: normalizeDate(m[1]), type: 'point' });

    const starts = new Map<string, string>();
    startRe.lastIndex = 0;
    while ((m = startRe.exec(body)) !== null) starts.set(trimLabel(m[2]), normalizeDate(m[1]));

    endRe.lastIndex = 0;
    while ((m = endRe.exec(body)) !== null) {
        const label = trimLabel(m[2]);
        if (starts.has(label)) {
            events.push({ noteId, noteTitle, label, start: starts.get(label)!, end: normalizeDate(m[1]), type: 'range' });
            starts.delete(label);
        }
    }
    for (const [label, date] of starts)
        events.push({ noteId, noteTitle, label, start: date, type: 'point' });

    return events;
}
