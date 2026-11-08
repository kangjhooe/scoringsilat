import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { PrintFrame, printFileTitle } from "@/components/PrintDocument";
import { MatchReportSheet } from "@/pages/MatchReport";
import { byId } from "@/lib/printDoc";

export default function PrintReports() {
  const [params] = useSearchParams();
  const eventId = params.get("event") || "";
  const [pack, setPack] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) { setLoading(false); setError("Event tidak dipilih."); return undefined; }
    let cancelled = false;
    setLoading(true);
    api.get(`/events/${eventId}/match-reports`)
      .then((response) => { if (!cancelled) { setPack(response.data); setError(""); } })
      .catch((err) => { if (!cancelled) setError(formatApiError(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [eventId]);

  const athletes = byId(pack?.athletes);
  const arenas = byId(pack?.arenas);
  const reports = pack?.reports || [];
  const title = printFileTitle(["Laporan Partai Selesai", pack?.event?.name]);

  return (
    <PrintFrame title={title} wide>
      {loading && <p className="text-sm text-zinc-600">Memuat laporan...</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!loading && !error && reports.length === 0 && (
        <p className="text-sm text-zinc-600">Belum ada partai selesai atau disahkan.</p>
      )}
      <div className="space-y-8 print:space-y-0">
        {reports.map((report) => (
          <MatchReportSheet
            key={report.state.id}
            sheet
            state={report.state}
            athletes={athletes}
            arena={arenas[report.state.arena_id] || {}}
            event={pack.event || {}}
            logs={report.logs || []}
            seni={report.seni}
          />
        ))}
      </div>
    </PrintFrame>
  );
}
