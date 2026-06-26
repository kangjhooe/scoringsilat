import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Calendar, Trophy, Activity, Users, Tv, FileText } from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [events, setEvents] = useState([]);
  const [matches, setMatches] = useState([]);
  const [athletes, setAthletes] = useState({});
  const [arenas, setArenas] = useState({});

  useEffect(() => {
    api.get("/events").then((r) => {
      setEvents(r.data);
      if (r.data[0]) loadForEvent(r.data[0].id);
    });
  }, []);

  const loadForEvent = async (eventId) => {
    const [m, a, ar] = await Promise.all([
      api.get("/matches", { params: { event_id: eventId } }),
      api.get("/athletes", { params: { event_id: eventId } }),
      api.get("/arenas", { params: { event_id: eventId } }),
    ]);
    setMatches(m.data);
    const am = {}; a.data.forEach(x => am[x.id] = x); setAthletes(am);
    const arm = {}; ar.data.forEach(x => arm[x.id] = x); setArenas(arm);
  };

  const counts = {
    total: matches.length,
    inProgress: matches.filter(m => m.status === "in_progress").length,
    approved: matches.filter(m => m.status === "approved").length,
    scheduled: matches.filter(m => m.status === "scheduled").length,
  };

  return (
    <AppShell title={`Halo, ${user.name}`}>
      <div className="mb-4 text-zinc-400 text-sm">Berikut ringkasan pertandingan hari ini.</div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Partai" value={counts.total} icon={Calendar} />
        <StatCard label="Berlangsung" value={counts.inProgress} icon={Activity} color="#10b981"/>
        <StatCard label="Terjadwal" value={counts.scheduled} icon={Trophy} color="#ffcc00"/>
        <StatCard label="Disahkan" value={counts.approved} icon={FileText} color="#3b82f6"/>
      </div>

      <h2 className="font-display text-2xl uppercase tracking-tight mb-4">Pertandingan</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {matches.length === 0 ? (
          <div className="col-span-2 border border-dashed border-white/10 rounded-sm p-12 text-center text-zinc-500">Belum ada partai</div>
        ) : matches.map((m) => {
          const r = athletes[m.red_athlete_id];
          const b = athletes[m.blue_athlete_id];
          const ar = arenas[m.arena_id];
          return (
            <Link key={m.id} to={`/match/${m.id}`} data-testid={`dash-match-${m.id}`} className="border border-white/10 hover:border-white/30 bg-[#141414] hover:bg-white/2 rounded-sm overflow-hidden transition-colors group">
              <div className="grid grid-cols-12">
                <div className="col-span-5 bg-corner-red-solid p-4">
                  <div className="text-[10px] tracking-[0.3em] uppercase text-white/70">Merah</div>
                  <div className="font-display text-xl uppercase truncate">{r?.name || "—"}</div>
                </div>
                <div className="col-span-2 bg-[#0a0a0a] flex flex-col items-center justify-center text-center p-2">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">VS</div>
                  <div className="text-zinc-400 text-xs mt-1">#{m.match_number}</div>
                </div>
                <div className="col-span-5 bg-corner-blue-solid p-4 text-right">
                  <div className="text-[10px] tracking-[0.3em] uppercase text-white/70">Biru</div>
                  <div className="font-display text-xl uppercase truncate">{b?.name || "—"}</div>
                </div>
              </div>
              <div className="px-4 py-3 flex items-center justify-between border-t border-white/10 text-xs text-zinc-400">
                <div>{ar?.name || "—"}</div>
                <StatusBadge status={m.status}/>
              </div>
            </Link>
          );
        })}
      </div>

      <h2 className="font-display text-2xl uppercase tracking-tight mt-10 mb-4">Public Display</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.values(arenas).map((a) => (
          <Link key={a.id} to={`/display/arena/${a.id}`} target="_blank" data-testid={`open-arena-display-${a.id}`} className="border border-white/10 hover:border-[#ffcc00] bg-[#141414] hover:bg-[#ffcc00]/5 transition-all rounded-sm p-4 flex items-center justify-between group">
            <div>
              <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400">Gelanggang</div>
              <div className="font-display text-xl uppercase">{a.name}</div>
            </div>
            <Tv className="w-5 h-5 text-zinc-500 group-hover:text-[#ffcc00] transition-colors"/>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, icon: Icon, color = "#fff" }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#141414] p-4 flex items-center justify-between">
      <div>
        <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400">{label}</div>
        <div className="font-display text-4xl tracking-tighter mt-1" style={{ color }}>{value}</div>
      </div>
      <Icon className="w-8 h-8 text-zinc-600"/>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    scheduled: { label: "Terjadwal", c: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
    in_progress: { label: "Berlangsung", c: "bg-[#10b981]/15 text-[#10b981] border-[#10b981]/30 animate-pulse" },
    paused: { label: "Dijeda", c: "bg-[#ffcc00]/15 text-[#ffcc00] border-[#ffcc00]/30" },
    finished: { label: "Selesai", c: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
    approved: { label: "Disahkan", c: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  };
  const m = map[status] || map.scheduled;
  return <Badge className={`border ${m.c} text-[10px] tracking-[0.2em] uppercase rounded-sm`}>{m.label}</Badge>;
}
