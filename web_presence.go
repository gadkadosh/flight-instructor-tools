package main

import (
	"net/http"
	"sync"
	"time"
)

// tabCloseGrace lets a reloading tab reconnect before the server stops.
var tabCloseGrace = 10 * time.Second

// openTabs counts UI tabs, each holding a presence stream, and calls stop once none is left.
type openTabs struct {
	stop  func() // nil keeps the server running without tabs
	mu    sync.Mutex
	count int
	timer *time.Timer
}

func (tabs *openTabs) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.WriteHeader(http.StatusOK)
	http.NewResponseController(w).Flush()
	tabs.add(1)
	defer tabs.add(-1)
	<-r.Context().Done()
}

func (tabs *openTabs) add(delta int) {
	tabs.mu.Lock()
	defer tabs.mu.Unlock()
	tabs.count += delta
	if tabs.timer != nil {
		tabs.timer.Stop()
	}
	if tabs.count == 0 && tabs.stop != nil {
		tabs.timer = time.AfterFunc(tabCloseGrace, tabs.stop)
	}
}
