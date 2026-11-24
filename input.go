package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"time"
)

const supportedSessionSchemaVersion = 4

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
	flight          bool // Records block times and logbook details instead of minutes.
	pic             bool // I'm on board as pilot in command: my own block time and a logbook entry.
	dualGiven       bool // Logged as instruction given.
	studentRequired bool
}

var activityKinds = map[ActivityType]activityKind{
	ActivityPreparation:     {invoiceLabel: "Flugvorbereitung"},
	ActivityDual:            {invoiceLabel: "Blockzeit", flight: true, pic: true, dualGiven: true, studentRequired: true},
	ActivitySoloSupervision: {invoiceLabel: "Blockzeit", flight: true, studentRequired: true},
	ActivityRundflug:        {invoiceLabel: "Rundflug", flight: true, pic: true},
	ActivitySchnupperflug:   {invoiceLabel: "Schnupperflug", flight: true, pic: true},
}

// Activity is preparation with Minutes, or a flight with Flight.
type Activity struct {
	ID      string       `json:"id"`
	Type    ActivityType `json:"type"`
	Minutes int          `json:"minutes,omitempty"`
	*Flight
}

// Flight is one block as a pilot logbook records it.
type Flight struct {
	BlockOff time.Time `json:"blockOff"`
	BlockOn  time.Time `json:"blockOn"`
	// The block's first takeoff and final landing, recorded together or not at all.
	FirstTakeoff time.Time `json:"firstTakeoff,omitzero"`
	LastLanding  time.Time `json:"lastLanding,omitzero"`
	Departure    string    `json:"departure"`
	Arrival      string    `json:"arrival"`
	Registration string    `json:"registration"`
	Landings     int       `json:"landings"`
}

var airfieldPattern = regexp.MustCompile(`^[A-Z0-9]{4}$`)

// durationMinutes is a flight's block time or the preparation minutes.
func (activity Activity) durationMinutes() int {
	if activity.Flight != nil {
		return activity.Flight.blockMinutes()
	}
	return activity.Minutes
}

func (flight Flight) blockMinutes() int {
	return int(flight.BlockOn.Sub(flight.BlockOff) / time.Minute)
}

func (activity Activity) validate(dutyStart, dutyEnd time.Time) error {
	if strings.TrimSpace(activity.ID) == "" {
		return fmt.Errorf("id: must not be empty")
	}
	kind, supported := activityKinds[activity.Type]
	if !supported {
		return fmt.Errorf("type: got %q, want preparation, dual, soloSupervision, rundflug, or schnupperflug", activity.Type)
	}
	if !kind.flight {
		if activity.Flight != nil {
			return fmt.Errorf("type: %s records minutes, not flight details", activity.Type)
		}
		if activity.Minutes <= 0 {
			return fmt.Errorf("minutes: must be positive")
		}
		return nil
	}
	if activity.Minutes != 0 {
		return fmt.Errorf("minutes: flights record blockOff and blockOn instead")
	}
	if activity.Flight == nil {
		return fmt.Errorf("blockOff: missing or zero")
	}
	return activity.Flight.validate(dutyStart, dutyEnd)
}

