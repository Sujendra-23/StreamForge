package sfu

import (
	"errors"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

// Collab is the shared state of one room besides media: who is in it, and one
// shared note. Both live exactly as long as the room (nothing is persisted).
//
// Consumers do not receive diffs. Collab bumps a version on every change and
// pokes subscribers through a capacity-1 channel; a subscriber then reads the
// latest state. A slow client therefore skips intermediate states instead of
// queueing them or blocking everyone else, and can never see an older state
// after a newer one.
type Collab struct {
	mu           sync.Mutex
	participants map[string]*participant
	presenceVer  uint64
	note         Note
	subs         map[chan struct{}]struct{}
	now          func() time.Time
}

type participant struct {
	Participant
	tokens float64   // note-write rate limiter
	refill time.Time // last refill
}

// Participant is one socket connected to the room, publisher or viewer.
type Participant struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Role     string    `json:"role"` // "publisher" or "viewer"
	JoinedAt time.Time `json:"joinedAt"`
}

// Presence is the full participant list at one version.
type Presence struct {
	Version      uint64        `json:"version"`
	Participants []Participant `json:"participants"`
}

// Note is the room's shared note. Version counts accepted writes (0 = never
// written); the writer whose request is applied last wins, whatever it saw.
type Note struct {
	Text      string    `json:"text"`
	Version   uint64    `json:"version"`
	ByID      string    `json:"byId,omitempty"`
	ByName    string    `json:"byName,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
}

const (
	MaxNoteBytes    = 4096
	MaxNameRunes    = 24
	MaxParticipants = 128
	noteBurst       = 5.0 // writes allowed in a burst
	noteRatePerSec  = 5.0 // sustained writes per second per participant
)

var (
	ErrNoteTooLarge   = errors.New("Note is too long (4096 bytes at most)")
	ErrNoteInvalid    = errors.New("Note must be valid text without control characters")
	ErrRateLimited    = errors.New("Too many note edits; slow down")
	ErrRoomFull       = errors.New("This room has too many participants")
	ErrNotParticipant = errors.New("Not a participant of this room")
	ErrNameEmpty      = errors.New("Name cannot be empty")
)

func NewCollab() *Collab {
	return &Collab{participants: map[string]*participant{}, subs: map[chan struct{}]struct{}{}, now: time.Now}
}

// CleanName makes a display name safe to show to others: no control or
// formatting characters, single spaces, at most MaxNameRunes runes. It may
// return "".
func CleanName(s string) string {
	var b strings.Builder
	space := false
	for _, r := range s {
		switch {
		case unicode.IsSpace(r):
			space = b.Len() > 0
		case unicode.IsControl(r) || unicode.Is(unicode.Cf, r) || r == utf8.RuneError:
		default:
			if space {
				b.WriteByte(' ')
				space = false
			}
			b.WriteRune(r)
		}
	}
	out := []rune(b.String())
	if len(out) > MaxNameRunes {
		out = out[:MaxNameRunes]
	}
	return strings.TrimSpace(string(out))
}

// Join adds a participant and returns the function that removes it (safe to
// call more than once).
func (c *Collab) Join(p Participant) (leave func(), err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.participants) >= MaxParticipants {
		return nil, ErrRoomFull
	}
	if p.JoinedAt.IsZero() {
		p.JoinedAt = c.now().UTC()
	}
	c.participants[p.ID] = &participant{Participant: p, tokens: noteBurst, refill: c.now()}
	c.presenceVer++
	c.notifyLocked()
	var once sync.Once
	return func() {
		once.Do(func() {
			c.mu.Lock()
			defer c.mu.Unlock()
			if _, ok := c.participants[p.ID]; ok {
				delete(c.participants, p.ID)
				c.presenceVer++
				c.notifyLocked()
			}
		})
	}, nil
}

// Rename changes a participant's display name.
func (c *Collab) Rename(id, name string) error {
	name = CleanName(name)
	if name == "" {
		return ErrNameEmpty
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	p, ok := c.participants[id]
	if !ok {
		return ErrNotParticipant
	}
	if p.Name != name {
		p.Name = name
		c.presenceVer++
		c.notifyLocked()
	}
	return nil
}

// Presence returns everyone in the room, oldest join first.
func (c *Collab) Presence() Presence {
	c.mu.Lock()
	defer c.mu.Unlock()
	list := make([]Participant, 0, len(c.participants))
	for _, p := range c.participants {
		list = append(list, p.Participant)
	}
	sort.Slice(list, func(i, j int) bool {
		if !list[i].JoinedAt.Equal(list[j].JoinedAt) {
			return list[i].JoinedAt.Before(list[j].JoinedAt)
		}
		return list[i].ID < list[j].ID
	})
	return Presence{Version: c.presenceVer, Participants: list}
}

// Note returns the current shared note.
func (c *Collab) Note() Note {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.note
}

func validNoteText(s string) (string, error) {
	if len(s) > MaxNoteBytes {
		return "", ErrNoteTooLarge
	}
	if !utf8.ValidString(s) {
		return "", ErrNoteInvalid
	}
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
	for _, r := range s {
		if r != '\n' && r != '\t' && (unicode.IsControl(r) || unicode.Is(unicode.Cf, r)) {
			return "", ErrNoteInvalid
		}
	}
	return s, nil
}

// SetNote applies a write from a participant. It always wins over what is
// stored (last writer wins) and bumps the version, unless the text is
// unchanged, which is a no-op so repeated saves do not spam the room.
//
// baseVersion is the note version the writer's edit was based on, or nil if
// unknown. overwrote reports that someone else's newer write was replaced: the
// writer had not seen it. The write still happens; the flag lets a UI say so.
func (c *Collab) SetNote(authorID, text string, baseVersion *uint64) (n Note, overwrote bool, err error) {
	text, err = validNoteText(text)
	if err != nil {
		return Note{}, false, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	p, ok := c.participants[authorID]
	if !ok {
		return Note{}, false, ErrNotParticipant
	}
	now := c.now()
	p.tokens = min(noteBurst, p.tokens+now.Sub(p.refill).Seconds()*noteRatePerSec)
	p.refill = now
	if p.tokens < 1 {
		return c.note, false, ErrRateLimited
	}
	p.tokens--
	if text == c.note.Text && c.note.Version > 0 {
		return c.note, false, nil
	}
	overwrote = baseVersion != nil && *baseVersion < c.note.Version && c.note.ByID != authorID
	c.note = Note{Text: text, Version: c.note.Version + 1, ByID: p.ID, ByName: p.Name, UpdatedAt: now.UTC()}
	c.notifyLocked()
	return c.note, overwrote, nil
}

// Subscribe returns a channel that receives a value whenever presence or the
// note may have changed (values coalesce), and a cancel function.
func (c *Collab) Subscribe() (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	c.mu.Lock()
	c.subs[ch] = struct{}{}
	c.mu.Unlock()
	return ch, func() {
		c.mu.Lock()
		delete(c.subs, ch)
		c.mu.Unlock()
	}
}

func (c *Collab) notifyLocked() {
	for ch := range c.subs {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}
