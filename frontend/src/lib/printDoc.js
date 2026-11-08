const ID_MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export const MATCH_STATUS = {
  scheduled: "Terjadwal",
  in_progress: "Berlangsung",
  paused: "Dijeda",
  finished: "Selesai",
  approved: "Disahkan",
};

export function fileTitle(parts) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" - ")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function parseIsoDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!match) return null;
  return { year: match[1], month: Number(match[2]), day: Number(match[3]) };
}

export function formatEventRange(start, end) {
  const a = parseIsoDate(start);
  const b = parseIsoDate(end);
  if (!a && !b) return "";
  const one = (d) => `${d.day} ${ID_MONTHS[d.month - 1] || d.month} ${d.year}`;
  if (a && b && (a.year !== b.year || a.month !== b.month || a.day !== b.day)) {
    if (a.year === b.year && a.month === b.month) return `${a.day}–${b.day} ${ID_MONTHS[a.month - 1]} ${a.year}`;
    if (a.year === b.year) return `${a.day} ${ID_MONTHS[a.month - 1]} – ${b.day} ${ID_MONTHS[b.month - 1]} ${a.year}`;
    return `${one(a)} – ${one(b)}`;
  }
  return one(a || b);
}

export function formatEventPlaceDate(event) {
  return [event?.location, formatEventRange(event?.start_date, event?.end_date)].filter(Boolean).join(" · ");
}

export function namesForRole(logs, role) {
  const seen = new Set();
  const names = [];
  (logs || []).forEach((log) => {
    if ((log.judge_role || "") !== role) return;
    String(log.judge_name || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((name) => {
        const key = name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        names.push(name);
      });
  });
  return names.join(", ");
}

export function formatWhen(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function genderLabel(value) {
  if (value === "putra") return "Putra";
  if (value === "putri") return "Putri";
  return value || "—";
}

export function byId(list) {
  const map = {};
  (list || []).forEach((item) => { if (item?.id) map[item.id] = item; });
  return map;
}
