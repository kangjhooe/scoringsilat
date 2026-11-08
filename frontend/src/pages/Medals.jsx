import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
import AppShell from "@/components/AppShell";
import api, { BACKEND_URL, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { resolvePhotoUrl } from "@/components/PhotoUpload";
import { toast, Toaster } from "sonner";
import { Download, Eye, Medal, Printer } from "lucide-react";

const PUB = axios.create({ baseURL: `${BACKEND_URL}/api` });

const DISCIPLINE_LABEL = { tanding: "Tanding", tunggal: "Tunggal", ganda: "Ganda", regu: "Regu" };

const PLACE_TONE = {
  1: "border-[#ffcc00]/50 bg-[#ffcc00]/10",
  2: "border-zinc-400/40 bg-white/[0.04]",
  3: "border-amber-700/50 bg-amber-950/30",
};
const PLACE_TEXT = {
  1: "text-[#ffcc00]",
  2: "text-zinc-200",
  3: "text-amber-500",
};

function classLine(group) {
  return [group.category_name, group.class_name].filter(Boolean).join(" · ");
}

export default function Medals({ publicMode = false }) {
  const { eventId: routeEventId } = useParams();
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState(() => (publicMode ? "" : localStorage.getItem("admin_event_id") || ""));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activeEventId = publicMode ? (routeEventId || "") : eventId;

  useEffect(() => {
    if (publicMode) return undefined;
    let cancelled = false;
    api.get("/events")
      .then((r) => {
        if (cancelled) return;
        const list = r.data || [];
        setEvents(list);
        setEventId((prev) => {
          if (prev && list.some((e) => e.id === prev)) return prev;
          const saved = localStorage.getItem("admin_event_id") || "";
          if (saved && list.some((e) => e.id === saved)) return saved;
          return list[0]?.id || "";
        });
      })
      .catch((e) => { if (!cancelled) setError(formatApiError(e)); });
    return () => { cancelled = true; };
  }, [publicMode]);

  useEffect(() => {
    if (!activeEventId) {
      setData(null);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    const req = publicMode
      ? PUB.get(`/public/events/${activeEventId}/medals`)
      : api.get(`/events/${activeEventId}/medals`);
    req
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch((e) => { if (!cancelled) { setData(null); setError(formatApiError(e)); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeEventId, publicMode]);

  const body = (
    <MedalsBody
      publicMode={publicMode}
      events={events}
      eventId={activeEventId}
      onEvent={(v) => { setEventId(v); localStorage.setItem("admin_event_id", v); }}
      data={data}
      loading={loading}
      error={error}
    />
  );

  if (publicMode) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white" data-testid="medals-public-page">
        <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#ffcc00] grid place-items-center rounded-sm"><span className="font-display text-xl text-black leading-none">S</span></div>
            <div className="font-display tracking-tight">SILAT SCORING</div>
          </Link>
          <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500">Medali</div>
        </header>
        <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">{body}</main>
      </div>
    );
  }

  return <AppShell title="Medali"><div data-testid="medals-page">{body}</div></AppShell>;
}

function MedalsBody({ publicMode, events, eventId, onEvent, data, loading, error }) {
  const [exporting, setExporting] = useState(false);

  const downloadExcel = async () => {
    if (!eventId || publicMode) return;
    setExporting(true);
    try {
      const event = events.find((item) => item.id === eventId);
      const slug = String(event?.code || event?.name || "event").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "event";
      const response = await api.get(`/events/${eventId}/export.xlsx`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slug}-export.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Berkas Excel diunduh");
    } catch (err) {
      let message = formatApiError(err);
      if (err?.response?.data instanceof Blob) {
        try {
          const parsed = JSON.parse(await err.response.data.text());
          if (typeof parsed?.detail === "string") message = parsed.detail;
        } catch {
          message = "Gagal mengunduh Excel";
        }
      }
      toast.error(message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      {!publicMode && <Toaster theme="dark" position="top-right" />}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="text-[10px] tracking-[0.3em] uppercase text-[#ffcc00]">Hasil akhir</div>
          <h1 className="font-display text-3xl md:text-4xl tracking-tight uppercase mt-1">
            {data?.event_name || "Medali"}
          </h1>
          <p className="text-sm text-zinc-400 mt-2 max-w-2xl">
            Juara tanding diambil dari bagan yang sudah selesai. Juara seni adalah tiga nilai tertinggi pada setiap kelas.
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {!publicMode && (
            <Select value={eventId || undefined} onValueChange={onEvent}>
              <SelectTrigger className="bg-[#141414] border-white/40 text-white w-72" data-testid="medals-event-select">
                <SelectValue placeholder="Pilih event" />
              </SelectTrigger>
              <SelectContent className="bg-[#141414] border-white/30 text-white">
                {events.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {!publicMode && eventId && (
            <Button
              onClick={downloadExcel}
              disabled={exporting}
              data-testid="export-xlsx-btn"
              title="Registrasi, atlet, dan hasil partai"
              className="bg-[#ffcc00] hover:bg-[#e6b800] text-black text-xs uppercase tracking-[0.15em]"
            >
              <Download className="w-4 h-4 mr-2" />{exporting ? "Mengunduh..." : "Unduh Excel"}
            </Button>
          )}
          {!publicMode && eventId && (
            <Link to={`/print/medals?event=${eventId}`}>
              <Button variant="ghost" className="border border-white/10 hover:bg-white/5 text-xs uppercase tracking-[0.15em]" data-testid="medals-print-link">
                <Printer className="w-4 h-4 mr-2" />Cetak Lembar
              </Button>
            </Link>
          )}
          {!publicMode && eventId && (
            <Link to={`/medals/${eventId}/public`} target="_blank">
              <Button variant="ghost" className="border border-white/10 hover:bg-white/5 text-xs uppercase tracking-[0.15em]" data-testid="medals-public-link">
                <Eye className="w-4 h-4 mr-2" />Tampilan Publik
              </Button>
            </Link>
          )}
        </div>
      </div>

      {!eventId && !publicMode && (
        <Empty text="Pilih event untuk melihat medali." />
      )}
      {loading && <div className="text-sm text-zinc-500">Memuat medali...</div>}
      {error && <div className="border border-rose-500/30 bg-rose-500/10 text-rose-200 rounded-sm px-4 py-3 text-sm" data-testid="medals-error">{error}</div>}

      {data && !loading && (
        <div className="space-y-10">
          <Section title="Tanding" count={(data.tanding || []).length} unit="bagan" testId="medals-tanding">
            {(data.tanding || []).length === 0 ? (
              <Empty text="Belum ada bagan tanding yang selesai." />
            ) : (data.tanding || []).map((group) => (
              <GroupCard
                key={group.bracket_id}
                testId={`medal-bracket-${group.bracket_id}`}
                kicker={classLine(group) || "Tanding"}
                title={group.name || group.class_name || "Bagan"}
                places={group.places}
              />
            ))}
          </Section>
          <Section title="Seni" count={(data.seni || []).length} unit="kelas" testId="medals-seni">
            {(data.seni || []).length === 0 ? (
              <Empty text="Belum ada partai seni yang disahkan." />
            ) : (data.seni || []).map((group) => (
              <GroupCard
                key={`${group.discipline}-${group.class_id || "none"}`}
                testId={`medal-seni-${group.discipline}-${group.class_id || "none"}`}
                kicker={[DISCIPLINE_LABEL[group.discipline] || group.discipline, group.category_name].filter(Boolean).join(" · ")}
                title={group.class_name || "Tanpa kelas"}
                places={group.places}
                showScore
              />
            ))}
          </Section>
        </div>
      )}
    </>
  );
}

function Section({ title, count, unit, testId, children }) {
  return (
    <section data-testid={testId}>
      <div className="flex items-center gap-3 mb-4">
        <Medal className="w-5 h-5 text-[#ffcc00]" />
        <h2 className="font-display text-2xl uppercase tracking-tight">{title}</h2>
        <span className="text-[10px] tracking-[0.2em] uppercase text-zinc-500">{count} {unit}</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{children}</div>
    </section>
  );
}

function GroupCard({ kicker, title, places, showScore = false, testId }) {
  return (
    <article className="border border-white/10 rounded-sm bg-[#141414] p-5" data-testid={testId}>
      <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500">{kicker || "Kelas"}</div>
      <h3 className="font-display text-2xl tracking-tight mt-1">{title}</h3>
      <div className="mt-4 space-y-2">
        {(places || []).map((row, index) => (
          <PlaceRow key={`${row.place}-${row.match_id || row.athlete?.id || index}`} row={row} showScore={showScore} />
        ))}
      </div>
    </article>
  );
}

function PlaceRow({ row, showScore }) {
  const athletes = row.athletes || (row.athlete ? [row.athlete] : []);
  return (
    <div className={`flex items-center gap-3 border rounded-sm px-3 py-3 ${PLACE_TONE[row.place] || "border-white/10"}`} data-testid={`medal-place-${row.place}`}>
      <div className={`w-16 shrink-0 text-[10px] tracking-[0.16em] uppercase font-semibold ${PLACE_TEXT[row.place] || "text-zinc-300"}`}>{row.label}</div>
      <div className="flex-1 min-w-0 space-y-2">
        {athletes.length === 0 ? <div className="text-sm text-zinc-500">—</div> : athletes.map((athlete, index) => (
          <AthleteLine key={`${athlete?.id || "a"}-${index}`} athlete={athlete} />
        ))}
      </div>
      {showScore && (
        <div className="font-mono-display text-2xl text-[#ffcc00] shrink-0" data-testid={`medal-score-${row.place}`}>
          {Number(row.score || 0).toFixed(2)}
        </div>
      )}
    </div>
  );
}

function AthleteLine({ athlete }) {
  const photo = resolvePhotoUrl(athlete?.photo_url);
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-9 h-9 rounded-sm bg-[#0a0a0a] border border-white/10 overflow-hidden shrink-0 grid place-items-center">
        {photo ? <img src={photo} alt="" className="w-full h-full object-cover" /> : <span className="text-zinc-600 text-xs">{(athlete?.name || "—").slice(0, 1)}</span>}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{athlete?.name || "—"}</div>
        <div className="text-[11px] text-zinc-500 truncate">{athlete?.contingent_name || "Tanpa kontingen"}</div>
      </div>
    </div>
  );
}

function Empty({ text }) {
  return (
    <div className="lg:col-span-2 border border-dashed border-white/10 rounded-sm p-10 text-center text-sm text-zinc-500">{text}</div>
  );
}
