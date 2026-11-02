import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft } from "lucide-react";
import { resolvePhotoUrl } from "@/components/PhotoUpload";
import { seniPenaltyLabel } from "@/pages/SeniScoring";

const SENI_LABEL = { tunggal: "Tunggal", ganda: "Ganda", regu: "Regu" };

function formatPoints(value) {
  return Number(value || 0).toFixed(2);
}

export default function MatchReport() {
  const { matchId } = useParams();
  const nav = useNavigate();
  const [state, setState] = useState(null);
  const [athletes, setAthletes] = useState({});
  const [arenas, setArenas] = useState({});
  const [events, setEvents] = useState({});
  const [logs, setLogs] = useState([]);
  const [seni, setSeni] = useState(null);

  useEffect(() => {
    api.get(`/matches/${matchId}`).then((r) => setState(r.data));
    api.get(`/matches/${matchId}/logs`).then((r) => setLogs(r.data));
  }, [matchId]);

  useEffect(() => {
    if (!state?.discipline || state.discipline === "tanding") {
      setSeni(null);
      return;
    }
    api.get(`/matches/${matchId}/seni`).then((r) => setSeni(r.data)).catch(() => setSeni(null));
  }, [state?.discipline, matchId]);

  useEffect(() => {
    if (!state?.event_id) return;
    Promise.all([
      api.get("/athletes", { params: { event_id: state.event_id } }),
      api.get("/arenas", { params: { event_id: state.event_id } }),
      api.get("/events"),
    ]).then(([a, ar, ev]) => {
      const am = {}; a.data.forEach(x => am[x.id] = x); setAthletes(am);
      const arm = {}; ar.data.forEach(x => arm[x.id] = x); setArenas(arm);
      const em = {}; ev.data.forEach(x => em[x.id] = x); setEvents(em);
    });
  }, [state?.event_id]);

  if (!state) return <div className="min-h-screen bg-[#0a0a0a] text-white p-8">Memuat...</div>;

  const red = athletes[state.red_athlete_id] || {};
  const blue = athletes[state.blue_athlete_id] || {};
  const arena = arenas[state.arena_id] || {};
  const event = events[state.event_id] || {};
  const seniMode = Boolean(state.discipline && state.discipline !== "tanding");
  const winnerName = state.winner_corner === "red" ? red.name : state.winner_corner === "blue" ? blue.name : state.winner_corner === "draw" ? "Seri" : "—";

  return (
    <div className="min-h-screen bg-zinc-100 text-black print:bg-white">
      <div className="no-print bg-[#0a0a0a] text-white px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <Button onClick={() => nav(-1)} variant="ghost" data-testid="report-back-btn" className="text-zinc-300 hover:text-white hover:bg-white/10">
          <ArrowLeft className="w-4 h-4 mr-2"/> Kembali
        </Button>
        <Button onClick={() => window.print()} data-testid="report-print-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black uppercase tracking-[0.15em]">
          <Printer className="w-4 h-4 mr-2"/> Cetak / Simpan PDF
        </Button>
      </div>

      <div className="max-w-4xl mx-auto p-12 print:p-8 bg-white shadow-xl print:shadow-none print-page">
        <div className="border-b-2 border-black pb-4 mb-6 flex items-center gap-4">
          {event.logo_url && (
            <img src={resolvePhotoUrl(event.logo_url)} alt="logo" className="w-16 h-16 object-contain" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          )}
          <div className="flex-1">
            <div className="text-xs tracking-[0.3em] uppercase text-zinc-600">{seniMode ? "Laporan Hasil Seni" : "Laporan Hasil Pertandingan"}</div>
            <h1 className="text-3xl font-bold mt-1" data-testid="report-event-name">{event.name || "Kejuaraan Pencak Silat"}</h1>
            <div className="text-sm text-zinc-700 mt-1">{event.location} · {event.start_date} → {event.end_date}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm mb-6">
          <Info label="Nomor Partai" value={`#${state.match_number}`} />
          <Info label="Gelanggang" value={arena.name || "—"} />
          <Info label="Babak" value={state.round_label || "—"} />
          <Info label="Status" value={(state.status || "").toUpperCase()} />
          {seniMode && <Info label="Kategori" value={`Seni ${SENI_LABEL[state.discipline] || state.discipline}`} />}
          <Info label="Mulai" value={state.started_at ? new Date(state.started_at).toLocaleString("id-ID") : "—"} />
          <Info label="Selesai" value={state.finished_at ? new Date(state.finished_at).toLocaleString("id-ID") : "—"} />
        </div>

        {seniMode ? <SeniReportBody seni={seni} /> : (
        <>
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="border-2 border-[#dc2626] p-4 flex gap-3" data-testid="report-red-corner">
            <div className="w-20 h-20 rounded-sm overflow-hidden bg-zinc-100 border border-[#dc2626]/30 shrink-0">
              {red.photo_url ? (
                <img src={resolvePhotoUrl(red.photo_url)} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              ) : (
                <div className="w-full h-full grid place-items-center text-[#dc2626] font-bold text-xl">{(red.name || "?").slice(0, 1)}</div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] tracking-[0.3em] uppercase text-[#dc2626] font-bold">Sudut Merah</div>
              <div className="text-xl font-bold mt-1 truncate">{red.name || "—"}</div>
              <div className="text-sm text-zinc-700">{red.weight ? `${red.weight} kg` : ""} {red.gender}</div>
              <div className="text-5xl font-bold mt-2 text-[#dc2626]" data-testid="report-red-score">{state.red.score}</div>
              <div className="text-xs text-zinc-700 mt-1">Teguran: {state.red.teguran} · Peringatan: {state.red.peringatan} · Binaan: {state.red.binaan}</div>
            </div>
          </div>
          <div className="border-2 border-[#2563eb] p-4 flex gap-3" data-testid="report-blue-corner">
            <div className="w-20 h-20 rounded-sm overflow-hidden bg-zinc-100 border border-[#2563eb]/30 shrink-0">
              {blue.photo_url ? (
                <img src={resolvePhotoUrl(blue.photo_url)} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              ) : (
                <div className="w-full h-full grid place-items-center text-[#2563eb] font-bold text-xl">{(blue.name || "?").slice(0, 1)}</div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] tracking-[0.3em] uppercase text-[#2563eb] font-bold">Sudut Biru</div>
              <div className="text-xl font-bold mt-1 truncate">{blue.name || "—"}</div>
              <div className="text-sm text-zinc-700">{blue.weight ? `${blue.weight} kg` : ""} {blue.gender}</div>
              <div className="text-5xl font-bold mt-2 text-[#2563eb]" data-testid="report-blue-score">{state.blue.score}</div>
              <div className="text-xs text-zinc-700 mt-1">Teguran: {state.blue.teguran} · Peringatan: {state.blue.peringatan} · Binaan: {state.blue.binaan}</div>
            </div>
          </div>
        </div>

        <div className="border-2 border-black p-4 mb-8 text-center">
          <div className="text-xs tracking-[0.3em] uppercase text-zinc-600">Pemenang</div>
          <div className={`text-4xl font-bold mt-1 ${state.winner_corner === "red" ? "text-[#dc2626]" : state.winner_corner === "blue" ? "text-[#2563eb]" : "text-black"}`}>
            {winnerName || "—"}
          </div>
          <div className="text-sm uppercase tracking-[0.2em] mt-1">{(state.decision_method || "").replace("_", " ")}</div>
        </div>

        <div className="mb-6">
          <h3 className="text-sm font-bold uppercase tracking-wide mb-2">Skor Per Ronde</h3>
          <table className="w-full text-sm border border-zinc-300">
            <thead className="bg-zinc-100">
              <tr><th className="p-2 text-left">Ronde</th><th className="p-2 text-right">Sudut Merah</th><th className="p-2 text-right">Sudut Biru</th></tr>
            </thead>
            <tbody>
              {Object.keys(state.per_round || { 1: {}, 2: {}, 3: {} }).map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b).map((r) => {
                const pr = state.per_round?.[r] || state.per_round?.[String(r)] || { red: 0, blue: 0 };
                return <tr key={r} className="border-t border-zinc-200"><td className="p-2">{r}</td><td className="p-2 text-right">{pr.red}</td><td className="p-2 text-right">{pr.blue}</td></tr>;
              })}
              <tr className="border-t-2 border-black font-bold"><td className="p-2">Total</td><td className="p-2 text-right">{state.red.score}</td><td className="p-2 text-right">{state.blue.score}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mb-6">
          <h3 className="text-sm font-bold uppercase tracking-wide mb-2">Log Tindakan</h3>
          <table className="w-full text-xs border border-zinc-300">
            <thead className="bg-zinc-100">
              <tr><th className="p-2 text-left">Waktu</th><th className="p-2">Ronde</th><th className="p-2">Sudut</th><th className="p-2">Tindakan</th><th className="p-2">Kode</th><th className="p-2 text-right">Poin</th><th className="p-2">Oleh</th></tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className={`border-t border-zinc-200 ${l.valid ? "" : "line-through text-zinc-400"}`}>
                  <td className="p-2 font-mono">{new Date(l.timestamp).toLocaleTimeString("id-ID")}</td>
                  <td className="p-2 text-center">{l.round}</td>
                  <td className="p-2 capitalize">{l.corner === "red" ? "Merah" : "Biru"}</td>
                  <td className="p-2 uppercase">{l.action_type}</td>
                  <td className="p-2">{l.code}</td>
                  <td className="p-2 text-right">+{l.points}</td>
                  <td className="p-2">{l.judge_name} ({l.judge_role})</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
        )}

        {state.approval_notes && (
          <div className="mb-6">
            <h3 className="text-sm font-bold uppercase tracking-wide mb-2">Catatan Ketua Juri</h3>
            <div className="border border-zinc-300 p-3 text-sm">{state.approval_notes}</div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-8 mt-16">
          <div className="text-center"><div className="border-t border-black pt-2 text-xs">Wasit</div></div>
          <div className="text-center"><div className="border-t border-black pt-2 text-xs">Ketua Juri</div><div className="text-xs mt-1">{state.approved_by_name || ""}</div></div>
          <div className="text-center"><div className="border-t border-black pt-2 text-xs">Operator</div></div>
        </div>
      </div>
    </div>
  );
}

function SeniReportBody({ seni }) {
  if (!seni) return <div className="mb-8 text-sm text-zinc-600">Memuat nilai seni...</div>;
  const athletes = seni.athletes || [];
  return (
    <div data-testid="report-seni">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {athletes.map((athlete) => (
          <div key={athlete.id} className="border-2 border-black p-4 flex gap-3" data-testid="report-seni-athlete">
            <div className="w-20 h-20 rounded-sm overflow-hidden bg-zinc-100 border border-zinc-300 shrink-0">
              {athlete.photo_url ? (
                <img src={resolvePhotoUrl(athlete.photo_url)} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              ) : (
                <div className="w-full h-full grid place-items-center font-bold text-xl">{(athlete.name || "?").slice(0, 1)}</div>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-600 font-bold">Pesilat</div>
              <div className="text-xl font-bold mt-1">{athlete.name || "—"}</div>
              <div className="text-sm text-zinc-700">{athlete.weight ? `${athlete.weight} kg` : ""} {athlete.gender || ""}</div>
            </div>
          </div>
        ))}
        {athletes.length === 0 && <div className="text-sm text-zinc-600">Pesilat belum diisi</div>}
      </div>

      <div className="border-2 border-black p-4 mb-8 text-center">
        <div className="text-xs tracking-[0.3em] uppercase text-zinc-600">Nilai Akhir</div>
        <div className="text-5xl font-bold mt-1" data-testid="report-seni-final">{formatPoints(seni.final_score)}</div>
        <div className="text-sm mt-2">Rata-rata {formatPoints(seni.average)} · Hukuman −{formatPoints(seni.total_penalty)}</div>
      </div>

      <div className="mb-6">
        <h3 className="text-sm font-bold uppercase tracking-wide mb-2">Komponen Nilai Juri</h3>
        <table className="w-full text-sm border border-zinc-300" data-testid="report-seni-jury">
          <thead className="bg-zinc-100">
            <tr>
              <th className="p-2 text-left">Juri</th>
              <th className="p-2 text-right">Teknik</th>
              <th className="p-2 text-right">Wirama</th>
              <th className="p-2 text-right">Penghayatan</th>
              <th className="p-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {(seni.scores || []).map((score) => (
              <tr key={score.jury_id || score.jury_position} className="border-t border-zinc-200">
                <td className="p-2">{score.jury_name || `J${score.jury_position}`}</td>
                <td className="p-2 text-right">{formatPoints(score.teknik)}</td>
                <td className="p-2 text-right">{formatPoints(score.wirama)}</td>
                <td className="p-2 text-right">{formatPoints(score.penghayatan)}</td>
                <td className="p-2 text-right font-bold">{formatPoints(score.total)}</td>
              </tr>
            ))}
            {(seni.scores || []).length === 0 && (
              <tr><td colSpan={5} className="p-3 text-center text-zinc-500">Belum ada nilai juri</td></tr>
            )}
          </tbody>
        </table>
        {seni.dropped_high_low && <div className="text-xs text-zinc-600 mt-2">Nilai tertinggi dan terendah tidak dihitung.</div>}
      </div>

      <div className="mb-6">
        <h3 className="text-sm font-bold uppercase tracking-wide mb-2">Hukuman</h3>
        <table className="w-full text-sm border border-zinc-300" data-testid="report-seni-penalties">
          <thead className="bg-zinc-100">
            <tr><th className="p-2 text-left">Jenis</th><th className="p-2 text-left">Catatan</th><th className="p-2 text-right">Nilai</th></tr>
          </thead>
          <tbody>
            {(seni.penalties || []).map((penalty) => (
              <tr key={penalty.id} className="border-t border-zinc-200">
                <td className="p-2">{seniPenaltyLabel(penalty.code)}</td>
                <td className="p-2">{penalty.notes || "—"}</td>
                <td className="p-2 text-right">−{formatPoints(penalty.value)}</td>
              </tr>
            ))}
            {(seni.penalties || []).length === 0 && (
              <tr><td colSpan={3} className="p-3 text-center text-zinc-500">Tidak ada hukuman</td></tr>
            )}
            <tr className="border-t-2 border-black font-bold">
              <td className="p-2" colSpan={2}>Total hukuman</td>
              <td className="p-2 text-right">−{formatPoints(seni.total_penalty)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
