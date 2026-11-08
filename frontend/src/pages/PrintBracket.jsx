import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { PrintFrame, Paper, PrintLetterhead, printFileTitle } from "@/components/PrintDocument";
import { byId } from "@/lib/printDoc";

function roundTitle(roundNum, total) {
  if (roundNum === total) return "Juara";
  if (roundNum === total - 1) return "Final";
  if (roundNum === total - 2 && total > 2) return "Semi Final";
  return `Ronde ${roundNum}`;
}

function pairsOf(slots) {
  const sorted = [...slots].sort((a, b) => a.position - b.position);
  const out = [];
  for (let i = 0; i < sorted.length; i += 2) out.push(sorted.slice(i, i + 2));
  return out;
}

function slotName(slot, contingents) {
  if (!slot) return "—";
  if (slot.is_bye && !slot.athlete) return "Bye";
  if (!slot.athlete) return "Menunggu";
  const contingent = contingents[slot.athlete.contingent_id]?.name;
  return contingent ? `${slot.athlete.name} (${contingent})` : slot.athlete.name;
}

function winnerName(pair, contingents) {
  const match = pair.map((slot) => slot.match).find(Boolean);
  if (!match) {
    const filled = pair.filter((slot) => slot.athlete);
    const bye = pair.some((slot) => slot.is_bye && !slot.athlete);
    if (filled.length === 1 && bye) return `${slotName(filled[0], contingents)} · lolos`;
    return "—";
  }
  if (match.winner_corner === "draw") return "Seri";
  if (match.winner_corner === "red" || match.winner_corner === "blue") {
    const id = match.winner_corner === "red" ? match.red_athlete_id : match.blue_athlete_id;
    const slot = pair.find((item) => item.athlete?.id === id);
    return slot ? slotName(slot, contingents) : "—";
  }
  return "—";
}

export default function PrintBracket() {
  const { bid } = useParams();
  const [data, setData] = useState(null);
  const [contingents, setContingents] = useState({});
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.get(`/brackets/${bid}`).then(async (response) => {
      if (cancelled) return;
      setData(response.data);
      if (response.data?.event_id) {
        const contingentsResponse = await api.get("/contingents", { params: { event_id: response.data.event_id } });
        if (!cancelled) setContingents(byId(contingentsResponse.data));
      }
    }).catch((err) => { if (!cancelled) setError(formatApiError(err)); });
    return () => { cancelled = true; };
  }, [bid]);

  const rounds = useMemo(() => {
    if (!data?.slots) return [];
    const max = data.slots.reduce((highest, slot) => Math.max(highest, slot.round), 0);
    const out = [];
    for (let round = 1; round <= max; round += 1) {
      out.push(data.slots.filter((slot) => slot.round === round));
    }
    return out;
  }, [data]);

  const title = printFileTitle(["Bagan", data?.class_name || data?.name, data?.event?.name]);
  const champion = rounds.length ? rounds[rounds.length - 1].find((slot) => slot.athlete) : null;

  return (
    <PrintFrame title={title} landscape wide>
      <Paper>
        {!data && !error && <p className="text-sm text-zinc-600">Memuat bagan...</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
        {data && (
          <>
            <PrintLetterhead event={data.event} documentTitle="Bagan Pertandingan" />
            <div className="text-center mb-4">
              <h2 className="text-xl font-bold">{data.name}</h2>
              <div className="text-sm text-zinc-700">{data.class_name || "Tanpa kelas"} · {data.size} peserta</div>
            </div>
            {rounds.map((slots, index) => {
              const roundNum = index + 1;
              const label = roundTitle(roundNum, rounds.length);
              if (slots.length < 2) {
                return (
                  <section key={label} className="mt-6 print-keep">
                    <h3 className="text-sm font-bold uppercase tracking-wide border-b border-black pb-1 mb-2">{label}</h3>
                    <p className="text-base font-semibold">{champion ? slotName(champion, contingents) : "Belum ada juara"}</p>
                  </section>
                );
              }
              return (
                <section key={label} className="mt-6">
                  <h3 className="text-sm font-bold uppercase tracking-wide border-b border-black pb-1 mb-2">{label}</h3>
                  <table className="w-full text-sm border-collapse border border-zinc-400">
                    <thead className="bg-zinc-100">
                      <tr>
                        <th className="border border-zinc-300 p-2 text-left w-16">Partai</th>
                        <th className="border border-zinc-300 p-2 text-left">Merah</th>
                        <th className="border border-zinc-300 p-2 text-left">Biru</th>
                        <th className="border border-zinc-300 p-2 text-left">Pemenang</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pairsOf(slots).map((pair, pairIndex) => {
                        const match = pair.map((slot) => slot.match).find(Boolean);
                        return (
                          <tr key={pair[0]?.id || pairIndex}>
                            <td className="border border-zinc-300 p-2">{match ? `#${match.match_number}` : "—"}</td>
                            <td className="border border-zinc-300 p-2">{slotName(pair[0], contingents)}</td>
                            <td className="border border-zinc-300 p-2">{slotName(pair[1], contingents)}</td>
                            <td className="border border-zinc-300 p-2">{winnerName(pair, contingents)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              );
            })}
          </>
        )}
      </Paper>
    </PrintFrame>
  );
}
