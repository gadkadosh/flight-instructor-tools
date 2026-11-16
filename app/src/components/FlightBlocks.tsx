import { duration, elapsed, emptyFlight } from "../../lib/record.ts";
import type { Block, Flight } from "../../lib/record.ts";
import Field, { numberOrNull } from "./Field";

export default function FlightBlocks({
  blocks,
  onChange,
}: {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
}) {
  function updateBlock(index: number, update: Partial<Block>) {
    onChange(blocks.map((b, i) => (i === index ? { ...b, ...update } : b)));
  }
  function updateFlight(bi: number, fi: number, update: Partial<Flight>) {
    updateBlock(bi, {
      flights: blocks[bi].flights.map((f, i) =>
        i === fi ? { ...f, ...update } : f,
      ),
    });
  }
  return (
    <section className="form-section">
      <div className="step-title">
        <span>02</span>
        <h3>Block periods & flights</h3>
      </div>
      <p className="hint">
        One block can contain several takeoffs and landings. Enter HH:MM in UTC;
        append +1 for the next day. Group circuits at one airfield as one
        flight; keep their individual intervals so ground gaps are not counted
        as flight time.
      </p>
      {blocks.map((b, bi) => (
        <div className="block-card" key={bi}>
          <div className="block-heading">
            <strong>Block {bi + 1}</strong>
            <span>{duration(elapsed(b.off, b.on))} block</span>
            <button
              className="text-button danger"
              onClick={() => onChange(blocks.filter((_, i) => i !== bi))}
            >
              Remove block
            </button>
          </div>
          <div className="fields">
            <Field
              label="Off-block (UTC)"
              value={b.off}
              placeholder="HH:MM"
              onChange={(off) => updateBlock(bi, { off })}
            />
            <Field
              label="On-block (UTC)"
              value={b.on}
              placeholder="HH:MM"
              onChange={(on) => updateBlock(bi, { on })}
            />
          </div>
          {b.flights.map((f, fi) => (
            <div className="flight-card" key={fi}>
              <div className="flight-heading">
                <strong>Flight {fi + 1}</strong>
                <span>{f.landings ?? "?"} landings</span>
                <button
                  className="text-button danger"
                  onClick={() =>
                    updateBlock(bi, {
                      flights: b.flights.filter((_, i) => i !== fi),
                    })
                  }
                >
                  Remove flight
                </button>
              </div>
              <div className="fields">
                <Field
                  label="Departure airfield"
                  value={f.departure}
                  onChange={(departure) => updateFlight(bi, fi, { departure })}
                />
                <Field
                  label="Arrival airfield"
                  value={f.arrival}
                  onChange={(arrival) => updateFlight(bi, fi, { arrival })}
                />
                <Field
                  label="Number of landings"
                  type="number"
                  value={f.landings}
                  onChange={(v) =>
                    updateFlight(bi, fi, { landings: numberOrNull(v) })
                  }
                />
                <label>
                  <span>Activity / SOLO scope</span>
                  <select
                    value={f.activity}
                    onChange={(e) =>
                      updateFlight(bi, fi, {
                        activity: e.target.value as Flight["activity"],
                      })
                    }
                  >
                    <option value="unknown">Unresolved</option>
                    <option value="dual">Dual instruction</option>
                    <option value="soloSupervision">Supervised solo</option>
                  </select>
                </label>
              </div>
              {f.movements.map((m, mi) => (
                <div className="movement" key={mi}>
                  <div className="flight-heading">
                    <span>
                      Interval {mi + 1} ·{" "}
                      {duration(elapsed(m.takeoff, m.landing))} airborne
                    </span>
                    <button
                      className="text-button danger"
                      onClick={() =>
                        updateFlight(bi, fi, {
                          movements: f.movements.filter((_, i) => i !== mi),
                        })
                      }
                    >
                      Remove interval
                    </button>
                  </div>
                  <div className="fields">
                    <Field
                      label="Takeoff (UTC)"
                      value={m.takeoff}
                      placeholder="HH:MM"
                      onChange={(takeoff) =>
                        updateFlight(bi, fi, {
                          movements: f.movements.map((v, i) =>
                            i === mi ? { ...v, takeoff } : v,
                          ),
                        })
                      }
                    />
                    <Field
                      label="Landing (UTC)"
                      value={m.landing}
                      placeholder="HH:MM"
                      onChange={(landing) =>
                        updateFlight(bi, fi, {
                          movements: f.movements.map((v, i) =>
                            i === mi ? { ...v, landing } : v,
                          ),
                        })
                      }
                    />
                  </div>
                </div>
              ))}
              <button
                className="text-button"
                onClick={() =>
                  updateFlight(bi, fi, {
                    movements: [...f.movements, { takeoff: "", landing: "" }],
                  })
                }
              >
                + Add circuit / timing interval
              </button>
            </div>
          ))}
          <button
            className="text-button"
            onClick={() =>
              updateBlock(bi, {
                flights: [...b.flights, emptyFlight()],
              })
            }
          >
            + Add flight in this block
          </button>
        </div>
      ))}
      <button
        className="secondary"
        onClick={() =>
          onChange([...blocks, { off: "", on: "", flights: [emptyFlight()] }])
        }
      >
        + Add block period
      </button>
    </section>
  );
}
