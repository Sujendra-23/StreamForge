package sfu

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

func join(t *testing.T, c *Collab, id, name, role string) func() {
	t.Helper()
	leave, err := c.Join(Participant{ID: id, Name: name, Role: role})
	if err != nil {
		t.Fatal(err)
	}
	return leave
}

func names(c *Collab) string {
	var out []string
	for _, p := range c.Presence().Participants {
		out = append(out, p.Name)
	}
	return strings.Join(out, ",")
}

func TestPresenceTracksJoinLeaveAndRenameWithMonotonicVersions(t *testing.T) {
	c := NewCollab()
	if v := c.Presence(); v.Version != 0 || len(v.Participants) != 0 {
		t.Fatalf("fresh room: %+v", v)
	}
	leaveHost := join(t, c, "h", "Host", "publisher")
	leaveAna := join(t, c, "a", "Ana", "viewer")
	v2 := c.Presence()
	if v2.Version != 2 || names(c) != "Host,Ana" || v2.Participants[0].Role != "publisher" {
		t.Fatalf("after joins: %+v", v2)
	}
	if err := c.Rename("a", "  Ana   María\t"); err != nil {
		t.Fatal(err)
	}
	if names(c) != "Host,Ana María" || c.Presence().Version != 3 {
		t.Fatalf("after rename: %s v%d", names(c), c.Presence().Version)
	}
	c.Rename("a", "Ana María") // same name: no new version
	if c.Presence().Version != 3 {
		t.Fatal("a no-op rename must not bump the version")
	}
	leaveAna()
	leaveAna() // idempotent
	if names(c) != "Host" || c.Presence().Version != 4 {
		t.Fatalf("after leave: %s v%d", names(c), c.Presence().Version)
	}
	leaveHost()
	if len(c.Presence().Participants) != 0 {
		t.Fatal("room should be empty")
	}
	if err := c.Rename("ghost", "x"); !errors.Is(err, ErrNotParticipant) {
		t.Fatalf("rename of a non-member: %v", err)
	}
	join(t, c, "z", "Zed", "viewer")
	if err := c.Rename("z", " ​ "); !errors.Is(err, ErrNameEmpty) {
		t.Fatalf("blank name accepted: %v", err)
	}
}

func TestParticipantsAreOrderedByJoinTime(t *testing.T) {
	c := NewCollab()
	base := time.Unix(1000, 0)
	c.Join(Participant{ID: "late", Name: "Late", Role: "viewer", JoinedAt: base.Add(time.Minute)})
	c.Join(Participant{ID: "early", Name: "Early", Role: "viewer", JoinedAt: base})
	if names(c) != "Early,Late" {
		t.Fatal(names(c))
	}
}

func TestRoomRefusesMoreThanMaxParticipants(t *testing.T) {
	c := NewCollab()
	for i := 0; i < MaxParticipants; i++ {
		join(t, c, fmt.Sprint("p", i), "x", "viewer")
	}
	if _, err := c.Join(Participant{ID: "extra"}); !errors.Is(err, ErrRoomFull) {
		t.Fatalf("got %v", err)
	}
}

func TestCleanName(t *testing.T) {
	cases := map[string]string{
		"  Ana  ":               "Ana",
		"A\x00b\nc":             "Ab c", // NUL dropped, newline is whitespace
		"two   words\t here":    "two words here",
		"‮evil":                 "evil", // bidi override stripped
		strings.Repeat("é", 40): strings.Repeat("é", MaxNameRunes),
		"<b onclick=x>hi</b>":   "<b onclick=x>hi</b>", // stored verbatim: the UI escapes
		"":                      "",
		"​​":                    "",
		"bad\xffbytes":          "badbytes",
	}
	for in, want := range cases {
		if got := CleanName(in); got != want {
			t.Errorf("CleanName(%q) = %q, want %q", in, got, want)
		}
	}
}

func u(v uint64) *uint64 { return &v }

func TestNoteLastWriterWinsWithVersionCounter(t *testing.T) {
	c := NewCollab()
	join(t, c, "a", "Ana", "viewer")
	join(t, c, "b", "Ben", "viewer")
	if n := c.Note(); n.Version != 0 || n.Text != "" {
		t.Fatalf("fresh note: %+v", n)
	}

	n1, over, err := c.SetNote("a", "plan: A", u(0))
	if err != nil || over || n1.Version != 1 || n1.ByName != "Ana" || n1.UpdatedAt.IsZero() {
		t.Fatalf("first write: %+v over=%v err=%v", n1, over, err)
	}
	// Ben still edits version 0: he is overwriting Ana's write without having seen it. He still wins.
	n2, over, err := c.SetNote("b", "plan: B", u(0))
	if err != nil || !over || n2.Version != 2 || n2.Text != "plan: B" || n2.ByID != "b" {
		t.Fatalf("stale write: %+v over=%v err=%v", n2, over, err)
	}
	// Ana writes based on the latest version: no conflict.
	n3, over, _ := c.SetNote("a", "plan: A2", u(2))
	if over || n3.Version != 3 {
		t.Fatalf("fresh write: %+v over=%v", n3, over)
	}
	// Ana's own stale base is not "overwriting someone else".
	if _, over, _ := c.SetNote("a", "plan: A3", u(1)); over {
		t.Fatal("overwriting your own newer write is not a conflict")
	}
	// Unknown base version (nil) is never reported as a conflict.
	if _, over, _ := c.SetNote("b", "plan: B2", nil); over {
		t.Fatal("nil base cannot conflict")
	}
	// Saving identical text changes nothing.
	before := c.Note()
	same, _, _ := c.SetNote("a", before.Text, u(before.Version))
	if same.Version != before.Version || c.Note().Version != before.Version {
		t.Fatal("identical text must not bump the version")
	}
}

