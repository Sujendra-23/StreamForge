package signaling

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// readUntil returns the first message of the given type, skipping others (the
// per-second "room" ticks, connection events, ...).
func readUntil(t *testing.T, c *websocket.Conn, typ string, match func(map[string]any) bool) map[string]any {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithDeadline(context.Background(), deadline)
		var v map[string]any
		err := wsjson.Read(ctx, c, &v)
		cancel()
		if err != nil {
			t.Fatalf("waiting for %q: %v", typ, err)
		}
		if v["type"] == typ && (match == nil || match(v)) {
			return v
		}
	}
	t.Fatalf("no %q message", typ)
	return nil
}

func names(v map[string]any) string {
	var out []string
	for _, p := range v["participants"].([]any) {
		out = append(out, p.(map[string]any)["name"].(string))
	}
	return strings.Join(out, ",")
}

// joinRoom publishes "room-x" and returns the publisher plus a function that
// connects viewers. Viewers normally wait for media; there is none in these
// tests, so the room is told to expect no tracks (under the server lock, which
// the viewer handler also takes, so the race detector sees the ordering).
func joinRoom(t *testing.T, s *Server, h *httptest.Server, token string) (*websocket.Conn, map[string]any, func(name string) (*websocket.Conn, map[string]any)) {
	t.Helper()
	pub := dial(t, h.URL)
	write(t, pub, message{Type: "publish", RoomID: "room-x", Title: "Collab", Name: "Presenter", Token: token})
	ready := readUntil(t, pub, "ready", nil)
	s.mu.Lock()
	s.rooms["room-x"].ExpectedTracks = 0
	s.mu.Unlock()
	viewerToken, _ := ready["viewerToken"].(string)
	return pub, ready, func(name string) (*websocket.Conn, map[string]any) {
		v := dial(t, h.URL)
		write(t, v, message{Type: "subscribe", RoomID: "room-x", Name: name, Token: viewerToken})
		return v, readUntil(t, v, "ready", nil)
	}
}

func TestPresenceJoinAndLeaveReachEveryone(t *testing.T) {
	s, h := newTestServer(t)
	pub, ready, viewer := joinRoom(t, s, h, "")
	if ready["participantId"] == "" || ready["participantId"] == nil {
		t.Fatalf("ready must carry the participant id: %v", ready)
	}
	first := readUntil(t, pub, "presence", nil)
	if names(first) != "Presenter" {
		t.Fatalf("publisher should see itself first: %v", first)
	}

	ana, anaReady := viewer("Ana")
	if anaReady["participantId"] == ready["participantId"] {
		t.Fatal("participant ids must be unique")
	}
	both := func(v map[string]any) bool { return names(v) == "Presenter,Ana" }
	got := readUntil(t, pub, "presence", both)
	if got["version"].(float64) <= first["version"].(float64) {
		t.Fatal("presence version must increase")
	}
	readUntil(t, ana, "presence", both) // a newcomer gets the full list at once

	ben, _ := viewer("") // no name: the server assigns "Viewer xxxx"
	three := readUntil(t, pub, "presence", func(v map[string]any) bool { return len(v["participants"].([]any)) == 3 })
	if !strings.Contains(names(three), "Viewer ") {
		t.Fatalf("default name missing: %s", names(three))
	}

	ana.Close(websocket.StatusNormalClosure, "bye")
	readUntil(t, pub, "presence", func(v map[string]any) bool {
		return len(v["participants"].([]any)) == 2 && !strings.Contains(names(v), "Ana")
	})
	write(t, ben, message{Type: "leave"})
	readUntil(t, pub, "presence", func(v map[string]any) bool { return names(v) == "Presenter" })
}

func TestRenameIsBroadcastAndSanitised(t *testing.T) {
	s, h := newTestServer(t)
	pub, _, viewer := joinRoom(t, s, h, "")
	ana, _ := viewer("Ana")
	readUntil(t, pub, "presence", func(v map[string]any) bool { return names(v) == "Presenter,Ana" })

	write(t, ana, message{Type: "rename", Name: "  Ana ‮ Maria  "})
	readUntil(t, pub, "presence", func(v map[string]any) bool { return names(v) == "Presenter,Ana Maria" })
	write(t, ana, message{Type: "rename", Name: "   "})
	if e := readUntil(t, ana, "error", nil); e["error"] != "Name cannot be empty" {
		t.Fatalf("blank rename: %v", e)
	}
}

