import React from "react";
import { Hand, Footprints, ArrowBigDownDash, Zap, User } from "lucide-react";
import { resolvePhotoUrl } from "@/components/PhotoUpload";

// Maps action codes (from scoring rule) to lucide icons
export const ACTION_ICON = {
  pukulan: Hand,
  tendangan: Footprints,
  jatuhan: ArrowBigDownDash,
};

export function ActionIcon({ code, className = "w-6 h-6", fallback = Zap }) {
  const Icon = ACTION_ICON[code] || fallback;
  return <Icon className={className} />;
}

// Friendly Indonesian label for action codes
export function actionLabel(code) {
  const m = {
    pukulan: "Pukulan",
    tendangan: "Tendangan",
    jatuhan: "Jatuhan",
  };
  return m[code] || code.replace(/_/g, " ");
}

// Returns initial(s) for avatar placeholder from full name
export function initialsOf(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * AthleteAvatar — renders athlete photo or initials placeholder.
 * Props:
 *   athlete: { name, photo_url, ... }
 *   corner:  "red" | "blue"
 *   size:    pixel size (default 96)
 *   className: extra classes
 */
export default function AthleteAvatar({ athlete, corner = "red", size = 96, className = "", fluid = false }) {
  const isRed = corner === "red";
  const ring = isRed ? "ring-[#ff3b30]/60" : "ring-[#007aff]/60";
  const bgFallback = isRed ? "bg-[#7f1d1d]" : "bg-[#1e3a8a]";
  const photo = resolvePhotoUrl(athlete?.photo_url);
  const initials = initialsOf(athlete?.name);

  const dims = fluid ? undefined : { width: size, height: size };
  const initialStyle = fluid ? undefined : { fontSize: Math.max(14, Math.floor(size * 0.4)) };

  if (photo) {
    return (
      <div
        style={dims}
        className={`shrink-0 rounded-full overflow-hidden ring-4 ${ring} bg-black/40 ${className}`}
      >
        <img
          src={photo}
          alt={athlete?.name || "atlet"}
          className="w-full h-full object-cover"
          onError={(e) => { e.currentTarget.style.display = "none"; e.currentTarget.parentElement.dataset.error = "1"; }}
        />
      </div>
    );
  }
  return (
    <div
      style={dims}
      className={`shrink-0 rounded-full overflow-hidden ring-4 ${ring} ${bgFallback} grid place-items-center text-white font-display tracking-tight ${className}`}
    >
      {initials.length > 0 ? (
        <span className={fluid ? "text-[clamp(1rem,3vh,2.5rem)] leading-none" : undefined} style={initialStyle}>{initials}</span>
      ) : (
        <User className={fluid ? "w-[45%] h-[45%]" : undefined} style={fluid ? undefined : { width: size * 0.5, height: size * 0.5 }} />
      )}
    </div>
  );
}
