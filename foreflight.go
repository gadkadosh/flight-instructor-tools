package main

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"slices"
	"strings"
	"time"
)

type templateColumn struct{ name, format string }

// The column names and format rows of the EASA logbook template that ForeFlight
// on the Web offers under Logbook > Import, without its custom field examples.
// The aircraft table stays empty: ForeFlight links each flight by registration
// to the aircraft already in the logbook.
var (
	foreFlightAircraftColumns = []templateColumn{
		{"AircraftID", "Text"}, {"equipType", "Text"}, {"TypeCode", "Text"}, {"Year", "YYYY"},
		{"Make", "Text"}, {"Model", "Text"}, {"GearType", "Text"}, {"EngineType", "Text"},
		{"Category/Class", "Text"}, {"complexAircraft", "Boolean"}, {"multiPilot", "Boolean"}, {"sphp", "Boolean"},
	}
	foreFlightFlightColumns = []templateColumn{
		{"Date", "Date"}, {"AircraftID", "Text"}, {"From", "Text"}, {"To", "Text"}, {"Route", "Text"},
		{"TimeOut", "HH:MM"}, {"TimeOff", "HH:MM"}, {"TimeOn", "HH:MM"}, {"TimeIn", "HH:MM"},
		{"OnDuty", "HH:MM"}, {"OffDuty", "HH:MM"},
		{"TotalTime", "Decimal or HH:MM"}, {"PIC", "Decimal or HH:MM"}, {"SIC", "Decimal or HH:MM"},
		{"Night", "Decimal or HH:MM"}, {"Solo", "Decimal or HH:MM"}, {"CrossCountry", "Decimal or HH:MM"},
		{"PICUS", "Decimal or HH:MM"}, {"MultiPilot", "Decimal or HH:MM"}, {"IFR", "Decimal or HH:MM"},
		{"Examiner", "Decimal or HH:MM"}, {"NVG", "Decimal or HH:MM"}, {"NVGOps", "Number"},
		{"Distance", "Decimal"}, {"Takeoff Day", "Number"}, {"Takeoff Night", "Number"},
		{"Landing Day", "Number"}, {"Landing Night", "Number"},
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
		{"PilotComments", "Text"}, {"Initial Check", "Boolean"}, {"Proficiency Check", "Boolean"},
		{"IR Proficiency Check", "Boolean"}, {"Refresher Training", "Boolean"},
	}
)

// logbookFlight is a flight that goes in my logbook.
type logbookFlight struct {
	Flight
	kind    activityKind
	student string
}

// foreFlightLogbook returns the sessions' logbook flights as a ForeFlight
// logbook import file, named after the dates it covers. Times are UTC.
func foreFlightLogbook(sessions []Session) (data []byte, filename string, err error) {
	var flights []logbookFlight
	for _, session := range sessions {
		for _, activity := range session.Activities {
			if kind := activityKinds[activity.Type]; kind.pic {
				flights = append(flights, logbookFlight{*activity.Flight, kind, session.Student})
			}
		}
	}
	if len(flights) == 0 {
		return nil, "", fmt.Errorf("the selected sessions contain no flights for your logbook")
	}
	slices.SortStableFunc(flights, func(a, b logbookFlight) int { return a.BlockOff.Compare(b.BlockOff) })

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
		"Date": logbookDate(flight.BlockOff),
		// ForeFlight writes registrations as in ICAO flight plans, without the dash.
		"AircraftID": strings.ReplaceAll(flight.Registration, "-", ""),
		"From":       flight.Departure,
		"To":         flight.Arrival,
		"TimeOut":    logbookTime(flight.BlockOff),
		"TimeOff":    logbookTime(flight.FirstTakeoff),
		"TimeOn":     logbookTime(flight.LastLanding),
		"TimeIn":     logbookTime(flight.BlockOn),
		"TotalTime":  block,
		"PIC":        block,
		// Every landing follows a takeoff. Sessions don't record night, so all count as day.
		"Takeoff Day": fmt.Sprint(flight.Landings),
		"Landing Day": fmt.Sprint(flight.Landings),
	}
	if flight.kind.dualGiven {
		entry["DualGiven"] = block
		entry["Person1"] = flight.student + ";Student"
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
