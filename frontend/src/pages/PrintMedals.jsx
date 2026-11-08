import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { PrintFrame, Paper, PrintLetterhead, printFileTitle } from "@/components/PrintDocument";

const DISCIPLINE = { tanding: "Tanding", tunggal: "Tunggal", ganda: "Ganda", regu: "Regu" };

function people(row) {
  const list = row.athletes || (row.athlete ? [row.athlete] : []);
  return {
    names: list.map((athlete) => athlete?.name).filter(Boolean).join(", ") || "—",
    contingents: [...new Set(list.map((athlete) => athlete?.contingent_name).filter(Boolean))].join(", ") || "—",
  };
}

export default function PrintMedals() {
  const [params] = useSearchParams();
  const eventId = params.get("event") || "";
  const [event, setEvent] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) { setLoading(false); setError("Event tidak dipilih."); return undefined; }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get(`/events/${eventId}`),
      api.get(`/events/${eventId}/medals`),
    ]).then(([ev, medals]) => {
      if (cancelled) return;
      setEvent(ev.data);
      setData(medals.data);
      setError("");
    }).catch((err) => {
      if (!cancelled) setError(formatApiError(err));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [eventId]);

  const sheets = [];
  (data?.tanding || []).forEach((group) => {
    sheets.push({
      key: `t-${group.bracket_id}`,
      kicker: [group.category_name, "Tanding"].filter(Boolean).join(" · "),
      title: group.class_name || group.name || "Kelas",
      rows: (group.places || []).map((place) => ({ label: place.label, score: "", ...people(place) })),
    });
  });
  (data?.seni || []).forEach((group) => {
    sheets.push({
      key: `s-${group.discipline}-${group.class_id || "none"}`,
      kicker: [DISCIPLINE[group.discipline] || group.discipline, group.category_name].filter(Boolean).join(" · "),
      title: group.class_name || "Tanpa kelas",
      rows: (group.places || []).map((place) => ({
        label: place.label,
        score: Number(place.score || 0).toFixed(2),
        ...people(place),
      })),
    });
  });

  const title = printFileTitle(["Lembar Medali", event?.name]);

  return (
    <PrintFrame title={title}>
      {loading && <Paper><p className="text-sm text-zinc-600">Memuat medali...</p></Paper>}
      {error && <Paper><p className="text-sm text-red-700">{error}</p></Paper>}
      {!loading && !error && sheets.length === 0 && (
        <Paper>
          <PrintLetterhead event={event} documentTitle="Lembar Medali" />
          <p className="text-sm text-zinc-600">Belum ada juara. Bagan tanding harus selesai, dan partai seni harus disahkan.</p>
        </Paper>
      )}
      {sheets.map((sheet) => (
        <Paper key={sheet.key} sheet className="mb-6 print:mb-0">
          <PrintLetterhead event={event} documentTitle="Lembar Medali" />
          <div className="text-center mb-4">
            <div className="text-[11px] tracking-[0.2em] uppercase text-zinc-600">{sheet.kicker || "Kelas"}</div>
            <h2 className="text-xl font-bold mt-1">{sheet.title}</h2>
          </div>
          <table className="w-full text-sm border-collapse border border-zinc-400">
            <thead className="bg-zinc-100">
              <tr>
                <th className="border border-zinc-300 p-2 text-left w-28">Peringkat</th>
                <th className="border border-zinc-300 p-2 text-left">Nama</th>
                <th className="border border-zinc-300 p-2 text-left">Kontingen</th>
                <th className="border border-zinc-300 p-2 text-right w-24">Nilai</th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, index) => (
                <tr key={`${row.label}-${index}`}>
                  <td className="border border-zinc-300 p-2 font-semibold">{row.label}</td>
                  <td className="border border-zinc-300 p-2">{row.names}</td>
                  <td className="border border-zinc-300 p-2">{row.contingents}</td>
                  <td className="border border-zinc-300 p-2 text-right">{row.score || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Paper>
      ))}
    </PrintFrame>
  );
}
