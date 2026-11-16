package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"time"
)

//go:embed web/dist
var webAssets embed.FS

func runServe(ctx context.Context, arguments []string, stdout io.Writer) error {
	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	flags.SetOutput(stdout)
	flags.Usage = func() {
		fmt.Fprintln(stdout, "Usage: fitools serve [flags]")
		flags.PrintDefaults()
	}
	port := flags.Int("port", 0, "localhost port (0 chooses an available port)")
	noOpen := flags.Bool("no-open", false, "do not open the browser")
	if err := flags.Parse(arguments); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("parse serve arguments: %w", err)
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments: %v", flags.Args())
	}
	assets, err := fs.Sub(webAssets, "web/dist")
	if err != nil {
		return fmt.Errorf("load embedded UI: %w", err)
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		return fmt.Errorf("listen for web UI: %w", err)
	}
	server := &http.Server{
		Handler:           http.FileServerFS(assets),
		ReadHeaderTimeout: 5 * time.Second,
	}
	serveError := make(chan error, 1)
	go func() { serveError <- server.Serve(listener) }()
	url := "http://" + listener.Addr().String()
	fmt.Fprintf(stdout, "Flight Instructor Tools: %s\n", url)
	if !*noOpen {
		if err := openBrowser(ctx, url); err != nil {
			fmt.Fprintf(stdout, "Could not open browser: %v. Open %s manually.\n", err, url)
		}
	}
	fmt.Fprintln(stdout, "Press Ctrl+C to stop.")
	select {
	case err := <-serveError:
		return fmt.Errorf("serve web UI: %w", err)
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			server.Close()
			return fmt.Errorf("stop web UI: %w", err)
		}
		return nil
	}
}

func openBrowser(ctx context.Context, url string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.CommandContext(ctx, "open", url)
	case "windows":
		command = exec.CommandContext(ctx, "rundll32", "url.dll,FileProtocolHandler", url)
	default:
		command = exec.CommandContext(ctx, "xdg-open", url)
	}
	return command.Run()
}
