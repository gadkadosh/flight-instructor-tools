package main

import (
	"bytes"
	"encoding/csv"
	"maps"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"
)

var testAircraft = map[string]Aircraft{
	"D-EFTI": {TypeCode: "C172", Make: "Cessna", Model: "172S", GearType: "FT", EngineType: "Piston", CategoryClass: "ASEL"},
}

// foreFlightTables splits a ForeFlight logbook file into its tables, each a
// format row, a header row and entries keyed by trimmed column name.
func foreFlightTables(t *testing.T, data []byte) map[string][][]string {
	t.Helper()
	reader := csv.NewReader(bytes.NewReader(data))
	reader.FieldsPerRecord = -1
	rows, err := reader.ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(rows[0][0]) != "ForeFlight Logbook Import" {
		t.Fatalf("first row = %q, want the ForeFlight import marker", rows[0])
	}
	tables := map[string][][]string{}
	var current string
	for _, row := range rows[1:] {
		for i := range row {
			row[i] = strings.TrimSpace(row[i])
		}
		switch first := row[0]; {
		case first == "Aircraft Table" || first == "Flights Table":
			current = first
		case slices.ContainsFunc(row, func(cell string) bool { return cell != "" }):
			tables[current] = append(tables[current], row)
		}
	}
	return tables
}

func entries(table [][]string) []map[string]string {
	header := table[1]
	var result []map[string]string
	for _, row := range table[2:] {
		entry := map[string]string{}
		for i, name := range header {
			if name != "" && i < len(row) && row[i] != "" {
				entry[name] = row[i]
			}
		}
		result = append(result, entry)
	}
	return result
}

func TestForeFlightLogbookMatchesTemplateColumns(t *testing.T) {
	sample, err := os.ReadFile("testdata/foreflight-sample-logbook.csv")
	if err != nil {
		t.Fatal(err)
	}
	session := Session{ID: "s", Student: "Alex", Activities: []Activity{testFlight("f", ActivityDual, 55)}}
	data, _, err := foreFlightLogbook([]Session{session}, testAircraft)
	if err != nil {
		t.Fatal(err)
	}
	want, got := foreFlightTables(t, sample), foreFlightTables(t, data)
	for _, table := range []string{"Aircraft Table", "Flights Table"} {
		// The sample's custom field columns are placeholders, not template fields.
		wantHeader := slices.DeleteFunc(slices.Clone(want[table][1]), func(name string) bool {
			return name == "" || strings.HasPrefix(name, "[")
		})
		gotHeader := slices.DeleteFunc(slices.Clone(got[table][1]), func(name string) bool { return name == "" })
		if !slices.Equal(gotHeader, wantHeader) {
			t.Errorf("%s columns =\n%q\nwant\n%q", table, gotHeader, wantHeader)
		}
	}
}

func TestForeFlightLogbookEntries(t *testing.T) {
	dual := testFlight("dual", ActivityDual, 55)
	dual.FirstTakeoff = dual.BlockOff.Add(7 * time.Minute)
	dual.LastLanding = dual.BlockOn.Add(-4 * time.Minute)
	dual.Landings = 4
	solo := shiftSession(Session{Activities: []Activity{testFlight("solo", ActivitySoloSupervision, 40)}}, 2*time.Hour).Activities[0]
	rundflug := shiftSession(Session{Activities: []Activity{testFlight("rundflug", ActivityRundflug, 30)}}, 26*time.Hour).Activities[0]
	sessions := []Session{
		// Later session first: entries are in flight order.
		{ID: "next-day", Activities: []Activity{rundflug}},
		{ID: "training", Student: "Alex", Activities: []Activity{
			{ID: "prep", Type: ActivityPreparation, Minutes: 30}, dual, solo,
		}},
	}
	data, filename, err := foreFlightLogbook(sessions, testAircraft)
	if err != nil {
		t.Fatal(err)
	}
	if filename != "ForeFlight-2026-05-03-to-2026-05-04.csv" {
		t.Errorf("filename = %q", filename)
	}
	if !bytes.HasSuffix(data, []byte("\r\n")) || bytes.Count(data, []byte("\n")) != bytes.Count(data, []byte("\r\n")) {
		t.Error("rows must end in CRLF like ForeFlight's template")
	}
	tables := foreFlightTables(t, data)
	aircraft := entries(tables["Aircraft Table"])
	wantAircraft := []map[string]string{{
		"AircraftID": "D-EFTI", "EquipmentType": "aircraft", "TypeCode": "C172", "Make": "Cessna",
		"Model": "172S", "GearType": "FT", "EngineType": "Piston", "Category/Class": "ASEL",
	}}
	if !slices.EqualFunc(aircraft, wantAircraft, maps.Equal) {
		t.Errorf("aircraft = %v, want %v", aircraft, wantAircraft)
	}
	flights := entries(tables["Flights Table"])
	wantFlights := []map[string]string{
		{
			"Date": "2026-05-03", "AircraftID": "D-EFTI", "From": "EDFE", "To": "EDFE",
			"TimeOut": "10:00", "TimeOff": "10:07", "TimeOn": "10:51", "TimeIn": "10:55",
			"TotalTime": "00:55", "PIC": "00:55", "DualGiven": "00:55", "AllLandings": "4",
		},
		{
			"Date": "2026-05-04", "AircraftID": "D-EFTI", "From": "EDFE", "To": "EDFE",
			"TimeOut": "12:00", "TimeIn": "12:30",
			"TotalTime": "00:30", "PIC": "00:30", "AllLandings": "1",
		},
	}
	if !slices.EqualFunc(flights, wantFlights, maps.Equal) {
		t.Errorf("flights =\n%v\nwant\n%v", flights, wantFlights)
	}
	// Values follow the format row above the flight columns.
	formats := map[string]*regexp.Regexp{
		"Date":             regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`),
		"HH:MM":            regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`),
		"Decimal or HH:MM": regexp.MustCompile(`^\d+:[0-5]\d$`),
		"Number":           regexp.MustCompile(`^\d+$`),
		"Text":             regexp.MustCompile(`.`),
	}
	format, header := tables["Flights Table"][0], tables["Flights Table"][1]
	for _, flight := range flights {
		for i, name := range header {
			if value, ok := flight[name]; ok && !formats[format[i]].MatchString(value) {
				t.Errorf("%s = %q does not match format %q", name, value, format[i])
			}
		}
	}
}

func TestForeFlightLogbookErrors(t *testing.T) {
	unknown := testFlight("dual", ActivityDual, 55)
	unknown.Registration = "D-EXYZ"
	for _, test := range []struct {
		name     string
		activity Activity
		want     string
	}{
		{"only solo supervision", testFlight("solo", ActivitySoloSupervision, 40), "no flights for your logbook"},
		{"unknown registration", unknown, "aircraft D-EXYZ is not in the config"},
	} {
		t.Run(test.name, func(t *testing.T) {
			session := Session{ID: "s", Student: "Alex", Activities: []Activity{test.activity}}
			_, _, err := foreFlightLogbook([]Session{session}, testAircraft)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want containing %q", err, test.want)
			}
		})
	}
}
