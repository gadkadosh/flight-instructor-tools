export default function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  wide = false,
}: {
  label: string;
  value: string | number | null;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "wide" : ""}>
      <span>{label}</span>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? 1 : undefined}
      />
    </label>
  );
}
export const numberOrNull = (value: string) =>
  value === "" ? null : Number(value);
