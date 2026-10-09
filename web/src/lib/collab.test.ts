import { describe, expect, it } from "vitest";
import {
  INITIAL_NOTE_STATE,
  announce,
  applyPresence,
  cleanName,
  isDirty,
  noteBytes,
  noteReducer,
  presenceChanges,
  type NoteState,
  type Participant,
} from "./collab";

const p = (id: string, name = id, role: Participant["role"] = "viewer") => ({
  id,
  name,
  role,
  joinedAt: "2026-10-09T00:00:00Z",
});
const note = (version: number, text: string, byId = "other") => ({
  version,
  text,
  byId,
  byName: byId.toUpperCase(),
});
const remote = (s: NoteState, n: ReturnType<typeof note>, selfId = "me") =>
  noteReducer(s, { type: "remote", note: n, selfId });

describe("presence", () => {
  it("only moves forward in version", () => {
    const v3 = { version: 3, participants: [p("a")] };
    const v2 = { version: 2, participants: [] };
    expect(applyPresence(v3, v2)).toBe(v3);
    expect(applyPresence(v3, v3)).toBe(v3);
    const v4 = { version: 4, participants: [p("a"), p("b")] };
    expect(applyPresence(v3, v4)).toBe(v4);
  });

  it("works out who joined, left and renamed", () => {
    const c = presenceChanges(
      [p("a", "Ana"), p("b", "Ben")],
      [p("a", "Ana M"), p("c", "Cy")],
    );
    expect(c.joined.map((x) => x.id)).toEqual(["c"]);
    expect(c.left.map((x) => x.id)).toEqual(["b"]);
    expect(c.renamed).toEqual([{ from: "Ana", to: "Ana M" }]);
  });

  it("announces others but never yourself, and stays quiet when nothing changed", () => {
    const change = presenceChanges([p("me")], [p("me"), p("a", "Ana")]);
    expect(announce(change, "me")).toBe("Ana joined");
    expect(announce(presenceChanges([p("me")], [p("me")]), "me")).toBe("");
    expect(announce(presenceChanges([], [p("me", "Me")]), "me")).toBe("");
    const crowd = presenceChanges(
      [p("me")],
      [p("me"), p("a", "A"), p("b", "B"), p("c", "C"), p("d", "D")],
    );
    expect(announce(crowd, "me")).toBe("A, B, C and 1 more joined");
    expect(
      announce(presenceChanges([p("me"), p("b", "Ben")], [p("me")]), "me"),
    ).toBe("Ben left");
  });
});

describe("shared note (last writer wins, server versions)", () => {
  it("follows the server while you are not editing", () => {
    const s = remote(INITIAL_NOTE_STATE, note(1, "hello"));
    expect(s.draft).toBe("hello");
    expect(isDirty(s)).toBe(false);
    expect(remote(s, note(2, "hello world")).draft).toBe("hello world");
  });

  it("ignores stale and duplicate notes", () => {
    const s = remote(INITIAL_NOTE_STATE, note(5, "new"));
    expect(remote(s, note(4, "old"))).toBe(s);
    expect(remote(s, note(5, "new"))).toBe(s);
  });

  it("keeps your unsaved draft and flags that someone else saved meanwhile", () => {
    let s = remote(INITIAL_NOTE_STATE, note(1, "base"));
    s = noteReducer(s, { type: "edit", text: "base + my edit" });
    expect(isDirty(s)).toBe(true);
    s = remote(s, note(2, "base + their edit", "ana"));
    expect(s.draft).toBe("base + my edit"); // never silently discarded
    expect(s.saved.version).toBe(2);
    expect(s.behind?.byName).toBe("ANA");
  });

  it("lets you take their version instead", () => {
    let s = remote(INITIAL_NOTE_STATE, note(1, "base"));
    s = noteReducer(s, { type: "edit", text: "mine" });
    s = remote(s, note(2, "theirs", "ana"));
    s = noteReducer(s, { type: "takeTheirs" });
    expect(s.draft).toBe("theirs");
    expect(s.behind).toBeNull();
    expect(isDirty(s)).toBe(false);
  });

  it("does not treat the echo of your own save as a conflict", () => {
    let s = remote(INITIAL_NOTE_STATE, note(1, "base"));
    s = noteReducer(s, { type: "edit", text: "saved text" });
    // you keep typing after pressing save...
    s = noteReducer(s, { type: "edit", text: "saved text, more" });
    s = remote(s, note(2, "saved text", "me"));
    expect(s.behind).toBeNull();
    expect(s.draft).toBe("saved text, more");
  });

  it("records whether your save replaced a newer note", () => {
    const s = noteReducer(INITIAL_NOTE_STATE, {
      type: "ack",
      version: 7,
      overwrote: true,
    });
    expect(s.lastSave).toEqual({ version: 7, overwrote: true });
  });

  it("counts bytes the way the server does", () => {
    expect(noteBytes("abc")).toBe(3);
    expect(noteBytes("é")).toBe(2);
    expect(noteBytes("😀")).toBe(4);
  });
});

describe("display names", () => {
  it("strips control and bidi characters, collapses spaces, caps length", () => {
    expect(cleanName("  Ana ‮  María\n")).toBe("Ana María");
    expect(cleanName("x".repeat(40))).toHaveLength(24);
    expect(cleanName("​​")).toBe("");
  });
});
