// Presence and the shared note, as seen by one client. Pure functions so the
// rules are unit-tested without a browser or a socket (see collab.test.ts).
// The server is the authority: it versions presence and the note, and keeps
// the last write it receives.

export type Participant = {
  id: string;
  name: string;
  role: "publisher" | "viewer";
  joinedAt: string;
};
export type Presence = { version: number; participants: Participant[] };
export type SharedNote = {
  text: string;
  version: number;
  byId?: string;
  byName?: string;
  updatedAt?: string;
};

export const MAX_NOTE_BYTES = 4096;
export const MAX_NAME_LENGTH = 24;
export const EMPTY_PRESENCE: Presence = { version: 0, participants: [] };
export const EMPTY_NOTE: SharedNote = { text: "", version: 0 };

/** Newer versions replace older ones; duplicates and late arrivals are ignored. */
export function applyPresence(current: Presence, incoming: Presence): Presence {
  return incoming.version > current.version ? incoming : current;
}

export type PresenceChange = {
  joined: Participant[];
  left: Participant[];
  renamed: { from: string; to: string }[];
};

export function presenceChanges(
  prev: Participant[],
  next: Participant[],
): PresenceChange {
  const before = new Map(prev.map((p) => [p.id, p]));
  const after = new Map(next.map((p) => [p.id, p]));
  return {
    joined: next.filter((p) => !before.has(p.id)),
    left: prev.filter((p) => !after.has(p.id)),
    renamed: next
      .filter((p) => before.has(p.id) && before.get(p.id)!.name !== p.name)
      .map((p) => ({ from: before.get(p.id)!.name, to: p.name })),
  };
}

/** A sentence for a screen-reader live region, or "" when nothing worth saying changed. */
export function announce(change: PresenceChange, selfId: string): string {
  const parts: string[] = [];
  const others = (list: Participant[]) => list.filter((p) => p.id !== selfId);
  const join = others(change.joined).map((p) => p.name);
  const left = others(change.left).map((p) => p.name);
  if (join.length) parts.push(`${list(join)} joined`);
  if (left.length) parts.push(`${list(left)} left`);
  for (const r of change.renamed)
    if (r.from !== r.to) parts.push(`${r.from} is now ${r.to}`);
  return parts.join(". ");
}

function list(names: string[]): string {
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

/** The utf-8 size the server limits (it counts bytes, not characters). */
export function noteBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export type NoteState = {
  /** Latest note the server has told us about. */
  saved: SharedNote;
  /** What is in the text box. */
  draft: string;
  /** Someone else saved a newer note while the draft had unsaved edits. */
  behind: SharedNote | null;
  /** The server's answer to our last save: did it replace a newer note? */
  lastSave: { version: number; overwrote: boolean } | null;
};
export const INITIAL_NOTE_STATE: NoteState = {
  saved: EMPTY_NOTE,
  draft: "",
  behind: null,
  lastSave: null,
};

export type NoteAction =
  | { type: "remote"; note: SharedNote; selfId: string }
  | { type: "edit"; text: string }
  | { type: "ack"; version: number; overwrote: boolean }
  | { type: "takeTheirs" }
  | { type: "reset" };

export const isDirty = (s: NoteState) => s.draft !== s.saved.text;

export function noteReducer(s: NoteState, a: NoteAction): NoteState {
  switch (a.type) {
    case "remote": {
      if (a.note.version <= s.saved.version) return s; // stale or duplicate
      const clean = !isDirty(s);
      const mine = a.note.byId === a.selfId;
      if (clean || a.note.text === s.draft)
        return { ...s, saved: a.note, draft: a.note.text, behind: null };
      // Unsaved edits exist. Our own earlier save echoing back must not look like a conflict.
      return { ...s, saved: a.note, behind: mine ? null : a.note };
    }
    case "edit":
      return { ...s, draft: a.text };
    case "ack":
      return {
        ...s,
        behind: null,
        lastSave: { version: a.version, overwrote: a.overwrote },
      };
    case "takeTheirs":
      return { ...s, draft: s.saved.text, behind: null };
    case "reset":
      return INITIAL_NOTE_STATE;
  }
}

/** Display names are cleaned by the server too; this keeps the box honest. */
export function cleanName(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}
