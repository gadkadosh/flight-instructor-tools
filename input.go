package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
)

const supportedSessionSchemaVersion = 1

type SessionFile struct {
	SchemaVersion int       `json:"schemaVersion"`
	Sessions      []Session `json:"sessions"`
}

type Session struct {
	ID                 string    `json:"id"`
	DutyStart          time.Time `json:"dutyStart"`
	DutyEnd            time.Time `json:"dutyEnd"`
	Student            string    `json:"student,omitempty"`
	Description        string    `json:"description,omitempty"`
	PreparationMinutes *int      `json:"preparationMinutes,omitempty"`
	Flights            []Flight  `json:"flights"`
}

type Flight struct {
	ID           string `json:"id"`
	BlockMinutes *int   `json:"blockMinutes,omitempty"`
}

type Config struct {
	Currency       string      `json:"currency"`
	Issuer         Party       `json:"issuer"`
	Customer       Party       `json:"customer"`
	TaxNumber      string      `json:"taxNumber"`
	BankDetails    BankDetails `json:"bankDetails"`
	VATRatePercent int         `json:"vatRatePercent"`
	VATStatement   string      `json:"vatStatement"`
	PaymentText    string      `json:"paymentText"`
	ClosingText    string      `json:"closingText"`
	Rates          []Rate      `json:"rates"`
}

type Rate struct {
	EffectiveFrom           string `json:"effectiveFrom"`
	PreparationCentsPerHour int    `json:"preparationCentsPerHour"`
	BlockCentsPerHour       int    `json:"blockCentsPerHour"`
}

func readSessionFile(path string) (SessionFile, error) {
	var input SessionFile
	if err := readJSONFile(path, &input); err != nil {
		return SessionFile{}, fmt.Errorf("read sessions: %w", err)
	}
	if err := validateSessionFile(input); err != nil {
		return SessionFile{}, fmt.Errorf("validate sessions: %w", err)
	}
	return input, nil
}

func readConfig(path string) (Config, error) {
	var config Config
	if err := readJSONFile(path, &config); err != nil {
		return Config{}, fmt.Errorf("read config: %w", err)
	}
	if err := validateConfig(config); err != nil {
		return Config{}, fmt.Errorf("validate config: %w", err)
	}
	return config, nil
}

func readJSONFile(path string, destination any) error {
	contents, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("open %q: %w", path, err)
	}
	if err := json.Unmarshal(contents, destination); err != nil {
		return fmt.Errorf("decode %q: %w", path, err)
	}
	return nil
}

func validateSessionFile(input SessionFile) error {
	if input.SchemaVersion != supportedSessionSchemaVersion {
		return fmt.Errorf("schemaVersion: got %d, want %d", input.SchemaVersion, supportedSessionSchemaVersion)
	}
	if len(input.Sessions) == 0 {
		return fmt.Errorf("sessions: must contain at least one session")
	}

	for sessionIndex, session := range input.Sessions {
		path := fmt.Sprintf("sessions[%d]", sessionIndex)
		if strings.TrimSpace(session.ID) == "" {
			return fmt.Errorf("%s.id: must not be empty", path)
		}

		if session.DutyStart.IsZero() {
			return fmt.Errorf("%s.dutyStart: missing or zero", path)
		}
		if session.DutyEnd.IsZero() {
			return fmt.Errorf("%s.dutyEnd: missing or zero", path)
		}
		if !session.DutyEnd.After(session.DutyStart) {
			return fmt.Errorf("%s.dutyEnd: must be after dutyStart", path)
		}

		if strings.TrimSpace(session.Student) == "" && strings.TrimSpace(session.Description) == "" {
			return fmt.Errorf("%s: student or description is required", path)
		}
		if session.PreparationMinutes != nil && *session.PreparationMinutes <= 0 {
			return fmt.Errorf("%s.preparationMinutes: must be positive", path)
		}
		if session.PreparationMinutes == nil && len(session.Flights) == 0 {
			return fmt.Errorf("%s: preparationMinutes or at least one flight is required", path)
		}

		for flightIndex, flight := range session.Flights {
			flightPath := fmt.Sprintf("%s.flights[%d]", path, flightIndex)
			if strings.TrimSpace(flight.ID) == "" {
				return fmt.Errorf("%s.id: must not be empty", flightPath)
			}
			if flight.BlockMinutes == nil {
				return fmt.Errorf("%s.blockMinutes: is required", flightPath)
			}
			if *flight.BlockMinutes <= 0 {
				return fmt.Errorf("%s.blockMinutes: must be positive", flightPath)
			}
		}
	}

	return nil
}

func validateConfig(config Config) error {
	if config.Currency != "EUR" {
		return fmt.Errorf("currency: got %q, want %q", config.Currency, "EUR")
	}
	if err := validateParty("issuer", config.Issuer, true); err != nil {
		return err
	}
	if err := validateParty("customer", config.Customer, false); err != nil {
		return err
	}
	if strings.TrimSpace(config.TaxNumber) == "" {
		return fmt.Errorf("taxNumber: must not be empty")
	}
	if strings.TrimSpace(config.BankDetails.IBAN) == "" {
		return fmt.Errorf("bankDetails.iban: must not be empty")
	}
	if strings.TrimSpace(config.BankDetails.BIC) == "" {
		return fmt.Errorf("bankDetails.bic: must not be empty")
	}
	if config.VATRatePercent != 0 {
		return fmt.Errorf("vatRatePercent: got %d, only 0 is currently supported", config.VATRatePercent)
	}
	if strings.TrimSpace(config.VATStatement) == "" {
		return fmt.Errorf("vatStatement: must not be empty")
	}
	if strings.TrimSpace(config.PaymentText) == "" {
		return fmt.Errorf("paymentText: must not be empty")
	}
	if strings.TrimSpace(config.ClosingText) == "" {
		return fmt.Errorf("closingText: must not be empty")
	}
	if len(config.Rates) == 0 {
		return fmt.Errorf("rates: must contain at least one rate")
	}

	for rateIndex, rate := range config.Rates {
		path := fmt.Sprintf("rates[%d]", rateIndex)
		if err := validateDate(rate.EffectiveFrom); err != nil {
			return fmt.Errorf("%s.effectiveFrom: %w", path, err)
		}
		if rate.PreparationCentsPerHour <= 0 {
			return fmt.Errorf("%s.preparationCentsPerHour: must be positive", path)
		}
		if rate.BlockCentsPerHour <= 0 {
			return fmt.Errorf("%s.blockCentsPerHour: must be positive", path)
		}
	}

	return nil
}

func validateParty(path string, party Party, requireEmail bool) error {
	if strings.TrimSpace(party.Name) == "" {
		return fmt.Errorf("%s.name: must not be empty", path)
	}
	if len(party.AddressLines) == 0 {
		return fmt.Errorf("%s.addressLines: must contain at least one line", path)
	}
	for index, line := range party.AddressLines {
		if strings.TrimSpace(line) == "" {
			return fmt.Errorf("%s.addressLines[%d]: must not be empty", path, index)
		}
	}
	if requireEmail && strings.TrimSpace(party.Email) == "" {
		return fmt.Errorf("%s.email: must not be empty", path)
	}
	return nil
}

func validateDate(value string) error {
	_, err := parseDate(value)
	return err
}
