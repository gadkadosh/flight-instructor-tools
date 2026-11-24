package main

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"slices"
	"strings"
	"time"
)

// Aircraft holds what ForeFlight's logbook template needs to describe an aircraft.
type Aircraft struct {
	TypeCode      string `json:"typeCode"` // ICAO type designator, such as C172
	Make          string `json:"make"`
	Model         string `json:"model"`
	GearType      string `json:"gearType"`
	EngineType    string `json:"engineType"`
	CategoryClass string `json:"categoryClass"`
}

// Allowed values from ForeFlight's logbook template formatting notes.
var (
	foreFlightGearTypes       = []string{"AM", "FC", "FT", "RC", "RT", "Floats", "Skids"}
	foreFlightEngineTypes     = []string{"Diesel", "Electric", "Non-Powered", "Piston", "Radial", "Turbofan", "Turbojet", "Turboprop", "Turboshaft"}
	foreFlightCategoryClasses = []string{"ASEL", "AMEL", "ASES", "AMES", "RH", "RG", "Glider", "LA", "LB", "Powered Lift", "PL", "PS", "WL", "WS"}
)

func (aircraft Aircraft) validate() error {
	for _, field := range []struct{ name, value string }{
		{"typeCode", aircraft.TypeCode}, {"make", aircraft.Make}, {"model", aircraft.Model},
	} {
		if strings.TrimSpace(field.value) == "" {
			return fmt.Errorf("%s: must not be empty", field.name)
		}
	}
	for _, field := range []struct {
		name, value string
		allowed     []string
	}{
		{"gearType", aircraft.GearType, foreFlightGearTypes},
		{"engineType", aircraft.EngineType, foreFlightEngineTypes},
		{"categoryClass", aircraft.CategoryClass, foreFlightCategoryClasses},
	} {
		if !slices.Contains(field.allowed, field.value) {
			return fmt.Errorf("%s: got %q, want one of %s", field.name, field.value, strings.Join(field.allowed, ", "))
		}
	}
	return nil
}

type templateColumn struct{ name, format string }

// The sections, column names and format rows of ForeFlight's sample logbook
// (support.foreflight.com article 215998368), without its custom field examples.
var (
	foreFlightAircraftColumns = []templateColumn{
		{"AircraftID", "Text"}, {"EquipmentType", "Text"}, {"TypeCode", "Text"}, {"Year", "YYYY"},
		{"Make", "Text"}, {"Model", "Text"}, {"GearType", "Text"}, {"EngineType", "Text"},
		{"Category/Class", "Text"}, {"Complex", "Boolean"}, {"High Performance", "Boolean"},
		{"Pressurized", "Boolean"}, {"TAA", "Boolean"},
	}
	foreFlightFlightColumns = []templateColumn{
		{"Date", "Date"}, {"AircraftID", "Text"}, {"From", "Text"}, {"To", "Text"}, {"Route", "Text"},
		{"TimeOut", "HH:MM"}, {"TimeOff", "HH:MM"}, {"TimeOn", "HH:MM"}, {"TimeIn", "HH:MM"},
		{"OnDuty", "HH:MM"}, {"OffDuty", "HH:MM"},
		{"TotalTime", "Decimal or HH:MM"}, {"PIC", "Decimal or HH:MM"}, {"SIC", "Decimal or HH:MM"},
		{"Night", "Decimal or HH:MM"}, {"Solo", "Decimal or HH:MM"}, {"CrossCountry", "Decimal or HH:MM"},
		{"PICUS", "Decimal or HH:MM"}, {"MultiPilot", "Decimal or HH:MM"}, {"IFR", "Decimal or HH:MM"},
		{"Examiner", "Decimal or HH:MM"}, {"NVG", "Decimal or HH:MM"}, {"NVGOps", "Number"},
		{"Distance", "Decimal"}, {"DayTakeoffs", "Number"}, {"DayLandingsFullStop", "Number"},
		{"NightTakeoffs", "Number"}, {"NightLandingsFullStop", "Number"}, {"AllLandings", "Number"},
		{"ActualInstrument", "Decimal or HH:MM"}, {"SimulatedInstrument", "Decimal or HH:MM"},
		{"GroundTraining", "Decimal or HH:MM"}, {"GroundTrainingGiven", "Decimal or HH:MM"},
		{"HobbsStart", "Decimal"}, {"HobbsEnd", "Decimal"}, {"TachStart", "Decimal"}, {"TachEnd", "Decimal"},
		{"Holds", "Number"},
		{"Approach1", "Packed Detail"}, {"Approach2", "Packed Detail"}, {"Approach3", "Packed Detail"},
		{"Approach4", "Packed Detail"}, {"Approach5", "Packed Detail"}, {"Approach6", "Packed Detail"},
		{"DualGiven", "Decimal or HH:MM"}, {"DualReceived", "Decimal or HH:MM"},
		{"SimulatedFlight", "Decimal or HH:MM"}, {"InstructorName", "Text"}, {"InstructorComments", "Text"},
		{"Person1", "Packed Detail"}, {"Person2", "Packed Detail"}, {"Person3", "Packed Detail"},
		{"Person4", "Packed Detail"}, {"Person5", "Packed Detail"}, {"Person6", "Packed Detail"},
		{"PilotComments", "Text"}, {"Flight Review", "Boolean"}, {"IPC", "Boolean"},
		{"Checkride", "Boolean"}, {"FAA 61.58", "Boolean"}, {"NVG Proficiency", "Boolean"},
	}
)

