package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

const supportedSessionSchemaVersion = 3

type SessionFile struct {
	SchemaVersion int       `json:"schemaVersion"`
	Sessions      []Session `json:"sessions"`
}

type Session struct {
	ID         string     `json:"id"`
	DutyStart  time.Time  `json:"dutyStart"`
	DutyEnd    time.Time  `json:"dutyEnd"`
	Student    string     `json:"student,omitempty"`
	Activities []Activity `json:"activities"`
}

type ActivityType string

const (
	ActivityPreparation     ActivityType = "preparation"
	ActivityDual            ActivityType = "dual"
	ActivitySoloSupervision ActivityType = "soloSupervision"
	ActivityRundflug        ActivityType = "rundflug"
	ActivitySchnupperflug   ActivityType = "schnupperflug"
)

type activityKind struct {
	invoiceLabel    string
	ownBlock        bool
	studentRequired bool
}

var activityKinds = map[ActivityType]activityKind{
	ActivityPreparation:     {invoiceLabel: "Flugvorbereitung"},
	ActivityDual:            {invoiceLabel: "Blockzeit", ownBlock: true, studentRequired: true},
	ActivitySoloSupervision: {invoiceLabel: "Blockzeit", studentRequired: true},
	ActivityRundflug:        {invoiceLabel: "Rundflug", ownBlock: true},
	ActivitySchnupperflug:   {invoiceLabel: "Schnupperflug", ownBlock: true},
}

type Activity struct {
	ID      string       `json:"id"`
	Type    ActivityType `json:"type"`
	Minutes int          `json:"minutes"`
}

func (activity Activity) validate() error {
	if strings.TrimSpace(activity.ID) == "" {
		return fmt.Errorf("id: must not be empty")
	}
	if _, supported := activityKinds[activity.Type]; !supported {
		return fmt.Errorf("type: got %q, want preparation, dual, soloSupervision, rundflug, or schnupperflug", activity.Type)
	}
	if activity.Minutes <= 0 {
		return fmt.Errorf("minutes: must be positive")
	}
	return nil
}

type Config struct {
	Currency               string      `json:"currency"`
	Issuer                 Party       `json:"issuer"`
	Customer               Party       `json:"customer"`
	TaxNumber              string      `json:"taxNumber"`
	BankDetails            BankDetails `json:"bankDetails"`
	VATRatePercent         int         `json:"vatRatePercent"`
	VATStatement           string      `json:"vatStatement"`
	PaymentText            string      `json:"paymentText"`
	ClosingText            string      `json:"closingText"`
	SignatureFile          string      `json:"signatureFile,omitempty"`
	DutyReportTemplateFile string      `json:"dutyReportTemplateFile,omitempty"`
	TimeZone               string      `json:"timeZone,omitempty"`
	Rates                  []Rate      `json:"rates"`
}

type Rate struct {
	EffectiveFrom           string `json:"effectiveFrom"`
	PreparationCentsPerHour int    `json:"preparationCentsPerHour"`
	BlockCentsPerHour       int    `json:"blockCentsPerHour"`
}

func (config Config) location() (*time.Location, error) {
	timeZone := config.TimeZone
	if timeZone == "" {
		timeZone = "UTC"
	}
	if timeZone == "Local" {
		return nil, fmt.Errorf("timeZone: use an explicit IANA timezone such as Europe/Berlin; Local is not supported")
	}
	location, err := time.LoadLocation(timeZone)
	if err != nil {
		return nil, fmt.Errorf("timeZone %q: %w", timeZone, err)
	}
	return location, nil
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
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open %q: %w", path, err)
	}
	defer f.Close()
	decoder := json.NewDecoder(f)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(destination); err != nil {
		return fmt.Errorf("decode %q: %w", path, err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return fmt.Errorf("decode %q: unexpected second value found", path)
		}
		return fmt.Errorf("decode %q: trailing content: %w", path, err)
	}

	return nil
}

func validateSessionFile(input SessionFile) error {
	if err := validateSessionRecords(input); err != nil {
		return err
	}
	if len(input.Sessions) == 0 {
		return fmt.Errorf("sessions: must contain at least one session")
	}
	return nil
}

// Validate the schema and records without requiring a nonempty selection.
func validateSessionRecords(input SessionFile) error {
	if input.SchemaVersion != supportedSessionSchemaVersion {
		return fmt.Errorf("schemaVersion: got %d, want %d", input.SchemaVersion, supportedSessionSchemaVersion)
	}
	sessionIDs := make(map[string]int, len(input.Sessions))
	for sessionIndex, session := range input.Sessions {
		path := fmt.Sprintf("sessions[%d]", sessionIndex)
		if strings.TrimSpace(session.ID) == "" {
			return fmt.Errorf("%s.id: must not be empty", path)
		}
		// Browsers resolve these as path segments, so the UI could not address the session.
		if session.ID == "." || session.ID == ".." {
			return fmt.Errorf("%s.id: must not be %q", path, session.ID)
		}
		if firstIndex, exists := sessionIDs[session.ID]; exists {
			return fmt.Errorf("%s.id: duplicate %q (first used at sessions[%d].id)", path, session.ID, firstIndex)
		}
		sessionIDs[session.ID] = sessionIndex

		if session.DutyStart.IsZero() {
			return fmt.Errorf("%s.dutyStart: missing or zero", path)
		}
		if session.DutyEnd.IsZero() {
			return fmt.Errorf("%s.dutyEnd: missing or zero", path)
		}
		if !session.DutyEnd.After(session.DutyStart) {
			return fmt.Errorf("%s.dutyEnd: must be after dutyStart", path)
		}

		if len(session.Activities) == 0 {
			return fmt.Errorf("%s.activities: must contain at least one activity", path)
		}
		hasFlight, studentRequired := false, false
		for activityIndex, activity := range session.Activities {
			if err := activity.validate(); err != nil {
				return fmt.Errorf("%s.activities[%d].%w", path, activityIndex, err)
			}
			hasFlight = hasFlight || activity.Type != ActivityPreparation
			studentRequired = studentRequired || activityKinds[activity.Type].studentRequired
		}
		if strings.TrimSpace(session.Student) == "" && (studentRequired || !hasFlight) {
			return fmt.Errorf("%s.student: required for training and preparation-only sessions", path)
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
