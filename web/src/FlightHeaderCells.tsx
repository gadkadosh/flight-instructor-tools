type FlightColumn = { label: string; className: string; utc?: boolean };

const flightColumns: FlightColumn[] = [
  { label: 'Type', className: 'type' },
  { label: 'Aircraft', className: 'registration' },
  { label: 'From', className: 'airfield' },
  { label: 'To', className: 'airfield' },
  { label: 'Block off', className: 'numeric clock', utc: true },
  { label: 'Takeoff', className: 'numeric clock', utc: true },
  { label: 'Landing', className: 'numeric clock', utc: true },
  { label: 'Block on', className: 'numeric clock', utc: true },
  { label: 'Landings', className: 'numeric count' },
  { label: 'Block', className: 'numeric duration' },
];

// Shared by the flight entry and flight details tables so their columns line up.
export default function FlightHeaderCells() {
  return flightColumns.map((column) => (
    <th key={column.label} scope="col" className={column.className}>
      {column.label}
      {column.utc && <span className="time-zone"> UTC</span>}
    </th>
  ));
}
