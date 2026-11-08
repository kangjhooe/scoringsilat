import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer } from "lucide-react";
import { resolvePhotoUrl } from "@/components/PhotoUpload";
import { fileTitle, formatEventPlaceDate } from "@/lib/printDoc";

export function usePrintTitle(title) {
  useEffect(() => {
    if (!title) return undefined;
    const previous = document.title;
    document.title = title;
    return () => { document.title = previous; };
  }, [title]);
}

export function PrintToolbar({ onBack, children }) {
  const nav = useNavigate();
  return (
    <div className="no-print bg-[#0a0a0a] text-white px-4 sm:px-6 py-3 flex items-center justify-between gap-3 sticky top-0 z-10">
      <Button onClick={onBack || (() => nav(-1))} variant="ghost" className="text-zinc-300 hover:text-white hover:bg-white/10">
        <ArrowLeft className="w-4 h-4 mr-2" /> Kembali
      </Button>
      <div className="flex items-center gap-2 flex-wrap justify-end">
        {children}
        <Button onClick={() => window.print()} className="bg-[#ffcc00] hover:bg-[#e6b800] text-black uppercase tracking-[0.15em]">
          <Printer className="w-4 h-4 mr-2" /> Cetak / Simpan PDF
        </Button>
      </div>
    </div>
  );
}

export function PrintFrame({ title, onBack, landscape = false, wide = false, toolbar, children }) {
  usePrintTitle(title);
  return (
    <div className={`min-h-screen bg-zinc-100 text-black print:bg-white ${landscape ? "print-landscape" : ""}`}>
      <PrintToolbar onBack={onBack}>{toolbar}</PrintToolbar>
      <div className={`mx-auto p-4 sm:p-8 print:p-0 print:max-w-none ${wide || landscape ? "max-w-6xl" : "max-w-4xl"}`}>
        {children}
      </div>
    </div>
  );
}

export function Paper({ sheet = false, children, className = "" }) {
  return (
    <div className={`bg-white text-black shadow-xl print:shadow-none p-6 sm:p-10 print:p-0 ${sheet ? "report-sheet" : ""} ${className}`}>
      {children}
    </div>
  );
}

function LogoSlot({ src, alt }) {
  return (
    <div className="w-16 h-16 shrink-0 grid place-items-center">
      {src ? (
        <img src={src} alt={alt} className="max-w-full max-h-full object-contain" onError={(e) => { e.currentTarget.style.display = "none"; }} />
      ) : null}
    </div>
  );
}

export function PrintLetterhead({ event, documentTitle }) {
  const placeDate = formatEventPlaceDate(event);
  return (
    <header className="mb-5 print-keep">
      <div className="flex items-center gap-3">
        <LogoSlot src={resolvePhotoUrl(event?.institution_logo_url)} alt="Logo lembaga" />
        <div className="flex-1 min-w-0 text-center">
          {event?.institution_name ? (
            <div className="text-[11px] tracking-[0.16em] uppercase text-zinc-700 leading-snug">{event.institution_name}</div>
          ) : null}
          <div className="text-xl sm:text-2xl font-bold leading-tight">{event?.name || "Kejuaraan Pencak Silat"}</div>
          {placeDate ? <div className="text-xs text-zinc-700 mt-1">{placeDate}</div> : null}
        </div>
        <LogoSlot src={resolvePhotoUrl(event?.logo_url)} alt="Logo event" />
      </div>
      <div className="letterhead-rule" />
      {documentTitle ? (
        <div className="text-center text-xs tracking-[0.28em] uppercase font-semibold mt-2">{documentTitle}</div>
      ) : null}
    </header>
  );
}

export function printFileTitle(parts) {
  return fileTitle(parts);
}
