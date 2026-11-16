package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
)

func runValidate(arguments []string, stdout io.Writer) error {
	flags := flag.NewFlagSet("validate", flag.ContinueOnError)
	flags.SetOutput(stdout)
	flags.Usage = func() {
		fmt.Fprintln(stdout, "Usage: fitools validate FILE")
	}
	if err := flags.Parse(arguments); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("parse validate arguments: %w", err)
	}
	if flags.NArg() != 1 {
		return fmt.Errorf("expected exactly one sessions file; usage: fitools validate FILE")
	}

	path := flags.Arg(0)
	if _, err := readSessionFile(path); err != nil {
		return err
	}

	fmt.Fprintf(stdout, "Valid sessions file: %s\n", path)
	return nil
}
