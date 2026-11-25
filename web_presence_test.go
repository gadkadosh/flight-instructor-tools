package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// openTab holds a presence stream like a browser tab and returns a function that closes it.
func openTab(t *testing.T, url string) func() {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url+"/api/presence", nil)
	if err != nil {
		t.Fatal(err)
	}
	// A client of its own, so no spare connection from a shared pool delays shutdown.
	response, err := (&http.Client{Transport: &http.Transport{}}).Do(request)
	if err != nil || response.StatusCode != http.StatusOK {
		t.Fatalf("open presence stream: %v", err)
	}
	closeTab := func() {
		cancel()
		response.Body.Close()
	}
	// A failing test may leave a tab open; close it before the server, which waits for it.
	t.Cleanup(closeTab)
	return closeTab
}

func TestServerStopsAfterItsLastTabCloses(t *testing.T) {
	grace := tabCloseGrace
	tabCloseGrace = 200 * time.Millisecond
	t.Cleanup(func() { tabCloseGrace = grace })
	stopped := make(chan struct{})
	server := httptest.NewServer(webHandler(nil, sessionSource{}, &openTabs{stop: func() { close(stopped) }}))
	t.Cleanup(server.Close)
	stopsWithin := func(wait time.Duration) bool {
		select {
		case <-stopped:
			return true
		case <-time.After(wait):
			return false
		}
	}

	closeFirst, closeSecond := openTab(t, server.URL), openTab(t, server.URL)
	closeFirst()
	if stopsWithin(500 * time.Millisecond) {
		t.Fatal("server stopped while a tab was still open")
	}
	closeSecond()
	// Reopen only once the server has seen no tabs and started its grace period.
	time.Sleep(tabCloseGrace / 2)
	closeReloaded := openTab(t, server.URL)
	if stopsWithin(500 * time.Millisecond) {
		t.Fatal("server stopped although the tab reloaded")
	}
	closeReloaded()
	if !stopsWithin(5 * time.Second) {
		t.Fatal("server kept running after its last tab closed")
	}
}