func (flight Flight) validate(dutyStart, dutyEnd time.Time) error {
	switch {
	case flight.BlockOff.IsZero():
		return fmt.Errorf("blockOff: missing or zero")
	case flight.BlockOn.IsZero():
		return fmt.Errorf("blockOn: missing or zero")
	case flight.blockMinutes() <= 0:
		return fmt.Errorf("blockOn: must be at least one minute after blockOff")
	case flight.BlockOff.Before(dutyStart):
		return fmt.Errorf("blockOff: must not be before dutyStart")
	case flight.BlockOn.After(dutyEnd):
		return fmt.Errorf("blockOn: must not be after dutyEnd")
	case flight.FirstTakeoff.IsZero() != flight.LastLanding.IsZero():
		return fmt.Errorf("firstTakeoff, lastLanding: record both or neither")
	case !flight.FirstTakeoff.IsZero() && flight.FirstTakeoff.Before(flight.BlockOff):
		return fmt.Errorf("firstTakeoff: must not be before blockOff")
	case !flight.FirstTakeoff.IsZero() && !flight.LastLanding.After(flight.FirstTakeoff):
		return fmt.Errorf("lastLanding: must be after firstTakeoff")
	case flight.LastLanding.After(flight.BlockOn):
		return fmt.Errorf("lastLanding: must not be after blockOn")
	case !airfieldPattern.MatchString(flight.Departure):
		return fmt.Errorf("departure: got %q, want a four-character ICAO-style identifier such as EDFE", flight.Departure)
	case !airfieldPattern.MatchString(flight.Arrival):
		return fmt.Errorf("arrival: got %q, want a four-character ICAO-style identifier such as EDFE", flight.Arrival)
	case strings.TrimSpace(flight.Registration) == "":
		return fmt.Errorf("registration: must not be empty")
	case flight.Landings <= 0:
		return fmt.Errorf("landings: must be positive")
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
	TimeZone               string      `json:"timeZone"`
	Rates                  Rates       `json:"rates"`
	// location is TimeZone, resolved by validateConfig. Every date and month
	// the app reads or defaults is in this zone.
	location *time.Location
}

type Rates struct {
	PreparationCentsPerHour int `json:"preparationCentsPerHour"`
	BlockCentsPerHour       int `json:"blockCentsPerHour"`
}

type Party struct {
	Name         string   `json:"name"`
	AddressLines []string `json:"addressLines"`
	Email        string   `json:"email,omitempty"`
}

type BankDetails struct {
	IBAN string `json:"iban"`
	BIC  string `json:"bic"`
}

func loadTimeZone(name string) (*time.Location, error) {
	if name == "" || name == "Local" {
		return nil, fmt.Errorf("timeZone: required; use an explicit IANA timezone such as Europe/Berlin")
	}
	location, err := time.LoadLocation(name)
	if err != nil {
		return nil, fmt.Errorf("timeZone %q: %w", name, err)
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
	if err := validateConfig(&config); err != nil {
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
			if err := activity.validate(session.DutyStart, session.DutyEnd); err != nil {
				return fmt.Errorf("%s.activities[%d].%w", path, activityIndex, err)
			}
			kind := activityKinds[activity.Type]
			hasFlight = hasFlight || kind.flight
			studentRequired = studentRequired || kind.studentRequired
		}
		if strings.TrimSpace(session.Student) == "" && (studentRequired || !hasFlight) {
			return fmt.Errorf("%s.student: required for training and preparation-only sessions", path)
		}
	}

	return nil
}

func validateConfig(config *Config) error {
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
	if config.Rates.PreparationCentsPerHour <= 0 {
		return fmt.Errorf("rates.preparationCentsPerHour: must be positive")
	}
	if config.Rates.BlockCentsPerHour <= 0 {
		return fmt.Errorf("rates.blockCentsPerHour: must be positive")
	}
	location, err := loadTimeZone(config.TimeZone)
	if err != nil {
		return err
	}
	config.location = location
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

func (config Config) parseMonth(value string) (time.Time, error) {
	month, err := time.ParseInLocation("2006-01", value, config.location)
	if err != nil || month.Format("2006-01") != value {
		return time.Time{}, fmt.Errorf("month must use YYYY-MM format: %q", value)
	}
	return month, nil
}

func (config Config) parseDate(value string) (time.Time, error) {
	date, err := time.ParseInLocation("2006-01-02", value, config.location)
	if err != nil || date.Format("2006-01-02") != value {
		return time.Time{}, fmt.Errorf("must be a valid date in YYYY-MM-DD format: %q", value)
	}
	return date, nil
}

func (config Config) issueDate(value string, now func() time.Time) (time.Time, error) {
	if value == "" {
		today := now().In(config.location)
		return time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, config.location), nil
	}
	date, err := config.parseDate(value)
	if err != nil {
		return time.Time{}, fmt.Errorf("issue date: %w", err)
	}
	return date, nil
}
