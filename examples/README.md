# Realistic anonymized example

These files model a small but realistic flight-instruction billing period without containing private data:

- `realistic-sessions.json` contains sessions around May 2026.
- `realistic-config.json` contains fictional issuer, customer, bank, and tax data.

The data deliberately exercises:

- sessions immediately outside the selected month;
- multiple sessions for one student on one day;
- multiple flights in one session;
- a preparation-only session;
- a block-only session;
- a free-form sightseeing description;
- German characters;
- an effective rate change on 2026-06-01; and
- a June duration whose block amount requires cent rounding.

## Expected May 2026 invoice

At preparation and block rates of EUR 25.00 and EUR 30.00 per hour, respectively, May should produce these grouped lines:

| Date | Description | Duration | Amount |
| --- | --- | ---: | ---: |
| 03.05.26 | Alex Beispiel - Flugvorbereitung | 0:30 | 12.50 EUR |
| 03.05.26 | Alex Beispiel - Blockzeit | 2:15 | 67.50 EUR |
| 03.05.26 | Robin Muster - Flugvorbereitung | 1:00 | 25.00 EUR |
| 03.05.26 | Robin Muster - Blockzeit | 1:20 | 40.00 EUR |
| 10.05.26 | Taylor Test - Flugvorbereitung | 0:30 | 12.50 EUR |
| 10.05.26 | Taylor Test - Blockzeit | 0:30 | 15.00 EUR |
| 10.05.26 | Chris Beispiel - Flugvorbereitung | 0:30 | 12.50 EUR |
| 10.05.26 | Chris Beispiel - Blockzeit | 2:02 | 61.00 EUR |
| 10.05.26 | Robin Muster - Flugvorbereitung | 0:30 | 12.50 EUR |
| 10.05.26 | Robin Muster - Blockzeit | 1:28 | 44.00 EUR |
| 24.05.26 | Rundflug 45° | 0:45 | 22.50 EUR |
| 24.05.26 | Sam Muster - Flugvorbereitung | 1:00 | 25.00 EUR |
| 24.05.26 | Sam Muster - Blockzeit | 1:46 | 53.00 EUR |
| 24.05.26 | Dana Beispiel - Flugvorbereitung | 0:30 | 12.50 EUR |
| 24.05.26 | Dana Beispiel - Blockzeit | 2:19 | 69.50 EUR |

The expected net and gross total is **EUR 485.00**, with EUR 0.00 VAT.

## Running it

The example can be generated with:

```sh
go run . generate \
  --input examples/realistic-sessions.json \
  --config examples/realistic-config.json \
  --month 2026-05 \
  --number 2026-05 \
  --issue-date 2026-06-09
```

Multiple sessions and multiple flights per session are supported. Grouping across session boundaries is not implemented yet, so the current output contains separate lines for otherwise matching activities from different sessions.

Keep real invoice data outside the repository, for example under `local/`, which is ignored by Git.
