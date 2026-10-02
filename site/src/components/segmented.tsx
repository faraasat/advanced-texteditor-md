/** A group of mutually exclusive options drawn as a segmented control. Native radio inputs, so keyboard and screen readers just work. */
export function Segmented<T extends string>({ legend, name, value, options, onChange }: { legend: string; name: string; value: T; options: readonly { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <fieldset className="pg__group">
      <legend>{legend}</legend>
      <div className="seg">
        {options.map((o) => (
          <label key={o.id}>
            <input type="radio" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
