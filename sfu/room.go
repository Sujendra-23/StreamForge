// Package sfu forwards encoded RTP without decoding or transcoding media.
package sfu

import (
	"errors"
	"math"
	"math/rand/v2"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

type Network struct {
	BandwidthMbps float64 `json:"bandwidthMbps"`
	LatencyMs     float64 `json:"latencyMs"`
	JitterMs      float64 `json:"jitterMs"`
	LossPercent   float64 `json:"lossPercent"`
}

func (n Network) Validate() error {
	for _, v := range []float64{n.BandwidthMbps, n.LatencyMs, n.JitterMs, n.LossPercent} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return errors.New("network values must be finite")
		}
	}
	if n.BandwidthMbps < .1 || n.BandwidthMbps > 100 || n.LatencyMs < 0 || n.LatencyMs > 1000 || n.JitterMs < 0 || n.JitterMs > 200 || n.LossPercent < 0 || n.LossPercent > 30 {
		return errors.New("network values outside allowed range")
	}
	return nil
}

var HealthyNetwork = Network{BandwidthMbps: 100}

type QoE struct {
	Bitrate  float64 `json:"bitrate"`
	FPS      float64 `json:"fps"`
	RTT      float64 `json:"rtt"`
	Jitter   float64 `json:"jitter"`
	Loss     float64 `json:"loss"`
	EncodeMs float64 `json:"encodeMs"`
	DecodeMs float64 `json:"decodeMs"`
}

func (q QoE) Valid() bool {
	for _, v := range []float64{q.Bitrate, q.FPS, q.RTT, q.Jitter, q.Loss, q.EncodeMs, q.DecodeMs} {
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > 1e6 {
			return false
		}
	}
	return q.Loss <= 100
}

type Snapshot struct {
	PublisherQoE     QoE       `json:"publisherQoE"`
	ViewerQoE        QoE       `json:"viewerQoE"`
	ID               string    `json:"id"`
	Title            string    `json:"title"`
	StartedAt        time.Time `json:"startedAt"`
	Viewers          int       `json:"viewers"`
	Tracks           int       `json:"tracks"`
	Codec            string    `json:"codec"`
	Network          Network   `json:"network"`
	ReceivedBytes    uint64    `json:"receivedBytes"`
	ForwardedPackets uint64    `json:"forwardedPackets"`
	DroppedPackets   uint64    `json:"droppedPackets"`
}
type packet struct {
	data  *rtp.Packet
	track *webrtc.TrackLocalStaticRTP
	at    time.Time
}
type Room struct {
	ExpectedTracks   int
	publisherQoE     QoE
	viewerQoE        map[string]QoE
	ID, Title        string
	StartedAt        time.Time
	Publisher        *webrtc.PeerConnection
	mu               sync.RWMutex
	tracks           []*webrtc.TrackLocalStaticRTP
	videoSSRC        uint32
	viewers          int
	network          Network
	codec            string
	done             chan struct{}
	queue            chan packet
	closeOnce        sync.Once
	ReceivedBytes    atomic.Uint64
	ForwardedPackets atomic.Uint64
	DroppedPackets   atomic.Uint64
}

