import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout, MarketingLayout } from "@/components/Layouts";

const Landing = lazy(() => import("@/pages/Landing"));
const Proof = lazy(() => import("@/pages/Proof"));
const Docs = lazy(() => import("@/pages/Docs"));
const Recover = lazy(() => import("@/pages/Recover"));
const Overview = lazy(() => import("@/pages/Overview"));
const Deposit = lazy(() => import("@/pages/Deposit"));
const UseApi = lazy(() => import("@/pages/UseApi"));
const Activity = lazy(() => import("@/pages/Activity"));
const Provider = lazy(() => import("@/pages/Provider"));

export default function App() {
  return (
    <Suspense fallback={<div className="grid min-h-dvh place-items-center text-sm text-faint" role="status">Loading…</div>}>
      <Routes>
        <Route element={<MarketingLayout />}>
          <Route index element={<Landing />} />
          <Route path="proof" element={<Proof />} />
          <Route path="docs" element={<Docs />} />
          <Route path="recover" element={<Recover />} />
        </Route>
        <Route path="app" element={<AppLayout />}>
          <Route index element={<Overview />} />
          <Route path="deposit" element={<Deposit />} />
          <Route path="use" element={<UseApi />} />
          <Route path="activity" element={<Activity />} />
          <Route path="recover" element={<Recover />} />
          <Route path="provider" element={<Provider />} />
        </Route>
        <Route path="provider" element={<Navigate to="/app/provider" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
