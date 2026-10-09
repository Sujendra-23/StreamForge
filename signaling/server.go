package signaling

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
	"streamforge/sfu"
)

type Config struct {
	Origins        []string
	WebDir         string
	ICE            []webrtc.ICEServer
	UDPMin, UDPMax uint16
	PublicIP       string
	AuthSecret     string
	HistoryPath    string
}
type Server struct {
	mu      sync.RWMutex
	rooms   map[string]*sfu.Room
	history []SessionRecord
	api     *webrtc.API
	config  Config
	started time.Time
}
type SessionRecord struct {
	sfu.Snapshot
	EndedAt time.Time `json:"endedAt"`
}
type RoomView struct {
	sfu.Snapshot
	ViewerToken string `json:"viewerToken,omitempty"`
}
type message struct {
	Tracks    int                        `json:"tracks,omitempty"`
	Metrics   *sfu.QoE                   `json:"metrics,omitempty"`
	Type      string                     `json:"type"`
	RoomID    string                     `json:"roomId,omitempty"`
	Title     string                     `json:"title,omitempty"`
	SDP       *webrtc.SessionDescription `json:"sdp,omitempty"`
	Candidate *webrtc.ICECandidateInit   `json:"candidate,omitempty"`
	Network   *sfu.Network               `json:"network,omitempty"`
	Error     string                     `json:"error,omitempty"`
	Token     string                     `json:"token,omitempty"`
	// Presence and shared note (see docs/protocol.md).
	Name        string  `json:"name,omitempty"`
	Text        *string `json:"text,omitempty"`
	BaseVersion *uint64 `json:"baseVersion,omitempty"`
}

var validID = regexp.MustCompile(`^[a-zA-Z0-9_-]{3,48}$`)

func New(c Config) (*Server, error) {
	settings := webrtc.SettingEngine{}
	if c.UDPMin != 0 {
		if err := settings.SetEphemeralUDPPortRange(c.UDPMin, c.UDPMax); err != nil {
			return nil, err
		}
	}
	if c.PublicIP != "" {
		settings.SetNAT1To1IPs([]string{c.PublicIP}, webrtc.ICECandidateTypeHost)
	}
	s := &Server{rooms: make(map[string]*sfu.Room), api: webrtc.NewAPI(webrtc.WithSettingEngine(settings)), config: c, started: time.Now()}
	if err := s.loadHistory(); err != nil {
		return nil, err
	}
	return s, nil
}
func (s *Server) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.rooms {
		r.Close()
	}
	s.rooms = make(map[string]*sfu.Room)
}
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, map[string]any{"status": "ok", "service": "streamforge", "version": "0.1.0"})
	})
	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, map[string]any{"iceServers": s.iceServers(), "region": "local", "maxViewers": 100, "transport": "WebRTC / Pion SFU", "authRequired": s.config.AuthSecret != "", "historyEnabled": s.config.HistoryPath != ""})
	})
	mux.HandleFunc("GET /api/rooms", func(w http.ResponseWriter, r *http.Request) {
		if !s.authorizeOperator(w, r) {
			return
		}
		jsonResponse(w, s.snapshots())
	})
	mux.HandleFunc("GET /api/rooms/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !s.authorizeOperator(w, r) {
			return
		}
		s.mu.RLock()
		room := s.rooms[r.PathValue("id")]
		s.mu.RUnlock()
		if room == nil {
			http.Error(w, "Stream is offline", 404)
			return
		}
		jsonResponse(w, RoomView{Snapshot: room.Snapshot(), ViewerToken: s.viewerToken(room.ID, room.StartedAt)})
	})
	mux.HandleFunc("GET /api/history", func(w http.ResponseWriter, r *http.Request) {
		if !s.authorizeOperator(w, r) {
			return
		}
		s.mu.RLock()
		history := append([]SessionRecord(nil), s.history...)
		s.mu.RUnlock()
		jsonResponse(w, history)
	})
	mux.HandleFunc("GET /metrics", s.metrics)
	mux.HandleFunc("GET /ws", s.socket)
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(s.config.WebDir, filepath.Clean("/"+r.URL.Path))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			http.ServeFile(w, r, path)
			return
		}
		if strings.Contains(filepath.Base(r.URL.Path), ".") {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(s.config.WebDir, "index.html"))
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		mux.ServeHTTP(w, r)
	})
}

func (s *Server) authorizeOperator(w http.ResponseWriter, r *http.Request) bool {
	if s.config.AuthSecret == "" {
		return true
	}
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !hmac.Equal([]byte(token), []byte(s.config.AuthSecret)) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return false
	}
	return true
}