// logbookFlight is a flight that goes in my logbook.
type logbookFlight struct {
	Flight
	kind activityKind
}

// foreFlightLogbook returns the sessions' logbook flights as a ForeFlight
// logbook import file, named after the dates it covers. Times are UTC.
func foreFlightLogbook(sessions []Session, aircraft map[string]Aircraft) (data []byte, filename string, err error) {
	var flights []logbookFlight
	for _, session := range sessions {
		for _, activity := range session.Activities {
			if kind := activityKinds[activity.Type]; kind.pic {
				flights = append(flights, logbookFlight{*activity.Flight, kind})
			}
		}
	}
	if len(flights) == 0 {
		return nil, "", fmt.Errorf("the selected sessions contain no flights for your logbook")
	}
	slices.SortStableFunc(flights, func(a, b logbookFlight) int { return a.BlockOff.Compare(b.BlockOff) })

	var registrations []string
	for _, flight := range flights {
		if _, known := aircraft[flight.Registration]; !known {
			return nil, "", fmt.Errorf("aircraft %s is not in the config; add it to \"aircraft\" with its typeCode, make, model, gearType, engineType and categoryClass", flight.Registration)
		}
		if !slices.Contains(registrations, flight.Registration) {
			registrations = append(registrations, flight.Registration)
		}
	}
	slices.Sort(registrations)

	var buffer bytes.Buffer
	writer := csv.NewWriter(&buffer)
	writer.UseCRLF = true
	width := len(foreFlightFlightColumns)
	write := func(values ...string) {
		writer.Write(append(values, make([]string, width-len(values))...))
	}
	write("ForeFlight Logbook Import", "This row is required for importing into ForeFlight. Do not delete or modify.")
	write()
	writeTable(write, "Aircraft Table", foreFlightAircraftColumns)
	for _, registration := range registrations {
		details := aircraft[registration]
		write(templateRow(foreFlightAircraftColumns, map[string]string{
			"AircraftID":     registration,
			"EquipmentType":  "aircraft",
			"TypeCode":       details.TypeCode,
			"Make":           details.Make,
			"Model":          details.Model,
			"GearType":       details.GearType,
			"EngineType":     details.EngineType,
			"Category/Class": details.CategoryClass,
		})...)
	}
	write()
	writeTable(write, "Flights Table", foreFlightFlightColumns)
	for _, flight := range flights {
		write(templateRow(foreFlightFlightColumns, foreFlightEntry(flight))...)
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, "", err
	}

	first, last := logbookDate(flights[0].BlockOff), logbookDate(flights[len(flights)-1].BlockOff)
	filename = "ForeFlight-" + first + ".csv"
	if first != last {
		filename = "ForeFlight-" + first + "-to-" + last + ".csv"
	}
	return buffer.Bytes(), filename, nil
}

func foreFlightEntry(flight logbookFlight) map[string]string {
	block := hoursMinutes(flight.blockMinutes())
	entry := map[string]string{
		"Date":        logbookDate(flight.BlockOff),
		"AircraftID":  flight.Registration,
		"From":        flight.Departure,
		"To":          flight.Arrival,
		"TimeOut":     logbookTime(flight.BlockOff),
		"TimeOff":     logbookTime(flight.FirstTakeoff),
		"TimeOn":      logbookTime(flight.LastLanding),
		"TimeIn":      logbookTime(flight.BlockOn),
		"TotalTime":   block,
		"PIC":         block,
		"AllLandings": fmt.Sprint(flight.Landings),
	}
	if flight.kind.dualGiven {
		entry["DualGiven"] = block
	}
	return entry
}

func writeTable(write func(...string), title string, columns []templateColumn) {
	names, formats := make([]string, len(columns)), make([]string, len(columns))
	for i, column := range columns {
		names[i], formats[i] = column.name, column.format
	}
	write(title)
	write(formats...)
	write(names...)
}

func templateRow(columns []templateColumn, values map[string]string) []string {
	row := make([]string, len(columns))
	for i, column := range columns {
		row[i] = values[column.name]
	}
	return row
}

func logbookDate(t time.Time) string { return t.UTC().Format("2006-01-02") }

func logbookTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format("15:04")
}

func hoursMinutes(minutes int) string {
	return fmt.Sprintf("%02d:%02d", minutes/60, minutes%60)
}
