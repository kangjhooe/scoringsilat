import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Login from "@/pages/Login";
import AdminDashboard from "@/pages/AdminDashboard";
import OperatorDashboard from "@/pages/OperatorDashboard";
import MatchControl from "@/pages/MatchControl";
import Dashboard from "@/pages/Dashboard";
import MatchReport from "@/pages/MatchReport";
import PublicRegister from "@/pages/PublicRegister";
import RegistrationsAdmin from "@/pages/RegistrationsAdmin";
import WAHASettings from "@/pages/WAHASettings";
import { BracketsList, BracketView } from "@/pages/Brackets";
import SeniScoring from "@/pages/SeniScoring";
import { PublicSelector, PublicArenaDisplay, PublicMatchDisplay } from "@/pages/PublicDisplay";
import { EventHome, EventLandingPage } from "@/pages/EventLanding";
import "@/App.css";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public event landing pages */}
          <Route path="/" element={<EventHome />} />
          <Route path="/event/:slug" element={<EventLandingPage />} />
          <Route path="/event/:slug/register" element={<PublicRegister />} />
          <Route path="/event/:slug/check" element={<PublicRegister />} />

          {/* Public display (no auth) */}
          <Route path="/display" element={<PublicSelector />} />
          <Route path="/display/arena/:arenaId" element={<PublicArenaDisplay />} />
          <Route path="/display/match/:matchId" element={<PublicMatchDisplay />} />

          {/* Public registration (no auth) */}
          <Route path="/register" element={<PublicRegister />} />

          {/* Public bracket view (no auth) */}
          <Route path="/bracket/:bid/public" element={<BracketView publicMode={true} />} />

          {/* Auth */}
          <Route path="/login" element={<Login />} />

          {/* Protected */}
          <Route path="/admin" element={<ProtectedRoute roles={["admin"]}><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/registrations" element={<ProtectedRoute roles={["admin", "operator"]}><RegistrationsAdmin /></ProtectedRoute>} />
          <Route path="/admin/whatsapp" element={<ProtectedRoute roles={["admin"]}><WAHASettings /></ProtectedRoute>} />
          <Route path="/operator" element={<ProtectedRoute roles={["admin", "operator"]}><OperatorDashboard /></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/match/:matchId" element={<ProtectedRoute><MatchControl /></ProtectedRoute>} />
          <Route path="/seni/:mid" element={<ProtectedRoute><SeniScoring /></ProtectedRoute>} />
          <Route path="/brackets" element={<ProtectedRoute roles={["admin", "operator"]}><BracketsList /></ProtectedRoute>} />
          <Route path="/brackets/:bid" element={<ProtectedRoute roles={["admin", "operator"]}><BracketView /></ProtectedRoute>} />
          <Route path="/report/:matchId" element={<ProtectedRoute><MatchReport /></ProtectedRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
