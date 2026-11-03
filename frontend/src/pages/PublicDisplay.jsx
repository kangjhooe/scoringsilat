import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";
import { openPublicMatchSocket, openArenaSocket } from "@/lib/ws";
import { Tv, ArrowRight } from "lucide-react";
import AthleteAvatar from "@/components/AthleteAvatar";
import { resolvePhotoUrl } from "@/components/PhotoUpload";
import { seniPenaltyLabel } from "@/pages/SeniScoring";

function isSeniDiscipline(discipline) {
  return Boolean(discipline && discipline !== "tanding");
}

function formatPoints(value) {
  return Number(value || 0).toFixed(2);
}

function reloadPublicSeni(matchId, setSeni) {
  if (!matchId) return;
  api.get(`/public/matches/${matchId}/seni`).then((r) => setSeni(r.data)).catch(() => {
    setSeni({
      match: { id: matchId },
      athletes: [],
      scores: [],
      penalties: [],
      final_score: 0,
      average: 0,
      total_penalty: 0,
      jury_count: 0,
    });
  });
}

const SENI_LABEL = { tunggal: "Tunggal", ganda: "Ganda", regu: "Regu" };

function roundNumbers(state) {
  const keys = Object.keys(state?.per_round || {}).map(Number).filter((n) => !Number.isNaN(n));
  if (keys.length) return keys.sort((a, b) => a - b);
  const count = state?.rule?.round_count || 3;
  return Array.from({ length: count }, (_, i) => i + 1);
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function computeRemaining(timer) {
  if (!timer) return 0;
  let rem = timer.remaining_sec || 0;
  if (timer.running && timer.started_at) {
    rem = Math.max(0, rem - (Date.now() - new Date(timer.started_at).getTime()) / 1000);
  }
  return rem;
}

// ============ Selector view ============
function workspaceBack(user) {
  if (user?.role === "admin") return { to: "/admin", label: "← Kembali ke master data" };
  if (user?.role === "operator") return { to: "/operator", label: "← Kembali ke pertandingan" };
  if (user) return { to: "/dashboard", label: "← Kembali ke dashboard" };
  return { to: "/login", label: "← Kembali ke login" };
}

export function PublicSelector() {
  const { user, loading: authLoading } = useAuth();
  const [events, setEvents] = useState([]);
  const [arenas, setArenas] = useState([]);
  const [eventId, setEventId] = useState("");
  const back = workspaceBack(user);

  useEffect(() => {
    api.get("/public/events").then((r) => {
      setEvents(r.data);
      if (r.data[0]) setEventId(r.data[0].id);
    });
  }, []);

  useEffect(() => {
    if (!eventId) return;
    api.get("/public/arenas", { params: { event_id: eventId } }).then((r) => setArenas(r.data));
  }, [eventId]);

  return (
    <div className="min-h-screen bg-public p-4 sm:p-8 md:p-12">
      <div className="max-w-5xl mx-auto">
        <div className="text-[10px] tracking-[0.4em] uppercase text-[#ffcc00] mb-4">Public Display</div>
        <h1 className="font-display text-4xl sm:text-6xl md:text-7xl tracking-tighter uppercase mb-8 md:mb-12">Pilih Gelanggang</h1>

        <div className="mb-8">
          <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400 mb-2">Event</div>
          <select value={eventId} onChange={(e) => setEventId(e.target.value)} className="bg-[#141414] border border-white/10 px-4 py-3 text-white rounded-sm w-full max-w-md" data-testid="display-event-select">
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {arenas.map((a) => (
            <Link
              key={a.id}
              to={`/display/arena/${a.id}`}
              data-testid={`select-arena-${a.id}`}
              className="border border-white/10 hover:border-[#ffcc00] bg-[#141414] hover:bg-[#ffcc00]/5 transition-all rounded-sm p-6 flex items-center justify-between group tap-press"
            >
              <div>
                <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400">Gelanggang</div>
                <div className="font-display text-3xl tracking-tight uppercase">{a.name}</div>
              </div>
              <ArrowRight className="w-6 h-6 text-zinc-500 group-hover:text-[#ffcc00] transition-colors"/>
            </Link>
          ))}
          {arenas.length === 0 && <div className="text-zinc-500 text-sm col-span-3">Belum ada gelanggang untuk event ini</div>}
        </div>

        {!authLoading && (
          <div className="mt-12">
            <Link to={back.to} className="text-xs tracking-[0.3em] uppercase text-zinc-500 hover:text-[#ffcc00]">{back.label}</Link>
          </div>
        )}
      </div>
    </div>
  );
}

// ============ Arena display ============
export function PublicArenaDisplay() {
  const { arenaId } = useParams();
  const [matchId, setMatchId] = useState(null);
  const [state, setState] = useState(null);
  const [seni, setSeni] = useState(null);
  const [athletes, setAthletes] = useState({});
  const [arenaName, setArenaName] = useState("");

  useEffect(() => {
    api.get(`/public/arenas/${arenaId}/current`).then((r) => {
      if (r.data.match) { setState(r.data.match); setMatchId(r.data.match.id); }
    });
    const sock = openArenaSocket(arenaId, (msg) => {
      if (typeof msg?.type === "string" && msg.type.startsWith("seni_")) {
        if (msg.state) { setState(msg.state); setMatchId(msg.match_id); }
        reloadPublicSeni(msg.match_id, setSeni);
        return;
      }
      if (msg?.state) { setState(msg.state); setMatchId(msg.match_id); }
    });
    return () => sock.close();
  }, [arenaId]);

  useEffect(() => {
    if (!state?.event_id) return;
    api.get("/public/athletes", { params: { event_id: state.event_id } }).then((r) => {
      const map = {};
      r.data.forEach(a => { map[a.id] = a; });
      setAthletes(map);
    }).catch(() => { /* noop */ });
    api.get("/public/arenas", { params: { event_id: state.event_id } }).then((r) => {
      const a = r.data.find(x => x.id === arenaId);
      if (a) setArenaName(a.name);
    });
  }, [state?.event_id, arenaId]);

  useEffect(() => {
    if (!isSeniDiscipline(state?.discipline)) {
      setSeni(null);
      return;
    }
    reloadPublicSeni(state.id, setSeni);
  }, [state?.id, state?.discipline]);

  // Force re-render every 250ms when timer running
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  if (!state) return <DisplayEmpty arenaName={arenaName || `Gelanggang ${arenaId.slice(0,6)}`} />;
  if (isSeniDiscipline(state.discipline)) {
    if (seni?.match?.id !== state.id) return <DisplayEmpty arenaName={arenaName || "Gelanggang"} message="Memuat nilai seni..." />;
    return <DisplaySeni seni={seni} arenaName={arenaName || "Gelanggang"} />;
  }

  const red = athletes[state.red_athlete_id];
  const blue = athletes[state.blue_athlete_id];
  const remaining = computeRemaining(state.timer);

  return <DisplayScoreboard state={state} red={red} blue={blue} remaining={remaining} arenaName={arenaName || `Gelanggang`} />;
}

// ============ Match display (single match) ============
export function PublicMatchDisplay() {
  const { matchId } = useParams();
  const [state, setState] = useState(null);
  const [seni, setSeni] = useState(null);
  const [athletes, setAthletes] = useState({});

  useEffect(() => {
    api.get(`/public/matches/${matchId}`).then((r) => setState(r.data));
    const sock = openPublicMatchSocket(matchId, (msg) => {
      if (typeof msg?.type === "string" && msg.type.startsWith("seni_")) {
        if (msg.state) setState(msg.state);
        reloadPublicSeni(msg.match_id || matchId, setSeni);
        return;
      }
      if (msg?.state) setState(msg.state);
    });
    return () => sock.close();
  }, [matchId]);

  useEffect(() => {
    if (!state?.event_id) return;
    api.get("/public/athletes", { params: { event_id: state.event_id } }).then((r) => {
      const map = {}; r.data.forEach(a => { map[a.id] = a; }); setAthletes(map);
    }).catch(() => { /* noop */ });
  }, [state?.event_id]);

  useEffect(() => {
    if (!isSeniDiscipline(state?.discipline)) {
      setSeni(null);
      return;
    }
    reloadPublicSeni(state.id, setSeni);
  }, [state?.id, state?.discipline]);

  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 250); return () => clearInterval(id); }, []);

  if (!state) return <DisplayEmpty arenaName="Memuat..." />;
  if (isSeniDiscipline(state.discipline)) {
    if (seni?.match?.id !== state.id) return <DisplayEmpty arenaName="Memuat..." message="Memuat nilai seni..." />;
    return <DisplaySeni seni={seni} arenaName="" />;
  }
  const red = athletes[state.red_athlete_id];
  const blue = athletes[state.blue_athlete_id];
  const remaining = computeRemaining(state.timer);
  return <DisplayScoreboard state={state} red={red} blue={blue} remaining={remaining} arenaName=""/>;
}