func (s *Server) viewerToken(roomID string, startedAt time.Time) string {
	if s.config.AuthSecret == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(s.config.AuthSecret))
	_, _ = mac.Write([]byte(fmt.Sprintf("viewer:%s:%d", roomID, startedAt.UnixNano())))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Server) loadHistory() error {
	if s.config.HistoryPath == "" {
		return nil
	}
	data, err := os.ReadFile(s.config.HistoryPath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read history: %w", err)
	}
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		if line == "" {
			continue
		}
		var record SessionRecord
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			return fmt.Errorf("decode history: %w", err)
		}
		s.history = append(s.history, record)
	}
	return nil
}

func (s *Server) recordSession(snapshot sfu.Snapshot) {
	if s.config.HistoryPath == "" {
		return
	}
	record := SessionRecord{Snapshot: snapshot, EndedAt: time.Now().UTC()}
	data, err := json.Marshal(record)
	if err != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.history = append(s.history, record)
	if len(s.history) > 1000 {
		s.history = s.history[len(s.history)-1000:]
	}
	if err = os.MkdirAll(filepath.Dir(s.config.HistoryPath), 0700); err != nil {
		log.Printf("create history directory: %v", err)
		return
	}
	f, err := os.OpenFile(s.config.HistoryPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		log.Printf("open history: %v", err)
		return
	}
	defer f.Close()
	if _, err = f.Write(append(data, '\n')); err != nil {
		log.Printf("write history: %v", err)
	}
}
func jsonResponse(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}
func (s *Server) snapshots() []RoomView {
	s.mu.RLock()
	defer s.mu.RUnlock()
	a := make([]RoomView, 0, len(s.rooms))
	for _, r := range s.rooms {
		a = append(a, RoomView{Snapshot: r.Snapshot(), ViewerToken: s.viewerToken(r.ID, r.StartedAt)})
	}
	sort.Slice(a, func(i, j int) bool { return a[i].StartedAt.Before(a[j].StartedAt) })
	return a
}
func (s *Server) iceServers() []webrtc.ICEServer {
	ice := append([]webrtc.ICEServer{}, s.config.ICE...)
	if secret, url := os.Getenv("TURN_SECRET"), os.Getenv("TURN_URL"); secret != "" && url != "" {
		username := fmt.Sprintf("%d:streamforge", time.Now().Add(time.Hour).Unix())
		mac := hmac.New(sha1.New, []byte(secret))
		_, _ = mac.Write([]byte(username))
		ice = append(ice, webrtc.ICEServer{URLs: []string{url}, Username: username, Credential: base64.StdEncoding.EncodeToString(mac.Sum(nil))})
	}
	return ice
}
func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	rooms := s.snapshots()
	fmt.Fprintf(w, "# TYPE streamforge_rooms gauge\nstreamforge_rooms %d\n# TYPE streamforge_uptime_seconds gauge\nstreamforge_uptime_seconds %.0f\n", len(rooms), time.Since(s.started).Seconds())
	for _, room := range rooms {
		for name, value := range map[string]float64{"video_bitrate_mbps": room.PublisherQoE.Bitrate, "video_fps": room.PublisherQoE.FPS, "publisher_rtt_ms": room.PublisherQoE.RTT, "publisher_loss_percent": room.PublisherQoE.Loss, "publisher_jitter_ms": room.PublisherQoE.Jitter, "encode_ms": room.PublisherQoE.EncodeMs, "viewer_loss_percent": room.ViewerQoE.Loss, "viewer_jitter_ms": room.ViewerQoE.Jitter, "viewer_rtt_ms": room.ViewerQoE.RTT, "decode_ms": room.ViewerQoE.DecodeMs} {
			fmt.Fprintf(w, "streamforge_%s{room=%q} %.4f\n", name, room.ID, value)
		}
		fmt.Fprintf(w, "streamforge_viewers{room=%q} %d\nstreamforge_received_bytes_total{room=%q} %d\nstreamforge_forwarded_packets_total{room=%q} %d\nstreamforge_dropped_packets_total{room=%q} %d\nstreamforge_network_loss_percent{room=%q} %.2f\n", room.ID, room.Viewers, room.ID, room.ReceivedBytes, room.ID, room.ForwardedPackets, room.ID, room.DroppedPackets, room.ID, room.Network.LossPercent)
	}
}