func NewRoom(id, title string, publisher *webrtc.PeerConnection) *Room {
	r := &Room{ExpectedTracks: 1, viewerQoE: make(map[string]QoE), ID: id, Title: title, StartedAt: time.Now().UTC(), Publisher: publisher, network: HealthyNetwork, done: make(chan struct{}), queue: make(chan packet, 256)}
	go r.forward()
	return r
}
func (r *Room) Done() <-chan struct{} { return r.done }
func (r *Room) Close() {
	r.closeOnce.Do(func() {
		close(r.done)
		if r.Publisher != nil {
			_ = r.Publisher.Close()
		}
	})
}
func (r *Room) SetNetwork(n Network) error {
	if err := n.Validate(); err != nil {
		return err
	}
	r.mu.Lock()
	r.network = n
	r.mu.Unlock()
	return nil
}
func (r *Room) Snapshot() Snapshot {
	r.mu.RLock()
	defer r.mu.RUnlock()
	worst := QoE{}
	for _, q := range r.viewerQoE {
		worst.Loss = math.Max(worst.Loss, q.Loss)
		worst.RTT = math.Max(worst.RTT, q.RTT)
		worst.Jitter = math.Max(worst.Jitter, q.Jitter)
		worst.DecodeMs = math.Max(worst.DecodeMs, q.DecodeMs)
	}
	return Snapshot{r.publisherQoE, worst, r.ID, r.Title, r.StartedAt, r.viewers, len(r.tracks), r.codec, r.network, r.ReceivedBytes.Load(), r.ForwardedPackets.Load(), r.DroppedPackets.Load()}
}
func (r *Room) Tracks() []*webrtc.TrackLocalStaticRTP {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return append([]*webrtc.TrackLocalStaticRTP(nil), r.tracks...)
}
func (r *Room) AddViewer() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.viewers >= 100 {
		return false
	}
	r.viewers++
	return true
}
func (r *Room) RemoveViewer() {
	r.mu.Lock()
	if r.viewers > 0 {
		r.viewers--
	}
	r.mu.Unlock()
}
func (r *Room) RequestKeyframe() {
	r.mu.RLock()
	ssrc := r.videoSSRC
	r.mu.RUnlock()
	if ssrc != 0 && r.Publisher != nil {
		_ = r.Publisher.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: ssrc}})
	}
}

// Receive owns one remote track. Pion handles SRTP and hop-local NACK recovery.
func (r *Room) Receive(remote *webrtc.TrackRemote) {
	local, err := webrtc.NewTrackLocalStaticRTP(remote.Codec().RTPCodecCapability, remote.Kind().String(), r.ID)
	if err != nil {
		return
	}
	r.mu.Lock()
	for _, t := range r.tracks {
		if t.Kind() == remote.Kind() {
			r.mu.Unlock()
			return
		}
	}
	r.tracks = append(r.tracks, local)
	if remote.Kind() == webrtc.RTPCodecTypeVideo {
		r.videoSSRC = uint32(remote.SSRC())
		r.codec = remote.Codec().MimeType
	}
	r.mu.Unlock()
	if remote.Kind() == webrtc.RTPCodecTypeVideo {
		go func() {
			ticker := time.NewTicker(2 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-r.done:
					return
				case <-ticker.C:
					r.RequestKeyframe()
				}
			}
		}()
	}
	for {
		p, _, err := remote.ReadRTP()
		if err != nil {
			return
		}
		r.ReceivedBytes.Add(uint64(p.MarshalSize()))
		select {
		case <-r.done:
			return
		default:
		}
		select {
		case r.queue <- packet{p, local, time.Now()}:
		default:
			r.DroppedPackets.Add(1)
		}
	}
}

// A bounded queue and shared pacing clock impose a per-stream bandwidth ceiling.
// Impairments occur before fan-out, so every viewer sees the same experiment.
func (r *Room) forward() {
	var next time.Time
	for {
		select {
		case <-r.done:
			return
		case p := <-r.queue:
			r.mu.RLock()
			n := r.network
			r.mu.RUnlock()
			if rand.Float64()*100 < n.LossPercent {
				r.DroppedPackets.Add(1)
				continue
			}
			delay := math.Max(0, n.LatencyMs+(rand.Float64()*2-1)*n.JitterMs)
			due := p.at.Add(time.Duration(delay * float64(time.Millisecond)))
			if next.After(due) {
				due = next
			}
			// Drop excessive backlog without moving the pacing clock forward.
			if due.Sub(p.at) > 1500*time.Millisecond {
				r.DroppedPackets.Add(1)
				continue
			}
			next = due.Add(time.Duration(float64(p.data.MarshalSize()*8) / n.BandwidthMbps * 1000))
			if wait := time.Until(due); wait > 0 {
				timer := time.NewTimer(wait)
				select {
				case <-r.done:
					timer.Stop()
					return
				case <-timer.C:
				}
			}
			if err := p.track.WriteRTP(p.data); err == nil {
				r.ForwardedPackets.Add(1)
			}
		}
	}
}

func (r *Room) UpdateQoE(viewerID string, q QoE) {
	if !q.Valid() {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if viewerID == "" {
		r.publisherQoE = q
	} else {
		r.viewerQoE[viewerID] = q
	}
}
func (r *Room) RemoveQoE(id string) { r.mu.Lock(); delete(r.viewerQoE, id); r.mu.Unlock() }