function DisplayEmpty({ arenaName, message = "Menunggu partai dimulai..." }) {
  return (
    <div className="min-h-screen bg-public flex items-center justify-center p-6 sm:p-12">
      <div className="text-center">
        <Tv className="w-16 h-16 sm:w-20 sm:h-20 mx-auto text-zinc-700 mb-6"/>
        <div className="text-[10px] tracking-[0.4em] uppercase text-[#ffcc00] mb-2">Public Display</div>
        <div className="font-display text-3xl sm:text-5xl uppercase tracking-tighter">{arenaName}</div>
        <div className="text-zinc-400 mt-4">{message}</div>
      </div>
    </div>
  );
}

function DisplaySeni({ seni, arenaName }) {
  const match = seni.match || {};
  const athletes = seni.athletes || [];
  const approved = match.status === "approved";
  const label = SENI_LABEL[match.discipline] || "Seni";
  const statusText = approved ? "DISAHKAN" : match.status === "in_progress" ? "BERLANGSUNG" : String(match.status || "jadwal").toUpperCase();

  return (
    <div className="h-[100dvh] max-h-[100dvh] bg-public text-white relative overflow-hidden flex flex-col" data-testid="display-seni">
      <div className="absolute inset-0 texture-grain opacity-30 pointer-events-none"/>
      <div className="relative z-10 shrink-0 px-4 py-2 md:px-8 md:py-3 flex items-center justify-between gap-3 border-b border-white/10 bg-black/40">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 md:w-10 md:h-10 bg-[#ffcc00] grid place-items-center rounded-sm shrink-0">
            <span className="font-display text-xl md:text-2xl text-black leading-none">S</span>
          </div>
          <div className="min-w-0">
            <div className="font-display text-lg md:text-xl uppercase tracking-tight truncate">{arenaName || "Pencak Silat Championship"}</div>
            <div className="text-[10px] tracking-[0.2em] md:tracking-[0.3em] uppercase text-zinc-400 truncate">Seni {label} · Partai #{match.match_number} · {match.round_label}</div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">Status</div>
          <div className={`font-display text-lg md:text-2xl uppercase tracking-tight ${approved ? "text-[#10b981]" : "text-[#ffcc00]"}`} data-testid="display-seni-status">{statusText}</div>
        </div>
      </div>

      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto px-4 py-4 md:px-8 md:py-6 space-y-4">
        <div className={`grid gap-3 ${athletes.length > 1 ? "sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1 max-w-3xl"}`}>
          {athletes.map((athlete) => (
            <div key={athlete.id} className="border border-white/10 bg-black/40 rounded-sm p-4 flex items-center gap-4" data-testid="display-seni-athlete">
              <SeniPortrait athlete={athlete} />
              <div className="min-w-0">
                <div className="text-[10px] tracking-[0.25em] uppercase text-[#ffcc00]">Pesilat</div>
                <div className="font-display text-2xl md:text-4xl uppercase tracking-tight leading-none mt-1 line-clamp-2">{athlete.name || "—"}</div>
                <div className="text-zinc-400 text-sm mt-2">{[athlete.gender, athlete.weight ? `${athlete.weight} kg` : ""].filter(Boolean).join(" · ")}</div>
              </div>
            </div>
          ))}
          {athletes.length === 0 && <div className="text-zinc-500">Pesilat belum diisi</div>}
        </div>

        <div className="border border-[#ffcc00]/40 bg-[#ffcc00]/10 rounded-sm px-4 py-4 md:px-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] tracking-[0.3em] uppercase text-[#ffcc00]">Nilai Akhir</div>
            <div className="font-display text-6xl md:text-8xl tracking-tighter leading-none text-[#ffcc00]" data-testid="display-seni-final">{formatPoints(seni.final_score)}</div>
          </div>
          <div className="flex gap-6 text-right">
            <div>
              <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">Rata-rata</div>
              <div className="font-mono-display text-2xl md:text-3xl">{formatPoints(seni.average)}</div>
            </div>
            <div>
              <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">Hukuman</div>
              <div className="font-mono-display text-2xl md:text-3xl text-rose-300">−{formatPoints(seni.total_penalty)}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 border border-white/10 rounded-sm overflow-hidden bg-black/40" data-testid="display-seni-jury">
            <div className="px-4 py-3 text-[10px] tracking-[0.3em] uppercase text-zinc-400 border-b border-white/10">Rincian Juri · {seni.jury_count || 0}</div>
            <table className="w-full text-sm">
              <thead className="text-[10px] tracking-[0.15em] uppercase text-zinc-500">
                <tr>
                  <th className="text-left px-4 py-2">Juri</th>
                  <th className="text-right px-3 py-2">Teknik</th>
                  <th className="text-right px-3 py-2">Wirama</th>
                  <th className="text-right px-3 py-2">Penghayatan</th>
                  <th className="text-right px-4 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {(seni.scores || []).map((score) => (
                  <tr key={score.jury_id || score.jury_position} className="border-t border-white/5" data-testid={`display-seni-jury-${score.jury_position}`}>
                    <td className="px-4 py-2">{score.jury_name || `J${score.jury_position}`}</td>
                    <td className="px-3 py-2 text-right font-mono-display">{formatPoints(score.teknik)}</td>
                    <td className="px-3 py-2 text-right font-mono-display">{formatPoints(score.wirama)}</td>
                    <td className="px-3 py-2 text-right font-mono-display">{formatPoints(score.penghayatan)}</td>
                    <td className="px-4 py-2 text-right font-mono-display text-[#ffcc00]">{formatPoints(score.total)}</td>
                  </tr>
                ))}
                {(seni.scores || []).length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-zinc-500">Belum ada nilai juri</td></tr>
                )}
              </tbody>
            </table>
            {seni.dropped_high_low && <div className="px-4 py-2 text-[11px] text-zinc-500 border-t border-white/10">Nilai tertinggi dan terendah tidak dihitung.</div>}
          </div>

          <div className="lg:col-span-2 border border-white/10 rounded-sm bg-black/40 p-4" data-testid="display-seni-penalties">
            <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400 mb-3">Hukuman</div>
            {(seni.penalties || []).length === 0 && <div className="text-sm text-zinc-500">Tidak ada hukuman</div>}
            <div className="space-y-2">
              {(seni.penalties || []).map((penalty) => (
                <div key={penalty.id} className="flex items-start justify-between gap-3 text-sm" data-testid="display-seni-penalty">
                  <div className="min-w-0">
                    <div>{seniPenaltyLabel(penalty.code)}</div>
                    {penalty.notes && <div className="text-xs text-zinc-500 truncate">{penalty.notes}</div>}
                  </div>
                  <div className="font-mono-display text-rose-300 shrink-0">−{formatPoints(penalty.value)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SeniPortrait({ athlete }) {
  const photo = resolvePhotoUrl(athlete?.photo_url);
  return (
    <div className="w-16 h-16 md:w-24 md:h-24 rounded-sm overflow-hidden bg-black/50 border border-[#ffcc00]/40 shrink-0 grid place-items-center">
      {photo ? (
        <img src={photo} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
      ) : (
        <span className="font-display text-3xl text-[#ffcc00]">{(athlete?.name || "?").slice(0, 1)}</span>
      )}
    </div>
  );
}

function DisplayScoreboard({ state, red, blue, remaining, arenaName }) {
  const totalRounds = state.rule?.round_count || 3;
  const isApproved = state.status === "approved";
  const resting = state.timer?.phase === "rest";

  return (
    <div className="h-[100dvh] max-h-[100dvh] bg-public text-white relative overflow-hidden flex flex-col">
      <div className="absolute inset-0 texture-grain opacity-30 pointer-events-none"/>

      <div className="relative z-10 shrink-0 px-4 py-2 md:px-8 md:py-3 flex items-center justify-between gap-3 border-b border-white/10 bg-black/40">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 md:w-10 md:h-10 bg-[#ffcc00] grid place-items-center rounded-sm shrink-0">
            <span className="font-display text-xl md:text-2xl text-black leading-none">S</span>
          </div>
          <div className="min-w-0">
            <div className="font-display text-lg md:text-xl uppercase tracking-tight truncate">{arenaName || "Pencak Silat Championship"}</div>
            <div className="text-[10px] tracking-[0.2em] md:tracking-[0.3em] uppercase text-zinc-400 truncate">Partai #{state.match_number} · {state.round_label}</div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">Status</div>
          <div className={`font-display text-lg md:text-2xl uppercase tracking-tight ${state.timer?.running ? "text-[#10b981]" : "text-[#ffcc00]"}`}>
            {isApproved ? "DISAHKAN" : resting ? "ISTIRAHAT" : state.timer?.running ? "BERLANGSUNG" : state.status.toUpperCase()}
          </div>
        </div>
      </div>

      <div className="relative z-10 flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-y-auto lg:overflow-hidden">
        <div className="lg:col-span-5 bg-corner-red-solid p-4 md:p-5 xl:p-8 flex flex-col justify-between gap-4 relative overflow-hidden">
          <div className="absolute -top-20 -left-20 w-96 h-96 bg-white/5 rounded-full blur-3xl pointer-events-none"/>
          <div className="relative flex items-center gap-4 min-w-0">
            <AthleteAvatar athlete={red} corner="red" fluid className="display-avatar" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] tracking-[0.25em] uppercase text-white/70 mb-1">Sudut Merah</div>
              <div className="display-name font-display tracking-tighter uppercase leading-none line-clamp-2">{red?.name || "—"}</div>
              <div className="text-white/70 text-sm md:text-base mt-1">{red?.weight ? `${red.weight} kg` : ""}</div>
            </div>
          </div>
          <div className="relative">
            <div className="display-score font-display tracking-tighter leading-none" data-testid="display-red-score">{state.red.score}</div>
            <div className="flex flex-wrap gap-2 mt-2 text-xs">
              <Pill label="Teguran" value={state.red.teguran} />
              <Pill label="Peringatan" value={state.red.peringatan} />
              <Pill label="Binaan" value={state.red.binaan} />
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-black/60 flex flex-row lg:flex-col items-center justify-between gap-4 px-4 py-4 lg:py-5 border-y lg:border-y-0 lg:border-x border-white/10">
          <div className="text-center">
            <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500">Ronde</div>
            <div className="display-round font-display tracking-tighter mt-1">{state.current_round}<span className="text-zinc-700 text-[0.45em]">/{totalRounds}</span></div>
          </div>
          <div className="text-center">
            <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500 mb-1" data-testid="display-phase-label">{resting ? "Istirahat" : "Waktu"}</div>
            <div className={`display-timer font-mono-display tracking-tighter ${state.timer?.running ? "text-[#ffcc00] animate-pulse" : "text-white"}`} data-testid="display-timer">{fmtTime(remaining)}</div>
          </div>
          {isApproved && state.winner_corner && (
            <div className="text-center">
              <div className="text-[10px] tracking-[0.3em] uppercase text-[#10b981] mb-1">Pemenang</div>
              <div className={`font-display text-2xl md:text-3xl uppercase tracking-tight ${state.winner_corner === "red" ? "text-[#ff3b30]" : state.winner_corner === "blue" ? "text-[#007aff]" : "text-white"}`} data-testid="display-winner">
                {state.winner_corner === "draw" ? "SERI" : state.winner_corner === "red" ? "MERAH" : "BIRU"}
              </div>
              <div className="text-zinc-400 text-xs mt-1 uppercase tracking-[0.2em]">{(state.decision_method || "").replace("_", " ")}</div>
            </div>
          )}
          {!isApproved && <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-600">Live</div>}
        </div>

        <div className="lg:col-span-5 bg-corner-blue-solid p-4 md:p-5 xl:p-8 flex flex-col justify-between gap-4 relative overflow-hidden lg:text-right">
          <div className="absolute -top-20 -right-20 w-96 h-96 bg-white/5 rounded-full blur-3xl pointer-events-none"/>
          <div className="relative flex items-center gap-4 lg:flex-row-reverse min-w-0">
            <AthleteAvatar athlete={blue} corner="blue" fluid className="display-avatar" />
            <div className="min-w-0 flex-1 lg:text-right">
              <div className="text-[11px] tracking-[0.25em] uppercase text-white/70 mb-1">Sudut Biru</div>
              <div className="display-name font-display tracking-tighter uppercase leading-none line-clamp-2">{blue?.name || "—"}</div>
              <div className="text-white/70 text-sm md:text-base mt-1">{blue?.weight ? `${blue.weight} kg` : ""}</div>
            </div>
          </div>
          <div className="relative">
            <div className="display-score font-display tracking-tighter leading-none" data-testid="display-blue-score">{state.blue.score}</div>
            <div className="flex flex-wrap gap-2 mt-2 text-xs lg:justify-end">
              <Pill label="Teguran" value={state.blue.teguran} />
              <Pill label="Peringatan" value={state.blue.peringatan} />
              <Pill label="Binaan" value={state.blue.binaan} />
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-10 shrink-0 grid gap-px bg-white/10 border-t border-white/10" style={{ gridTemplateColumns: `repeat(${roundNumbers(state).length}, minmax(0, 1fr))` }}>
        {roundNumbers(state).map((r) => {
          const pr = state.per_round?.[r] || { red: 0, blue: 0 };
          const active = state.current_round === r;
          return (
            <div key={r} className={`px-2 py-2 md:px-4 md:py-3 flex items-center justify-between gap-2 ${active ? "bg-[#ffcc00]/10" : "bg-black/60"}`}>
              <div className="text-[10px] tracking-[0.15em] md:tracking-[0.3em] uppercase text-zinc-400">R{r}</div>
              <div className="flex items-center gap-2 md:gap-4">
                <div className="font-mono-display text-base md:text-2xl text-[#ff3b30]">{pr.red}</div>
                <div className="text-zinc-700 text-xs">vs</div>
                <div className="font-mono-display text-base md:text-2xl text-[#007aff]">{pr.blue}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Pill({ label, value }) {
  return (
    <div className="bg-black/30 px-3 py-1 rounded-sm border border-white/10 flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-[0.2em] text-white/70">{label}</span>
      <span className="font-mono-display text-base">{value}</span>
    </div>
  );
}
