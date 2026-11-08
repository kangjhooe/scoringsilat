import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft } from "lucide-react";
import { resolvePhotoUrl } from "@/components/PhotoUpload";
import { seniPenaltyLabel } from "@/pages/SeniScoring";
import { PrintLetterhead, printFileTitle, usePrintTitle } from "@/components/PrintDocument";
import { namesForRole } from "@/lib/printDoc";

const SENI_LABEL = { tunggal: "Tunggal", ganda: "Ganda", regu: "Regu" };

function formatPoints(value) {
  return Number(value || 0).toFixed(2);
}

export function MatchReportSheet({ state, athletes, arena, event, logs, seni, sheet = false }) {
  const seniMode = Boolean(state.discipline && state.discipline !== "tanding");
  const red = athletes[state.red_athlete_id] || {};
  const blue = athletes[state.blue_athlete_id] || {};
  const winnerName = state.winner_corner === "red" ? red.name : state.winner_corner === "blue" ? blue.name : state.winner_corner === "draw" ? "Seri" : "—";
  const documentTitle = seniMode ? "Laporan Hasil Seni" : "Laporan Hasil Pertandingan";

  return (
    <div className={`bg-white text-black shadow-xl print:shadow-none p-6 sm:p-10 print:p-0 ${sheet ? "report-sheet mb-8 print:mb-0" : ""}`}>
      <PrintLetterhead event={event} documentTitle={documentTitle} />

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
            <CornerCard testId="report-red-corner" scoreTestId="report-red-score" corner="red" athlete={red} side={state.red} />
            <CornerCard testId="report-blue-corner" scoreTestId="report-blue-score" corner="blue" athlete={blue} side={state.blue} />
          </div>

          <div className="border-2 border-black p-4 mb-8 text-center print-keep">
            <div className="text-xs tracking-[0.3em] uppercase text-zinc-600">Pemenang</div>
            <div className={`text-4xl font-bold mt-1 ${state.winner_corner === "red" ? "text-[#dc2626]" : state.winner_corner === "blue" ? "text-[#2563eb]" : "text-black"}`}>
              {winnerName || "—"}
            </div>
            <div className="text-sm uppercase tracking-[0.2em] mt-1">{(state.decision_method || "").split("_").join(" ")}</div>
          </div>

          <div className="mb-6">
            <h3 className="text-sm font-bold uppercase tracking-wide mb-2">Skor Per Ronde</h3>
            <table className="w-full text-sm border-collapse border border-zinc-300">
              <thead className="bg-zinc-100">
                <tr>
                  <th className="border border-zinc-300 p-2 text-left">Ronde</th>
                  <th className="border border-zinc-300 p-2 text-right">Sudut Merah</th>
                  <th className="border border-zinc-300 p-2 text-right">Sudut Biru</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(state.per_round || { 1: {}, 2: {}, 3: {} }).map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b).map((round) => {
                  const scores = state.per_round?.[round] || state.per_round?.[String(round)] || { red: 0, blue: 0 };
                  return (
                    <tr key={round}>
                      <td className="border border-zinc-300 p-2">{round}</td>
                      <td className="border border-zinc-300 p-2 text-right">{scores.red}</td>
                      <td className="border border-zinc-300 p-2 text-right">{scores.blue}</td>
                    </tr>
                  );
                })}
                <tr className="font-bold">
                  <td className="border border-zinc-300 p-2">Total</td>
                  <td className="border border-zinc-300 p-2 text-right">{state.red?.score}</td>
                  <td className="border border-zinc-300 p-2 text-right">{state.blue?.score}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mb-6">
            <h3 className="text-sm font-bold uppercase tracking-wide mb-2">Log Tindakan</h3>
            <table className="w-full text-xs border-collapse border border-zinc-300">
              <thead className="bg-zinc-100">
                <tr>
                  <th className="border border-zinc-300 p-2 text-left">Waktu</th>
                  <th className="border border-zinc-300 p-2">Ronde</th>
                  <th className="border border-zinc-300 p-2">Sudut</th>
                  <th className="border border-zinc-300 p-2">Tindakan</th>
                  <th className="border border-zinc-300 p-2">Kode</th>
                  <th className="border border-zinc-300 p-2 text-right">Poin</th>
                  <th className="border border-zinc-300 p-2">Oleh</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className={log.valid ? "" : "line-through text-zinc-400"}>
                    <td className="border border-zinc-300 p-2 font-mono">{new Date(log.timestamp).toLocaleTimeString("id-ID")}</td>
                    <td className="border border-zinc-300 p-2 text-center">{log.round}</td>
                    <td className="border border-zinc-300 p-2 capitalize">{log.corner === "red" ? "Merah" : "Biru"}</td>
                    <td className="border border-zinc-300 p-2 uppercase">{log.action_type}</td>
                    <td className="border border-zinc-300 p-2">{log.code}</td>
                    <td className="border border-zinc-300 p-2 text-right">+{log.points}</td>
                    <td className="border border-zinc-300 p-2">{log.judge_name} ({log.judge_role})</td>
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

      <div className="grid grid-cols-3 gap-8 mt-16 print-keep">
        <SignLine role="Wasit" name={namesForRole(logs, "referee")} />
        <SignLine role="Ketua Juri" name={state.approved_by_name || ""} />
        <SignLine role="Operator" name={namesForRole(logs, "operator")} />
      </div>
    </div>
  );
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
      const athleteMap = {}; a.data.forEach((item) => { athleteMap[item.id] = item; }); setAthletes(athleteMap);
      const arenaMap = {}; ar.data.forEach((item) => { arenaMap[item.id] = item; }); setArenas(arenaMap);
      const eventMap = {}; ev.data.forEach((item) => { eventMap[item.id] = item; }); setEvents(eventMap);
    });
  }, [state?.event_id]);

  const event = events[state?.event_id] || {};
  const title = state ? printFileTitle([`Laporan Partai ${state.match_number}`, event.name]) : "";
  usePrintTitle(title);

  if (!state) return <div className="min-h-screen bg-[#0a0a0a] text-white p-8">Memuat...</div>;

  return (
    <div className="min-h-screen bg-zinc-100 text-black print:bg-white">
      <div className="no-print bg-[#0a0a0a] text-white px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <Button onClick={() => nav(-1)} variant="ghost" data-testid="report-back-btn" className="text-zinc-300 hover:text-white hover:bg-white/10">
          <ArrowLeft className="w-4 h-4 mr-2" /> Kembali
        </Button>
        <Button onClick={() => window.print()} data-testid="report-print-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black uppercase tracking-[0.15em]">
          <Printer className="w-4 h-4 mr-2" /> Cetak / Simpan PDF
        </Button>
      </div>
      <div className="max-w-4xl mx-auto p-4 sm:p-8 print:p-0 print:max-w-none">
        <MatchReportSheet
          state={state}
          athletes={athletes}
          arena={arenas[state.arena_id] || {}}
          event={event}
          logs={logs}
          seni={seni}
        />
      </div>
    </div>
  );
}

