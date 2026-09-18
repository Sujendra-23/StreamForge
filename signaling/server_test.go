package signaling

import (
	"context"
	"encoding/json"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func newTestServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	s, err := New(Config{})
	if err != nil {
		t.Fatal(err)
	}
	h := httptest.NewServer(s.Handler())
	t.Cleanup(func() { s.Close(); h.Close() })
	return s, h
}
func dial(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*5)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(url, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ws.CloseNow() })
	return ws
}
func read(t *testing.T, c *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*5)
	defer cancel()
	var v map[string]any
	if err := wsjson.Read(ctx, c, &v); err != nil {
		t.Fatal(err)
	}
	return v
}
func write(t *testing.T, c *websocket.Conn, v any) {
	t.Helper()
	if err := wsjson.Write(context.Background(), c, v); err != nil {
		t.Fatal(err)
	}
}
func TestPublishOwnershipAndCleanup(t *testing.T) {
	s, h := newTestServer(t)
	publisher := dial(t, h.URL)
	write(t, publisher, message{Type: "publish", RoomID: "test-room", Title: "A test"})
	if v := read(t, publisher); v["type"] != "ready" {
		t.Fatalf("unexpected response %v", v)
	}
	other := dial(t, h.URL)
	write(t, other, message{Type: "publish", RoomID: "test-room"})
	if v := read(t, other); v["type"] != "error" {
		t.Fatalf("duplicate publisher allowed %v", v)
	}
	write(t, publisher, message{Type: "leave"})
	deadline := time.Now().Add(time.Second)
	for len(s.snapshots()) != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if len(s.snapshots()) != 0 {
		t.Fatal("room leaked after leave")
	}
}
func TestInvalidRoomsAndOrigins(t *testing.T) {
	_, h := newTestServer(t)
	c := dial(t, h.URL)
	write(t, c, message{Type: "subscribe", RoomID: "../admin"})
	if read(t, c)["type"] != "error" {
		t.Fatal("invalid room accepted")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c2, res, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(h.URL, "http")+"/ws", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"https://untrusted.example"}}})
	if err == nil {
		c2.CloseNow()
		t.Fatal("cross-origin websocket accepted")
	}
	if res.StatusCode != 403 {
		t.Fatalf("expected 403, got %d", res.StatusCode)
	}
}
func TestHealthAndEmptyMetrics(t *testing.T) {
	_, h := newTestServer(t)
	r, err := http.Get(h.URL + "/api/rooms")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	var rooms []any
	if err = json.NewDecoder(r.Body).Decode(&rooms); err != nil || len(rooms) != 0 {
		t.Fatal("invalid room response")
	}
	m, err := http.Get(h.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	defer m.Body.Close()
	body, _ := io.ReadAll(m.Body)
	if !strings.Contains(string(body), "streamforge_rooms 0") {
		t.Fatal("missing metrics")
	}
}

func TestProtectedRoomsRequirePublisherAndViewerTokens(t *testing.T) {
	s, err := New(Config{AuthSecret: "operator-secret"})
	if err != nil {
		t.Fatal(err)
	}
	h := httptest.NewServer(s.Handler())
	t.Cleanup(func() { s.Close(); h.Close() })

	response, err := http.Get(h.URL + "/api/rooms")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected protected room list, got %d", response.StatusCode)
	}

	unauthorized := dial(t, h.URL)
	write(t, unauthorized, message{Type: "publish", RoomID: "secure-room"})
	if v := read(t, unauthorized); v["type"] != "error" {
		t.Fatalf("publisher without token was allowed: %v", v)
	}

	publisher := dial(t, h.URL)
	write(t, publisher, message{Type: "publish", RoomID: "secure-room", Token: "operator-secret"})
	ready := read(t, publisher)
	viewerToken, ok := ready["viewerToken"].(string)
	if ready["type"] != "ready" || !ok || viewerToken == "" {
		t.Fatalf("missing signed viewer token: %v", ready)
	}

	viewer := dial(t, h.URL)
	write(t, viewer, message{Type: "subscribe", RoomID: "secure-room"})
	if v := read(t, viewer); v["type"] != "error" {
		t.Fatalf("viewer without token was allowed: %v", v)
	}
}

func TestSessionHistoryPersistsAcrossRestarts(t *testing.T) {
	path := t.TempDir() + "/history.jsonl"
	s, err := New(Config{HistoryPath: path})
	if err != nil {
		t.Fatal(err)
	}
	h := httptest.NewServer(s.Handler())
	publisher := dial(t, h.URL)
	write(t, publisher, message{Type: "publish", RoomID: "history-room", Title: "Recorded session"})
	if v := read(t, publisher); v["type"] != "ready" {
		t.Fatalf("unexpected response %v", v)
	}
	write(t, publisher, message{Type: "leave"})
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		s.mu.RLock()
		count := len(s.history)
		s.mu.RUnlock()
		if count > 0 {
			break
		}
		time.Sleep(time.Millisecond)
	}
	h.Close()
	s.Close()

	restarted, err := New(Config{HistoryPath: path})
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	if len(restarted.history) != 1 || restarted.history[0].ID != "history-room" {
		t.Fatalf("history was not restored: %+v", restarted.history)
	}
}