func TestNoteValidation(t *testing.T) {
	c := NewCollab()
	join(t, c, "a", "Ana", "viewer")
	if _, _, err := c.SetNote("a", strings.Repeat("x", MaxNoteBytes+1), nil); !errors.Is(err, ErrNoteTooLarge) {
		t.Fatalf("too large: %v", err)
	}
	if _, _, err := c.SetNote("a", strings.Repeat("x", MaxNoteBytes), nil); err != nil {
		t.Fatalf("exactly at the limit: %v", err)
	}
	for _, bad := range []string{"a\x00b", "a\x1bb", "bad\xff", "x‮y"} {
		if _, _, err := c.SetNote("a", bad, nil); !errors.Is(err, ErrNoteInvalid) {
			t.Errorf("%q accepted: %v", bad, err)
		}
	}
	n, _, err := c.SetNote("a", "line1\r\nline2\ttab", nil)
	if err != nil || n.Text != "line1\nline2\ttab" {
		t.Fatalf("newlines/tabs should be allowed and normalised: %q %v", n.Text, err)
	}
	if _, _, err := c.SetNote("nobody", "x", nil); !errors.Is(err, ErrNotParticipant) {
		t.Fatalf("non-member write: %v", err)
	}
}

func TestNoteWritesAreRateLimitedPerParticipant(t *testing.T) {
	c := NewCollab()
	clock := time.Unix(1000, 0)
	c.now = func() time.Time { return clock }
	join(t, c, "a", "Ana", "viewer")
	join(t, c, "b", "Ben", "viewer")
	for i := 0; i < int(noteBurst); i++ {
		if _, _, err := c.SetNote("a", fmt.Sprint("v", i), nil); err != nil {
			t.Fatalf("write %d inside the burst: %v", i, err)
		}
	}
	if _, _, err := c.SetNote("a", "one too many", nil); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("burst exceeded: %v", err)
	}
	if _, _, err := c.SetNote("b", "Ben is unaffected", nil); err != nil {
		t.Fatalf("limits are per participant: %v", err)
	}
	clock = clock.Add(400 * time.Millisecond) // refills 2 tokens
	if _, _, err := c.SetNote("a", "after refill", nil); err != nil {
		t.Fatalf("after refill: %v", err)
	}
}

// Many participants hammer the note at once. Every accepted write gets a unique
// version, versions form 1..N with no gaps, and the final note is exactly the
// write that received version N. Run under -race.
func TestConcurrentWritersGetUniqueGaplessVersions(t *testing.T) {
	c := NewCollab()
	const writers = 40
	for i := 0; i < writers; i++ {
		join(t, c, fmt.Sprint("w", i), fmt.Sprint("W", i), "viewer")
	}
	var mu sync.Mutex
	versions := map[uint64]string{}
	var wg sync.WaitGroup
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			text := fmt.Sprint("note from ", i)
			n, _, err := c.SetNote(fmt.Sprint("w", i), text, nil)
			if err != nil {
				t.Error(err)
				return
			}
			mu.Lock()
			defer mu.Unlock()
			if prev, dup := versions[n.Version]; dup {
				t.Errorf("version %d issued twice (%q and %q)", n.Version, prev, text)
			}
			versions[n.Version] = text
		}(i)
	}
	wg.Wait()
	for v := uint64(1); v <= writers; v++ {
		if _, ok := versions[v]; !ok {
			t.Fatalf("version %d missing: versions must be gapless", v)
		}
	}
	if final := c.Note(); final.Version != writers || final.Text != versions[writers] {
		t.Fatalf("final note %+v, want the write that got version %d (%q)", final, writers, versions[writers])
	}
}

func TestSubscribersAreNotifiedAndCoalesce(t *testing.T) {
	c := NewCollab()
	ch, cancel := c.Subscribe()
	join(t, c, "a", "Ana", "viewer")
	select {
	case <-ch:
	case <-time.After(time.Second):
		t.Fatal("no notification for a join")
	}
	// Many changes while the subscriber is busy collapse into one pending wake-up; nobody blocks.
	done := make(chan struct{})
	go func() {
		for i := 0; i < 100; i++ {
			c.Rename("a", fmt.Sprint("name", i))
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("a slow subscriber blocked writers")
	}
	<-ch
	select {
	case <-ch:
		t.Fatal("notifications should have coalesced into one")
	default:
	}
	if c.Presence().Participants[0].Name != "name99" {
		t.Fatal("reading state after the wake-up must yield the latest state")
	}
	cancel()
	c.Rename("a", "after-cancel")
	select {
	case <-ch:
		t.Fatal("cancelled subscriber was notified")
	default:
	}
}
