package main

import (
	"context"
	"github.com/pion/webrtc/v4"
	"log"
	"net/http"
	"os"
	"os/signal"
	"streamforge/signaling"
	"strings"
	"syscall"
	"time"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func main() {
	min, max := signaling.PortRange()
	var ice []webrtc.ICEServer
	if stun := os.Getenv("STUN_URL"); stun != "" {
		ice = append(ice, webrtc.ICEServer{URLs: []string{stun}})
	}
	app, err := signaling.New(signaling.Config{Origins: strings.Split(env("ALLOWED_ORIGINS", "localhost:5173,127.0.0.1:5173,localhost:8080,127.0.0.1:8080"), ","), WebDir: env("WEB_DIR", "web/dist"), ICE: ice, UDPMin: min, UDPMax: max, PublicIP: os.Getenv("RTC_PUBLIC_IP")})
	if err != nil {
		log.Fatal(err)
	}
	defer app.Close()
	server := &http.Server{Addr: env("ADDR", "127.0.0.1:8080"), Handler: app.Handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		app.Close()
		_ = server.Shutdown(shutdown)
	}()
	log.Printf("StreamForge signaling + SFU listening on http://%s", server.Addr)
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
