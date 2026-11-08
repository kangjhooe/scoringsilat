import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PrintFrame, Paper, PrintLetterhead, printFileTitle } from "@/components/PrintDocument";
import { byId, genderLabel } from "@/lib/printDoc";

function classLabelOf(athlete, classes, categories) {
  const cls = classes[athlete.class_id];
  const cat = categories[athlete.category_id] || categories[cls?.category_id];
  return [cat?.name, cls?.name].filter(Boolean).join(" · ") || "Tanpa kelas";
}

function contingentNameOf(athlete, contingents) {
  return contingents[athlete.contingent_id]?.name || "Tanpa kontingen";
}

export default function PrintAthletes() {
  const [params] = useSearchParams();
  const eventId = params.get("event") || "";
  const [mode, setMode] = useState("class");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [event, setEvent] = useState(null);
  const [athletes, setAthletes] = useState([]);
  const [classes, setClasses] = useState({});
  const [categories, setCategories] = useState({});
  const [contingents, setContingents] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) { setLoading(false); setError("Event tidak dipilih."); return undefined; }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get(`/events/${eventId}`),
      api.get("/athletes", { params: { event_id: eventId } }),
      api.get("/classes", { params: { event_id: eventId } }),
      api.get("/categories", { params: { event_id: eventId } }),
      api.get("/contingents", { params: { event_id: eventId } }),
    ]).then(([ev, ath, cls, cat, cont]) => {
      if (cancelled) return;
      setEvent(ev.data);
      setAthletes(ath.data || []);
      setClasses(byId(cls.data));
      setCategories(byId(cat.data));
      setContingents(byId(cont.data));
      setError("");
    }).catch((err) => {
      if (!cancelled) setError(formatApiError(err));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [eventId]);

  const groups = useMemo(() => {
    const rows = athletes.filter((athlete) => includeInactive || athlete.status !== "inactive");
    const buckets = new Map();
    rows.forEach((athlete) => {
      const key = mode === "class" ? classLabelOf(athlete, classes, categories) : contingentNameOf(athlete, contingents);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(athlete);
    });
    return [...buckets.entries()]
      .map(([title, list]) => ({
        title,
        rows: [...list].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "id")),
      }))
      .sort((a, b) => a.title.localeCompare(b.title, "id"));
  }, [athletes, mode, includeInactive, classes, categories, contingents]);

  const title = printFileTitle(["Daftar Peserta", event?.name]);

  return (
    <PrintFrame
      title={title}
      toolbar={(
        <>
          <Button variant="ghost" onClick={() => setMode("class")} className={mode === "class" ? "bg-white text-black hover:bg-white" : "text-zinc-300 hover:text-white hover:bg-white/10"} data-testid="athletes-group-class">Per kelas</Button>
          <Button variant="ghost" onClick={() => setMode("contingent")} className={mode === "contingent" ? "bg-white text-black hover:bg-white" : "text-zinc-300 hover:text-white hover:bg-white/10"} data-testid="athletes-group-contingent">Per kontingen</Button>
          <label className="text-xs text-zinc-300 flex items-center gap-2 px-2">
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} data-testid="athletes-include-inactive" />
            Sertakan nonaktif
          </label>
        </>
      )}
    >
      <Paper>
        <PrintLetterhead event={event} documentTitle={mode === "class" ? "Daftar Peserta per Kelas" : "Daftar Peserta per Kontingen"} />
        {loading && <p className="text-sm text-zinc-600">Memuat peserta...</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
        {!loading && !error && groups.length === 0 && <p className="text-sm text-zinc-600">Belum ada peserta pada event ini.</p>}
        {groups.map((group) => (
          <section key={group.title} className="mt-6">
            <h2 className="text-sm font-bold uppercase tracking-wide border-b border-black pb-1 mb-2">{group.title} <span className="font-normal text-zinc-600">({group.rows.length})</span></h2>
            <table className="w-full text-sm border-collapse border border-zinc-400">
              <thead className="bg-zinc-100">
                <tr>
                  <th className="border border-zinc-300 p-2 text-left w-10">No</th>
                  <th className="border border-zinc-300 p-2 text-left">No. Peserta</th>
                  <th className="border border-zinc-300 p-2 text-left">Nama</th>
                  <th className="border border-zinc-300 p-2 text-left">{mode === "class" ? "Kontingen" : "Kelas"}</th>
                  <th className="border border-zinc-300 p-2 text-left">JK</th>
                  <th className="border border-zinc-300 p-2 text-right">Berat</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((athlete, index) => (
                  <tr key={athlete.id}>
                    <td className="border border-zinc-300 p-2">{index + 1}</td>
                    <td className="border border-zinc-300 p-2 font-mono text-xs">{athlete.participant_number || "—"}</td>
                    <td className="border border-zinc-300 p-2">{athlete.name || "—"}</td>
                    <td className="border border-zinc-300 p-2">{mode === "class" ? contingentNameOf(athlete, contingents) : classLabelOf(athlete, classes, categories)}</td>
                    <td className="border border-zinc-300 p-2">{genderLabel(athlete.gender)}</td>
                    <td className="border border-zinc-300 p-2 text-right">{athlete.weight ? `${athlete.weight} kg` : "—"}</td>
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
