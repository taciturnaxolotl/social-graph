import type { Person } from "../../shared/schema";

/**
 * A face when there is no photograph.
 *
 * The tint is a hash of the id, so the same person is the same shade on every
 * card and in every list, which is a little of what a photograph was doing
 * for recognition. Nearly no chroma on purpose: eleven initials blocks in
 * eleven loud colours is a toy, and the page has exactly one saturated colour
 * already, spent on the rating ramp.
 */
export function Avatar({
  person,
  size,
}: {
  person: Pick<Person, "id" | "name" | "photo">;
  size: number;
}) {
  if (person.photo) {
    return (
      <img
        className="avatar"
        src={`/photos/${person.photo}`}
        alt={person.name}
        width={size}
        height={size}
        decoding="async"
      />
    );
  }
  const initials = person.name
    .split(/\s+/)
    .filter((w) => /^[a-z]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  let hue = 0;
  for (const ch of person.id) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return (
    <div
      className="avatar initials"
      // The name is beside it in every place this is used; two readings of
      // "EG" and "Emily Gross" is one more than anybody needs.
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: `oklch(0.955 0.009 ${hue})`,
        color: `oklch(0.5 0.032 ${hue})`,
        fontSize: Math.round(size / 2.6),
      }}
    >
      {initials || "?"}
    </div>
  );
}
