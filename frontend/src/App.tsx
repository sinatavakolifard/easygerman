import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import Layout from "./components/Layout";
import IndexPage from "./pages/IndexPage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import LibraryPage from "./pages/LibraryPage";
import ExtractionPage from "./pages/ExtractionPage";
import SavedWordsPage from "./pages/SavedWordsPage";
import AdminPage from "./pages/AdminPage";
import { useAuth } from "./AuthContext";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user === undefined) return null; // still loading /api/me
  if (user === null) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user === undefined) return null; // still loading /api/me
  if (user === null) return <Navigate to="/login" replace />;
  if (!user.is_admin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<IndexPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />
        <Route
          path="library"
          element={
            <RequireAuth>
              <LibraryPage />
            </RequireAuth>
          }
        />
        <Route
          path="extraction/:id"
          element={
            <RequireAuth>
              <ExtractionPage />
            </RequireAuth>
          }
        />
        <Route
          path="saved"
          element={
            <RequireAuth>
              <SavedWordsPage />
            </RequireAuth>
          }
        />
        <Route
          path="admin"
          element={
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
