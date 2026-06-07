import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";

export default function AdminPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    api
      .adminUsers()
      .then((d) => setUsers(d.users))
      .catch((e) => setError(e.message || "Failed to load users"));
  }, []);

  const onDelete = async (u) => {
    if (
      !window.confirm(
        `Delete ${u.email}? This removes their ${u.extraction_count} extraction(s), ` +
          `saved words, and audio files. This can't be undone.`
      )
    ) {
      return;
    }
    setBusyId(u.id);
    setError(null);
    try {
      await api.adminDeleteUser(u.id);
      setUsers((rows) => rows.filter((r) => r.id !== u.id));
    } catch (e) {
      setError(e.message || "Failed to delete user");
    } finally {
      setBusyId(null);
    }
  };

  const onToggleAdmin = async (u) => {
    const next = !u.is_admin;
    if (
      !window.confirm(
        `${next ? "Promote" : "Demote"} ${u.email} ${next ? "to" : "from"} admin?`
      )
    ) {
      return;
    }
    setBusyId(u.id);
    setError(null);
    try {
      await api.adminSetAdmin(u.id, next);
      setUsers((rows) =>
        rows.map((r) => (r.id === u.id ? { ...r, is_admin: next } : r))
      );
    } catch (e) {
      setError(e.message || "Failed to update admin status");
    } finally {
      setBusyId(null);
    }
  };

  const onResetPassword = async (u) => {
    const pw = window.prompt(`New password for ${u.email} (min 8 characters):`);
    if (pw == null) return; // cancelled
    if (pw.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusyId(u.id);
    setError(null);
    try {
      await api.adminResetPassword(u.id, pw);
      window.alert(`Password updated for ${u.email}.`);
    } catch (e) {
      setError(e.message || "Failed to reset password");
    } finally {
      setBusyId(null);
    }
  };

  if (error && users === null) return <p className="form-error">{error}</p>;
  if (users === null) return <p>Loading…</p>;

  return (
    <>
      <h1>Admin · users</h1>
      <p className="lede">{users.length} account{users.length === 1 ? "" : "s"}.</p>
      {error && <p className="form-error">{error}</p>}

      <table className="admin-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Email</th>
            <th>Joined</th>
            <th>Extractions</th>
            <th>Saved</th>
            <th>Role</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const self = u.id === user.id;
            const busy = busyId === u.id;
            return (
              <tr key={u.id}>
                <td data-label="ID">{u.id}</td>
                <td data-label="Email">
                  {u.email}
                  {self && <span className="admin-self"> (you)</span>}
                </td>
                <td data-label="Joined">{u.created_at}</td>
                <td data-label="Extractions">{u.extraction_count}</td>
                <td data-label="Saved">{u.saved_count}</td>
                <td data-label="Role">{u.is_admin ? "admin" : "user"}</td>
                <td data-label="Actions">
                  <div className="admin-actions">
                    <button
                      type="button"
                      onClick={() => onResetPassword(u)}
                      disabled={busy}
                    >
                      Reset password
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleAdmin(u)}
                      disabled={busy || self}
                      title={self ? "You can't change your own role" : ""}
                    >
                      {u.is_admin ? "Demote" : "Promote"}
                    </button>
                    <button
                      type="button"
                      className="extraction-delete"
                      onClick={() => onDelete(u)}
                      disabled={busy || self || u.is_admin}
                      title={
                        u.is_admin
                          ? "Demote before deleting"
                          : self
                          ? "You can't delete yourself"
                          : ""
                      }
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