func TestSharedNoteIsLastWriterWinsAndVersioned(t *testing.T) {
	s, h := newTestServer(t)
	pub, _, viewer := joinRoom(t, s, h, "")
	ana, _ := viewer("Ana")

	// Everyone starts from the empty note at version 0.
	for _, c := range []*websocket.Conn{pub, ana} {
		if n := readUntil(t, c, "note", nil)["note"].(map[string]any); n["version"].(float64) != 0 || n["text"] != "" {
			t.Fatalf("initial note: %v", n)
		}
	}

	text := func(s string) *string { return &s }
	zero := uint64(0)
	write(t, pub, message{Type: "note", Text: text("agenda: intro"), BaseVersion: &zero})
	ack := readUntil(t, pub, "note_ack", nil)
	if ack["version"].(float64) != 1 || ack["overwrote"] != false {
		t.Fatalf("first write ack: %v", ack)
	}
	got := readUntil(t, ana, "note", func(v map[string]any) bool { return v["note"].(map[string]any)["version"].(float64) == 1 })["note"].(map[string]any)
	if got["text"] != "agenda: intro" || got["byName"] != "Presenter" {
		t.Fatalf("viewer's copy: %v", got)
	}

	// Ana edits from the stale version 0 and overwrites the presenter's note.
	write(t, ana, message{Type: "note", Text: text("agenda: Q&A"), BaseVersion: &zero})
	ack = readUntil(t, ana, "note_ack", nil)
	if ack["version"].(float64) != 2 || ack["overwrote"] != true {
		t.Fatalf("stale write ack: %v", ack)
	}
	final := readUntil(t, pub, "note", func(v map[string]any) bool { return v["note"].(map[string]any)["version"].(float64) == 2 })["note"].(map[string]any)
	if final["text"] != "agenda: Q&A" || final["byName"] != "Ana" {
		t.Fatalf("last writer must win: %v", final)
	}
}

func TestNoteRejectsBadInputWithoutClosingTheSocket(t *testing.T) {
	s, h := newTestServer(t)
	pub, _, _ := joinRoom(t, s, h, "")
	write(t, pub, message{Type: "note"})
	if e := readUntil(t, pub, "error", nil); e["error"] != "Missing note text" {
		t.Fatalf("missing text: %v", e)
	}
	big := strings.Repeat("x", 5000)
	write(t, pub, message{Type: "note", Text: &big})
	if e := readUntil(t, pub, "error", nil); !strings.Contains(e["error"].(string), "too long") {
		t.Fatalf("oversized note: %v", e)
	}
	ok := "still alive"
	write(t, pub, message{Type: "note", Text: &ok})
	readUntil(t, pub, "note_ack", nil)
}

func TestProtectedRoomCollabNeedsTheSameTokens(t *testing.T) {
	s, err := New(Config{AuthSecret: "operator-secret"})
	if err != nil {
		t.Fatal(err)
	}
	h := httptest.NewServer(s.Handler())
	t.Cleanup(func() { s.Close(); h.Close() })
	pub, _, viewer := joinRoom(t, s, h, "operator-secret")
	ana, _ := viewer("Ana") // joins with the signed viewer token
	readUntil(t, pub, "presence", func(v map[string]any) bool { return names(v) == "Presenter,Ana" })

	// Without a valid viewer token a socket never becomes a participant, so it can neither see nor edit anything.
	intruder := dial(t, h.URL)
	write(t, intruder, message{Type: "subscribe", RoomID: "room-x", Name: "Mallory", Token: "guess"})
	if v := read(t, intruder); v["type"] != "error" {
		t.Fatalf("intruder: %v", v)
	}
	text := "x"
	write(t, intruder, message{Type: "note", Text: &text})
	time.Sleep(100 * time.Millisecond)
	s.mu.RLock()
	version := s.rooms["room-x"].Collab.Note().Version
	s.mu.RUnlock()
	if version != 0 {
		t.Fatal("an unauthenticated socket changed the note")
	}
	_ = ana
}

func TestCollabStateDiesWithTheRoom(t *testing.T) {
	s, h := newTestServer(t)
	pub, _, viewer := joinRoom(t, s, h, "")
	ana, _ := viewer("Ana")
	text := "ephemeral"
	write(t, pub, message{Type: "note", Text: &text})
	readUntil(t, ana, "note", func(v map[string]any) bool { return v["note"].(map[string]any)["version"].(float64) == 1 })

	write(t, pub, message{Type: "leave"})
	readUntil(t, ana, "ended", nil)
	deadline := time.Now().Add(time.Second)
	for len(s.snapshots()) != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}

	// A new stream under the same id starts with an empty note and only its own publisher.
	pub2, _, _ := joinRoom(t, s, h, "")
	// The server sends presence, then the note, as soon as a socket becomes a participant.
	if p := readUntil(t, pub2, "presence", nil); names(p) != "Presenter" {
		t.Fatalf("presence leaked into the next session: %v", p)
	}
	n := readUntil(t, pub2, "note", nil)["note"].(map[string]any)
	if n["version"].(float64) != 0 || n["text"] != "" {
		t.Fatalf("note leaked into the next session: %v", n)
	}
}
