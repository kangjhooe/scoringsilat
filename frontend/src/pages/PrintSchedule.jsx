import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PrintFrame, Paper, PrintLetterhead, printFileTitle } from "@/components/PrintDocument";
import { MATCH_STATUS, byId, formatWhen } from "@/lib/printDoc";

const DISCIPLINE = { tanding: "Tanding", tunggal: "Tunggal", ganda: "Ganda", regu: "Regu" };

function arenaLabel(arenas, id) {
  return (arenas || []).find((arena) => arena.id === id)?.name || "Tanpa gelanggang";
}

function sideNames(match, athletes, corner) {
  if ((match.discipline || "tanding") !== "tanding") {
    if (corner === "blue") return "—";
    const ids = [];
    if (match.red_athlete_id) ids.push(match.red_athlete_id);
    (match.performer_ids || []).forEach((id) => { if (id && !ids.includes(id)) ids.push(id); });
    const names = ids.map((id) => athletes[id]?.name).filter(Boolean);
    return names.join(", ") || "—";
  }
  const id = corner === "red" ? match.red_athlete_id : match.blue_athlete_id;
  return athletes[id]?.name || "—";
}

export default function PrintSchedule() {
  const [params] = useSearchParams();
  const eventId = params.get("event") || "";
  const [groupBy, setGroupBy] = useState("arena");
  const [event, setEvent] = useState(null);
  const [matches, setMatches] = useState([]);
  const [athletes, setAthletes] = useState({});
  const [arenas, setArenas] = useState([]);
  const [classes, setClasses] = useState({});
  const [categories, setCategories] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) { setLoading(false); setError("Event tidak dipilih."); return undefined; }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get(`/events/${eventId}`),
      api.get("/matches", { params: { event_id: eventId } }),
      api.get("/athletes", { params: { event_id: eventId } }),
      api.get("/arenas", { params: { event_id: eventId } }),
      api.get("/classes", { params: { event_id: eventId } }),
      api.get("/categories", { params: { event_id: eventId } }),
    ]).then(([ev, m, ath, ar, cls, cat]) => {
      if (cancelled) return;
      setEvent(ev.data);
      setMatches(m.data || []);
      setAthletes(byId(ath.data));
      setArenas(ar.data || []);
      setClasses(byId(cls.data));
      setCategories(byId(cat.data));
      setError("");
    }).catch((err) => {
      if (!cancelled) setError(formatApiError(err));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [eventId]);

  const classLabel = (match) => {
    const cls = classes[match.class_id];
    const cat = categories[match.category_id] || categories[cls?.category_id];
    return [cat?.name, cls?.name].filter(Boolean).join(" · ") || "—";
  };

  const groups = useMemo(() => {
    const buckets = new Map();
    matches.forEach((match) => {
      const key = groupBy === "arena" ? arenaLabel(arenas, match.arena_id) : (match.round_label || "Tanpa babak");
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(match);
    });
    return [...buckets.entries()]
      .map(([title, rows]) => ({
        title,
        rows: [...rows].sort((a, b) => (a.match_number || 0) - (b.match_number || 0)),
      }))
      .sort((a, b) => (a.rows[0]?.match_number || 0) - (b.rows[0]?.match_number || 0));
  }, [matches, groupBy, arenas]);

  const title = printFileTitle(["Jadwal Partai", event?.name]);

  return (
    <PrintFrame
      title={title}
      toolbar={(
        <>
          <Button variant="ghost" onClick={() => setGroupBy("arena")} className={groupBy === "arena" ? "bg-white text-black hover:bg-white" : "text-zinc-300 hover:text-white hover:bg-white/10"} data-testid="schedule-group-arena">Per gelanggang</Button>
          <Button variant="ghost" onClick={() => setGroupBy("round")} className={groupBy === "round" ? "bg-white text-black hover:bg-white" : "text-zinc-300 hover:text-white hover:bg-white/10"} data-testid="schedule-group-round">Per babak</Button>
        </>
      )}
    >
      <Paper>
        <PrintLetterhead event={event} documentTitle="Jadwal Partai" />
        {loading && <p className="text-sm text-zinc-600">Memuat jadwal...</p>}
        {error && <p className="text-sm text-red-700" data-testid="schedule-error">{error}</p>}
        {!loading && !error && groups.length === 0 && <p className="text-sm text-zinc-600">Belum ada partai pada event ini.</p>}
        {groups.map((group) => (
          <section key={group.title} className="mt-6 print-keep">
            <h2 className="text-sm font-bold uppercase tracking-wide border-b border-black pb-1 mb-2">{group.title}</h2>
            <table className="w-full text-sm border-collapse border border-zinc-400">
              <thead className="bg-zinc-100">
                <tr>
                  <th className="border border-zinc-300 p-2 text-left w-12">No</th>
                  <th className="border border-zinc-300 p-2 text-left">Waktu</th>
                  <th className="border border-zinc-300 p-2 text-left">{groupBy === "arena" ? "Babak" : "Gelanggang"}</th>
                  <th className="border border-zinc-300 p-2 text-left">Kelas</th>
                  <th className="border border-zinc-300 p-2 text-left">Merah / Pesilat</th>
                  <th className="border border-zinc-300 p-2 text-left">Biru</th>
                  <th className="border border-zinc-300 p-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((match) => (
                  <tr key={match.id}>
                    <td className="border border-zinc-300 p-2">{match.match_number}</td>
                    <td className="border border-zinc-300 p-2 whitespace-nowrap">{formatWhen(match.scheduled_at)}</td>
                    <td className="border border-zinc-300 p-2">{groupBy === "arena" ? (match.round_label || "—") : arenaLabel(arenas, match.arena_id)}</td>
                    <td className="border border-zinc-300 p-2">
                      {classLabel(match)}
                      {(match.discipline && match.discipline !== "tanding") ? ` · ${DISCIPLINE[match.discipline] || match.discipline}` : ""}
                    </td>
                    <td className="border border-zinc-300 p-2">{sideNames(match, athletes, "red")}</td>
                    <td className="border border-zinc-300 p-2">{sideNames(match, athletes, "blue")}</td>
                    <td className="border border-zinc-300 p-2">{MATCH_STATUS[match.status] || match.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </Paper>
    </PrintFrame>
  );
}
