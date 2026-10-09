import { useId, useState } from "react";
import { Crown, StickyNote, Users } from "lucide-react";
import type { RoomCollab } from "../hooks/useRoomCollab";
import { savedName } from "../hooks/useRoomCollab";
import {
  MAX_NAME_LENGTH,
  MAX_NOTE_BYTES,
  isDirty,
  noteBytes,
} from "../lib/collab";

/** Who is in the room, plus one note everyone can edit (last save wins). */
export function RoomPanel({ collab }: { collab: RoomCollab }) {
  const { presence, selfId, note } = collab;
  const id = useId();
  const [name, setName] = useState(savedName);
  const [nameSaved, setNameSaved] = useState(false);
  const dirty = isDirty(note);
  const bytes = noteBytes(note.draft);
  const tooLong = bytes > MAX_NOTE_BYTES;
  const by = note.saved.byName;
  return (
    <section className="panel room-panel" aria-labelledby={`${id}-title`}>
      <div className="panel-heading">
        <h2 id={`${id}-title`}>
          <Users size={15} aria-hidden="true" />
          In this room
        </h2>
        <span className="badge">{presence.participants.length}</span>
      </div>
      <div className="room-panel-body">
        <ul className="participants" aria-label="Participants">
          {presence.participants.map((p) => (
            <li key={p.id}>
              <span className="participant-name">{p.name}</span>
              {p.id === selfId && <span className="muted"> (you)</span>}
              {p.role === "publisher" && (
                <span className="participant-role">
                  <Crown size={12} aria-hidden="true" /> Host
                </span>
              )}
            </li>
          ))}
        </ul>
        {/* Join/leave news for screen readers; the list above is the visual record. */}
        <div className="sr-only" role="status" aria-live="polite">
          {collab.announcement}
        </div>

        <form
          className="room-name"
          onSubmit={(e) => {
            e.preventDefault();
            setNameSaved(collab.rename(name));
          }}
        >
          <label htmlFor={`${id}-name`}>Your name</label>
          <div>
            <input
              id={`${id}-name`}
              value={name}
              maxLength={MAX_NAME_LENGTH}
              placeholder="Anonymous"
              autoComplete="nickname"
              onChange={(e) => {
                setName(e.target.value);
                setNameSaved(false);
              }}
            />
            <button className="button secondary" type="submit">
              {nameSaved ? "Saved" : "Set name"}
            </button>
          </div>
        </form>

        <div className="room-note">
          <h3 className="room-note-title">
            <StickyNote size={14} aria-hidden="true" />
            Shared note
          </h3>
          <label htmlFor={`${id}-note`} className="muted">
            Everyone in the room can edit this. If two people save, the later
            save wins.
          </label>
          <textarea
            id={`${id}-note`}
            value={note.draft}
            rows={5}
            aria-describedby={`${id}-note-meta`}
            aria-invalid={tooLong}
            onChange={(e) => collab.edit(e.target.value)}
          />
          <div className="room-note-actions">
            <span id={`${id}-note-meta`} className="muted">
              {note.saved.version === 0
                ? "Not saved yet"
                : `Version ${note.saved.version}${by ? ` · saved by ${by}` : ""}`}
              {" · "}
              {bytes}/{MAX_NOTE_BYTES} bytes
              {tooLong ? " (too long to save)" : ""}
            </span>
            <button
              className="button primary"
              type="button"
              disabled={!dirty || tooLong}
              onClick={() => collab.save(note.draft)}
            >
              Save note
            </button>
          </div>
          {note.behind && (
            <p className="room-note-warning" role="alert">
              {note.behind.byName ?? "Someone"} saved version{" "}
              {note.behind.version} while you were editing. Saving now will
              replace it.{" "}
              <button
                className="link-button"
                type="button"
                onClick={collab.takeTheirs}
              >
                Use their version instead
              </button>
            </p>
          )}
          <div role="status" aria-live="polite" className="muted">
            {note.lastSave?.overwrote
              ? `Saved as version ${note.lastSave.version}. This replaced a newer note you had not seen.`
              : note.lastSave
                ? `Saved as version ${note.lastSave.version}.`
                : ""}
          </div>
        </div>
      </div>
    </section>
  );
}
