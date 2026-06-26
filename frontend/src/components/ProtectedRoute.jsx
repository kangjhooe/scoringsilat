import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles && !roles.includes(user.role) && user.role !== "admin") {
    return <Navigate to="/" replace />;
  }
  return children;
}

export function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
      <div className="text-zinc-400 text-sm tracking-[0.3em] uppercase">Memuat...</div>
    </div>
  );
}