function CornerCard({ testId, scoreTestId, corner, athlete, side }) {
  const red = corner === "red";
  const color = red ? "#dc2626" : "#2563eb";
  const label = red ? "Sudut Merah" : "Sudut Biru";
  return (
    <div className="border-2 p-4 flex gap-3" style={{ borderColor: color }} data-testid={testId}>
      <div className="w-20 h-20 rounded-sm overflow-hidden bg-zinc-100 shrink-0" style={{ border: `1px solid ${color}` }}>
        {athlete.photo_url ? (
          <img src={resolvePhotoUrl(athlete.photo_url)} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
        ) : (
          <div className="w-full h-full grid place-items-center font-bold text-xl" style={{ color }}>{(athlete.name || "?").slice(0, 1)}</div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] tracking-[0.3em] uppercase font-bold" style={{ color }}>{label}</div>
        <div className="text-xl font-bold mt-1 truncate">{athlete.name || "—"}</div>
        <div className="text-sm text-zinc-700">{athlete.weight ? `${athlete.weight} kg` : ""} {athlete.gender}</div>
        <div className="text-5xl font-bold mt-2" style={{ color }} data-testid={scoreTestId}>{side?.score}</div>
        <div className="text-xs text-zinc-700 mt-1">Teguran: {side?.teguran} · Peringatan: {side?.peringatan} · Binaan: {side?.binaan}</div>
      </div>
    </div>
  );
}

function SignLine({ role, name }) {
  return (
    <div className="text-center text-xs">
      <div className="h-14" />
      <div className="min-h-[1.25rem] font-medium break-words">{name || "\u00a0"}</div>
      <div className="border-t border-black pt-1 mt-1">{role}</div>
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
        <table className="w-full text-sm border-collapse border border-zinc-300" data-testid="report-seni-jury">
          <thead className="bg-zinc-100">
            <tr>
              <th className="border border-zinc-300 p-2 text-left">Juri</th>
              <th className="border border-zinc-300 p-2 text-right">Teknik</th>
              <th className="border border-zinc-300 p-2 text-right">Wirama</th>
              <th className="border border-zinc-300 p-2 text-right">Penghayatan</th>
              <th className="border border-zinc-300 p-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {(seni.scores || []).map((score) => (
              <tr key={score.jury_id || score.jury_position}>
                <td className="border border-zinc-300 p-2">{score.jury_name || `J${score.jury_position}`}</td>
                <td className="border border-zinc-300 p-2 text-right">{formatPoints(score.teknik)}</td>
                <td className="border border-zinc-300 p-2 text-right">{formatPoints(score.wirama)}</td>
                <td className="border border-zinc-300 p-2 text-right">{formatPoints(score.penghayatan)}</td>
                <td className="border border-zinc-300 p-2 text-right font-bold">{formatPoints(score.total)}</td>
              </tr>
            ))}
            {(seni.scores || []).length === 0 && (
              <tr><td colSpan={5} className="border border-zinc-300 p-3 text-center text-zinc-500">Belum ada nilai juri</td></tr>
            )}
          </tbody>
        </table>
        {seni.dropped_high_low && <div className="text-xs text-zinc-600 mt-2">Nilai tertinggi dan terendah tidak dihitung.</div>}
      </div>

      <div className="mb-6">
        <h3 className="text-sm font-bold uppercase tracking-wide mb-2">Hukuman</h3>
        <table className="w-full text-sm border-collapse border border-zinc-300" data-testid="report-seni-penalties">
          <thead className="bg-zinc-100">
            <tr>
              <th className="border border-zinc-300 p-2 text-left">Jenis</th>
              <th className="border border-zinc-300 p-2 text-left">Catatan</th>
              <th className="border border-zinc-300 p-2 text-right">Nilai</th>
            </tr>
          </thead>
          <tbody>
            {(seni.penalties || []).map((penalty) => (
              <tr key={penalty.id}>
                <td className="border border-zinc-300 p-2">{seniPenaltyLabel(penalty.code)}</td>
                <td className="border border-zinc-300 p-2">{penalty.notes || "—"}</td>
                <td className="border border-zinc-300 p-2 text-right">−{formatPoints(penalty.value)}</td>
              </tr>
            ))}
            {(seni.penalties || []).length === 0 && (
              <tr><td colSpan={3} className="border border-zinc-300 p-3 text-center text-zinc-500">Tidak ada hukuman</td></tr>
            )}
            <tr className="font-bold">
              <td className="border border-zinc-300 p-2" colSpan={2}>Total hukuman</td>
              <td className="border border-zinc-300 p-2 text-right">−{formatPoints(seni.total_penalty)}</td>
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
