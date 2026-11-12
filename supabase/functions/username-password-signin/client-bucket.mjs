const IPV4 = /^(?:\d{1,3})(?:\.\d{1,3}){3}$/;
const GROUP = /^[0-9a-f]{1,4}$/;

function ipv4Octets(value) {
  if (!IPV4.test(value)) return null;
  const octets = value.split(".").map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

/** Expands an IPv6 literal to its 8 groups, or returns null when it is not a well-formed address. */
function ipv6Groups(address) {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const sides = halves.map((part) => (part === "" ? [] : part.split(":")));
  // An embedded IPv4 tail (::ffff:1.2.3.4, 64:ff9b::1.2.3.4) counts as two groups; it is only valid last.
  const lastSide = sides[sides.length - 1];
  const last = lastSide[lastSide.length - 1];
  if (last !== undefined && last.includes(".")) {
    const octets = ipv4Octets(last);
    if (!octets) return null;
    lastSide.splice(
      lastSide.length - 1,
      1,
      ((octets[0] << 8) | octets[1]).toString(16),
      ((octets[2] << 8) | octets[3]).toString(16),
    );
  }
  const count = sides.reduce((total, side) => total + side.length, 0);
  let groups;
  if (halves.length === 2) {
    if (count > 7) return null;
    groups = [...sides[0], ...Array(8 - count).fill("0"), ...sides[1]];
  } else {
    if (count !== 8) return null;
    [groups] = sides;
  }
  return groups.every((group) => GROUP.test(group)) ? groups.map((group) => group.padStart(4, "0")) : null;
}

/**
 * Rate-limit bucket for a client address. IPv4 addresses are used in canonical dotted form. IPv6 addresses collapse to
 * their /64 prefix, because one subscriber normally controls a whole /64 and could otherwise rotate through
 * billions of addresses to dodge the per-client and per-(username, client) limits. An IPv4-mapped IPv6
 * address uses its IPv4 form. Anything missing or unparsable shares the single "unknown" bucket.
 */
export function clientBucket(address) {
  const raw = typeof address === "string" ? address.trim().replace(/^\[|\]$/g, "").split("%", 1)[0].toLowerCase() : "";
  if (!raw) return "unknown";
  if (!raw.includes(":")) return ipv4Octets(raw)?.join(".") ?? "unknown";
  const groups = ipv6Groups(raw);
  if (!groups) return "unknown";
  if (groups.slice(0, 5).every((group) => group === "0000") && groups[5] === "ffff") {
    const high = Number.parseInt(groups[6], 16);
    const low = Number.parseInt(groups[7], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
  }
  return `v6/64:${groups.slice(0, 4).join(":")}`;
}
