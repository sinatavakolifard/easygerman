import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import IndexPage from "./pages/IndexPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import SignupPage from "./pages/SignupPage.jsx";
import LibraryPage from "./pages/LibraryPage.jsx";
import ExtractionPage from "./pages/ExtractionPage.jsx";
import SavedWordsPage from "./pages/SavedWordsPage.jsx";
import AdminPage from "./pages/AdminPage.jsx";
import { useAuth } from "./AuthContext.jsx";

function RequireAuth({ children }) {
  const { user } = useAuth();
  if (user === undefined) return null; // still loading /api/me
  if (user === null) return <Navigate to="/login" replace />;
  return children;
}

function RequireAdmin({ children }) {
  const { user } = useAuth();
  if (user === undefined) return null; // still loading /api/me
  if (user === null) return <Navigate to="/login" replace />;
  if (!user.is_admin) return <Navigate to="/" replace />;
  return children;
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
