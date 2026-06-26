import React, { useRef, useState } from "react";
import api, { BACKEND_URL, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Image as ImageIcon, X } from "lucide-react";
import { toast } from "sonner";

/**
 * Resolve a photo_url to an absolute URL. If it starts with `/api/`, prepend BACKEND_URL.
 */
export function resolvePhotoUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/api/")) return `${BACKEND_URL}${url}`;
  return url;
}

/**
 * PhotoUpload — combined file uploader + URL input.
 * - On file select: uploads to /api/uploads/photo, sets value to returned URL (e.g. /api/uploads/xxx.png)
 * - User can also paste an external URL manually.
 * Props: value (string), onChange (fn), label, testIdPrefix
 */
export default function PhotoUpload({ value, onChange, label = "Foto", testIdPrefix = "photo" }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await api.post("/uploads/photo", fd, { headers: { "Content-Type": "multipart/form-data" } });
      onChange(r.data.url);
      toast.success("Foto diunggah");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const preview = resolvePhotoUrl(value);

  return (
    <div>
      <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">{label}</div>
      <div className="mt-1 flex items-start gap-3">
        <div className="w-20 h-20 rounded-sm border border-white/10 bg-[#0a0a0a] flex items-center justify-center overflow-hidden shrink-0" data-testid={`${testIdPrefix}-preview`}>
          {preview ? (
            <img src={preview} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          ) : (
            <ImageIcon className="w-7 h-7 text-zinc-700" />
          )}
        </div>
        <div className="flex-1 space-y-2">
          <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" data-testid={`${testIdPrefix}-file-input`} />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm text-xs"
              data-testid={`${testIdPrefix}-upload-btn`}
            >
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              {busy ? "Mengunggah..." : "Unggah"}
            </Button>
            {value && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onChange("")}
                className="text-zinc-400 hover:text-[#ff3b30] hover:bg-white/5 rounded-sm text-xs"
                data-testid={`${testIdPrefix}-clear-btn`}
              >
                <X className="w-3.5 h-3.5 mr-1" /> Hapus
              </Button>
            )}
          </div>
          <Input
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder="atau tempel URL: https://..."
            className="bg-[#0a0a0a] border-white/10 text-xs"
            data-testid={`${testIdPrefix}-url-input`}
          />
        </div>
      </div>
    </div>
  );
}
