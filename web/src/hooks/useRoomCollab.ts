import { useCallback, useReducer, useRef, useState } from "react";
import {
  EMPTY_PRESENCE,
  INITIAL_NOTE_STATE,
  announce,
  applyPresence,
  cleanName,
  noteReducer,
  presenceChanges,
  type Presence,
  type SharedNote,
} from "../lib/collab";
import type { Callbacks, StreamConnection } from "../lib/rtc";

const NAME_KEY = "sf-name";
export function savedName(): string {
  try {
    return cleanName(localStorage.getItem(NAME_KEY) ?? "");
  } catch {
    return "";
  }
}

/**
 * Presence and shared-note state for the room one StreamConnection joined.
 * Spread `callbacks` into the connection, call `attach` with it, `reset` when it ends.
 */
export function useRoomCollab() {
  const [presence, setPresence] = useState<Presence>(EMPTY_PRESENCE);
  const [selfId, setSelfId] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [note, dispatch] = useReducer(noteReducer, INITIAL_NOTE_STATE);
  const conn = useRef<StreamConnection | null>(null);
  const live = useRef({ presence, selfId, saved: note.saved });
  live.current = { presence, selfId, saved: note.saved };

  const callbacks: Pick<
    Callbacks,
    "onSelf" | "onPresence" | "onNote" | "onNoteAck"
  > = {
    onSelf: useCallback((id: string) => {
      live.current.selfId = id;
      setSelfId(id);
    }, []),
    onPresence: useCallback((incoming: Presence) => {
      const { presence: current, selfId: me } = live.current;
      const next = applyPresence(current, incoming);
      if (next === current) return;
      live.current.presence = next;
      setPresence(next);
      // The first list is just "who is here"; only later changes are news.
      if (current.version > 0)
        setAnnouncement(
          announce(
            presenceChanges(current.participants, next.participants),
            me,
          ),
        );
    }, []),
    onNote: useCallback((n: SharedNote) => {
      dispatch({ type: "remote", note: n, selfId: live.current.selfId });
    }, []),
    onNoteAck: useCallback((version: number, overwrote: boolean) => {
      dispatch({ type: "ack", version, overwrote });
    }, []),
  };

  return {
    presence,
    selfId,
    announcement,
    note,
    callbacks,
    attach: (c: StreamConnection | null) => {
      conn.current = c;
    },
    reset: () => {
      conn.current = null;
      setPresence(EMPTY_PRESENCE);
      setSelfId("");
      setAnnouncement("");
      dispatch({ type: "reset" });
    },
    edit: (text: string) => dispatch({ type: "edit", text }),
    takeTheirs: () => dispatch({ type: "takeTheirs" }),
    save: (text: string) =>
      conn.current?.saveNote(text, live.current.saved.version),
    rename: (raw: string) => {
      const name = cleanName(raw);
      if (!name) return false;
      try {
        localStorage.setItem(NAME_KEY, name);
      } catch {
        /* storage unavailable: the name still applies for this session */
      }
      conn.current?.rename(name);
      return true;
    },
  };
}
export type RoomCollab = ReturnType<typeof useRoomCollab>;