func (s *Server) socket(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: s.config.Origins})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(128 * 1024)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	var sendMu sync.Mutex
	send := func(v any) error {
		sendMu.Lock()
		defer sendMu.Unlock()
		c, done := context.WithTimeout(ctx, 5*time.Second)
		defer done()
		return wsjson.Write(c, conn, v)
	}
	fail := func(reason string) { _ = send(message{Type: "error", Error: reason}) }
	var first message
	joinCtx, joinCancel := context.WithTimeout(ctx, 10*time.Second)
	err = wsjson.Read(joinCtx, conn, &first)
	joinCancel()
	if err != nil {
		return
	}
	if first.Type != "publish" && first.Type != "subscribe" {
		fail("First message must publish or subscribe")
		return
	}
	if first.RoomID == "" && first.Type == "publish" {
		b := make([]byte, 6)
		_, _ = rand.Read(b)
		first.RoomID = hex.EncodeToString(b)
	}
	if !validID.MatchString(first.RoomID) {
		fail("Invalid stream ID")
		return
	}
	pc, err := s.api.NewPeerConnection(webrtc.Configuration{ICEServers: s.iceServers()})
	if err != nil {
		fail("Cannot create peer connection")
		return
	}
	defer pc.Close()
	var room *sfu.Room
	publisher := first.Type == "publish"
	if publisher {
		if s.config.AuthSecret != "" && !hmac.Equal([]byte(first.Token), []byte(s.config.AuthSecret)) {
			fail("Publisher authentication failed")
			return
		}
		title := strings.TrimSpace(first.Title)
		if title == "" {
			title = "Untitled stream"
		}
		if len(title) > 120 {
			fail("Stream title is too long")
			return
		}
		s.mu.Lock()
		if s.rooms[first.RoomID] != nil || len(s.rooms) >= 32 {
			s.mu.Unlock()
			fail("Stream ID is in use or server is at capacity")
			return
		}
		room = sfu.NewRoom(first.RoomID, title, pc)
		if first.Tracks >= 1 && first.Tracks <= 2 {
			room.ExpectedTracks = first.Tracks
		}
		s.rooms[room.ID] = room
		s.mu.Unlock()
		defer func() {
			s.mu.Lock()
			delete(s.rooms, room.ID)
			s.mu.Unlock()
			s.recordSession(room.Snapshot())
			room.Close()
		}()
		pc.OnTrack(func(t *webrtc.TrackRemote, _ *webrtc.RTPReceiver) { room.Receive(t) })
	} else {
		s.mu.RLock()
		room = s.rooms[first.RoomID]
		s.mu.RUnlock()
		if room == nil {
			fail("This stream is offline")
			return
		}
		if s.config.AuthSecret != "" && !hmac.Equal([]byte(first.Token), []byte(s.viewerToken(first.RoomID, room.StartedAt))) {
			fail("Viewer authentication failed")
			return
		}
		deadline := time.NewTimer(8 * time.Second)
		defer deadline.Stop()
		tick := time.NewTicker(100 * time.Millisecond)
		defer tick.Stop()
		for len(room.Tracks()) < room.ExpectedTracks {
			select {
			case <-ctx.Done():
				return
			case <-room.Done():
				fail("Stream ended")
				return
			case <-deadline.C:
				fail("Publisher has not sent media yet")
				return
			case <-tick.C:
			}
		}
		if !room.AddViewer() {
			fail("This stream has reached its viewer limit")
			return
		}
		defer room.RemoveViewer()
		for _, t := range room.Tracks() {
			sender, addErr := pc.AddTrack(t)
			if addErr != nil {
				fail("Cannot subscribe to track")
				return
			}
			go func(sender *webrtc.RTPSender) {
				for {
					packets, _, e := sender.ReadRTCP()
					if e != nil {
						return
					}
					for _, p := range packets {
						switch p.(type) {
						case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
							room.RequestKeyframe()
						}
					}
				}
			}(sender)
		}
	}
	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c != nil {
			candidate := c.ToJSON()
			_ = send(message{Type: "candidate", Candidate: &candidate})
		}
	})
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		_ = send(map[string]any{"type": "connection", "state": state.String()})
		if state == webrtc.PeerConnectionStateFailed {
			cancel()
		}
	})
	idBytes := make([]byte, 8)
	_, _ = rand.Read(idBytes)
	participantID := hex.EncodeToString(idBytes)
	role, name := "viewer", sfu.CleanName(first.Name)
	if publisher {
		role = "publisher"
	}
	if name == "" {
		name = "Viewer " + participantID[:4]
		if publisher {
			name = "Host"
		}
	}
	leaveRoom, err := room.Collab.Join(sfu.Participant{ID: participantID, Name: name, Role: role})
	if err != nil {
		fail(err.Error())
		return
	}
	defer leaveRoom()
	ready := map[string]any{"type": "ready", "roomId": room.ID, "role": first.Type, "participantId": participantID}
	if publisher && s.config.AuthSecret != "" {
		ready["viewerToken"] = s.viewerToken(room.ID, room.StartedAt)
	}
	if err = send(ready); err != nil {
		return
	}
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-room.Done():
				_ = send(map[string]any{"type": "ended"})
				cancel()
				return
			case <-ticker.C:
				if send(map[string]any{"type": "room", "room": room.Snapshot()}) != nil {
					cancel()
					return
				}
			}
		}
	}()
	go func() {
		changed, unsubscribe := room.Collab.Subscribe()
		defer unsubscribe()
		var sentPresence, sentNote uint64
		noteSent := false // forces the initial note, even while it is still empty
		for {
			presence := room.Collab.Presence()
			note := room.Collab.Note()
			if presence.Version != sentPresence {
				sentPresence = presence.Version
				if send(map[string]any{"type": "presence", "version": presence.Version, "participants": presence.Participants}) != nil {
					cancel()
					return
				}
			}
			if !noteSent || sentNote != note.Version {
				sentNote, noteSent = note.Version, true
				if send(map[string]any{"type": "note", "note": note}) != nil {
					cancel()
					return
				}
			}
			select {
			case <-ctx.Done():
				return
			case <-room.Done():
				return
			case <-changed:
			}
		}
	}()
	viewerID := ""
	if !publisher {
		b := make([]byte, 8)
		_, _ = rand.Read(b)
		viewerID = hex.EncodeToString(b)
		defer room.RemoveQoE(viewerID)
	}
	var pending []webrtc.ICECandidateInit
	offered := false
	for {
		var msg message
		if err = wsjson.Read(ctx, conn, &msg); err != nil {
			return
		}
		switch msg.Type {
		case "offer":
			if offered || msg.SDP == nil || msg.SDP.Type != webrtc.SDPTypeOffer {
				fail("Expected one valid SDP offer")
				return
			}
			offered = true
			if err = pc.SetRemoteDescription(*msg.SDP); err != nil {
				log.Printf("remote SDP: %v", err)
				fail("Incompatible session description")
				return
			}
			for _, c := range pending {
				_ = pc.AddICECandidate(c)
			}
			pending = nil
			answer, e := pc.CreateAnswer(nil)
			if e != nil {
				fail("Unable to answer")
				return
			}
			if err = pc.SetLocalDescription(answer); err != nil {
				fail("Unable to set answer")
				return
			}
			if err = send(message{Type: "answer", SDP: &answer}); err != nil {
				return
			}
			if !publisher {
				room.RequestKeyframe()
			}
		case "candidate":
			if msg.Candidate == nil {
				continue
			}
			if pc.RemoteDescription() == nil {
				if len(pending) >= 128 {
					fail("Too many ICE candidates")
					return
				}
				pending = append(pending, *msg.Candidate)
			} else if err = pc.AddICECandidate(*msg.Candidate); err != nil {
				log.Printf("ICE: %v", err)
			}
		case "network":
			if !publisher {
				fail("Only the publisher can change network conditions")
				continue
			}
			if msg.Network == nil {
				fail("Missing network conditions")
				continue
			}
			if err = room.SetNetwork(*msg.Network); err != nil {
				fail(err.Error())
				continue
			}
			_ = send(map[string]any{"type": "network", "network": msg.Network})
		case "telemetry":
			if msg.Metrics != nil {
				room.UpdateQoE(viewerID, *msg.Metrics)
			}
		case "note":
			if msg.Text == nil {
				fail("Missing note text")
				continue
			}
			note, overwrote, e := room.Collab.SetNote(participantID, *msg.Text, msg.BaseVersion)
			if e != nil {
				fail(e.Error())
				continue
			}
			_ = send(map[string]any{"type": "note_ack", "version": note.Version, "overwrote": overwrote})
		case "rename":
			if e := room.Collab.Rename(participantID, msg.Name); e != nil {
				fail(e.Error())
			}
		case "leave":
			return
		default:
			fail("Unknown signaling message")
		}
	}
}
func PortRange() (uint16, uint16) {
	a, _ := strconv.Atoi(os.Getenv("RTC_UDP_MIN"))
	b, _ := strconv.Atoi(os.Getenv("RTC_UDP_MAX"))
	return uint16(a), uint16(b)
}
