package sfu

import (
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"math"
	"testing"
	"time"
)

func TestNetworkBounds(t *testing.T) {
	for _, n := range []Network{{BandwidthMbps: 0}, {BandwidthMbps: 101}, {BandwidthMbps: 5, LossPercent: 31}, {BandwidthMbps: 5, JitterMs: -1}, {BandwidthMbps: 5, LatencyMs: math.NaN()}} {
		if n.Validate() == nil {
			t.Fatalf("accepted invalid profile %+v", n)
		}
	}
	if HealthyNetwork.Validate() != nil {
		t.Fatal("healthy profile rejected")
	}
}
func TestRoomMembershipLimit(t *testing.T) {
	r := NewRoom("test", "test", nil)
	defer r.Close()
	for i := 0; i < 100; i++ {
		if !r.AddViewer() {
			t.Fatal("early capacity limit")
		}
	}
	if r.AddViewer() {
		t.Fatal("exceeded capacity")
	}
	r.RemoveViewer()
	if !r.AddViewer() {
		t.Fatal("failed to reclaim capacity")
	}
	r.Close()
	r.Close()
}
func TestImpairmentForwardsAndDropsRealPackets(t *testing.T) {
	r := NewRoom("test", "test", nil)
	defer r.Close()
	track, _ := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8}, "video", "test")
	if err := r.SetNetwork(Network{BandwidthMbps: 100, LossPercent: 30}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 200; i++ {
		r.queue <- packet{&rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: uint16(i)}, Payload: []byte{1, 2, 3}}, track, time.Now()}
	}
	deadline := time.Now().Add(time.Second)
	for r.ForwardedPackets.Load()+r.DroppedPackets.Load() < 200 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	s := r.Snapshot()
	if s.DroppedPackets == 0 || s.ForwardedPackets == 0 || s.DroppedPackets+s.ForwardedPackets != 200 {
		t.Fatalf("invalid packet accounting: %+v", s)
	}
}
