import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import { useConfirm, usePrompt } from "../components/ConfirmProvider";
import Toast from "../components/Toast";
import type { AdminUser, ApiError } from "../types";

export default function AdminPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    api
      .adminUsers()
      .then((d) => setUsers(d.users))
      .catch((e: ApiError) => setError(e.message || "Failed to load users"));
  }, []);

  const onDelete = async (u: AdminUser) => {
    const ok = await confirm({
      title: "Delete user",
      message:
        `Delete ${u.email}? This removes their ${u.extraction_count} extraction(s), ` +
        `saved words, and audio files. This can't be undone.`,
      confirmLabel: "Delete user",
      danger: true,
    });
    if (!ok) return;
    setBusyId(u.id);
    setError(null);
    try {
      await api.adminDeleteUser(u.id);
      setUsers((rows) => (rows ?? []).filter((r) => r.id !== u.id));
    } catch (e) {
      setError((e as ApiError).message || "Failed to delete user");
    } finally {
      setBusyId(null);
    }
  };

  const onToggleAdmin = async (u: AdminUser) => {
    const next = !u.is_admin;
    const ok = await confirm({
      title: next ? "Promote to admin" : "Demote from admin",
      message: `${next ? "Promote" : "Demote"} ${u.email} ${next ? "to" : "from"} admin?`,
      confirmLabel: next ? "Promote" : "Demote",
    });
    if (!ok) return;
    setBusyId(u.id);
    setError(null);
    try {
      await api.adminSetAdmin(u.id, next);
      setUsers((rows) =>
        (rows ?? []).map((r) => (r.id === u.id ? { ...r, is_admin: next } : r))
      );
    } catch (e) {
      setError((e as ApiError).message || "Failed to update admin status");
    } finally {
      setBusyId(null);
    }
  };

  const onResetPassword = async (u: AdminUser) => {
    const pw = await prompt({
      title: "Reset password",
      message: `Set a new password for ${u.email}.`,
      label: "New password",
      inputType: "password",
      confirmLabel: "Set password",
      validate: (v) =>
        v.length < 8 ? "Password must be at least 8 characters." : null,
    });
    if (pw == null) return; // cancelled
    setBusyId(u.id);
    setError(null);
    try {
      await api.adminResetPassword(u.id, pw);
      setNotice(`Password updated for ${u.email}.`);
    } catch (e) {
      setError((e as ApiError).message || "Failed to reset password");
    } finally {
      setBusyId(null);
    }
  };

  if (error && users === null) return <p className="form-error">{error}</p>;
  if (users === null) return <p>Loading…</p>;

  return (
    <>
      <h1>Admin · users</h1>
      <p className="lede">
        {users.length} account{users.length === 1 ? "" : "s"}.
      </p>
      {error && <p className="form-error">{error}</p>}

      <div className="admin-table-wrap">
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
              const self = u.id === user?.id;
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
                        className="admin-btn"
                        onClick={() => onResetPassword(u)}
                        disabled={busy}
                      >
                        Reset password
                      </button>
                      <button
                        type="button"
                        className="admin-btn"
                        onClick={() => onToggleAdmin(u)}
                        disabled={busy || self}
                        title={self ? "You can't change your own role" : ""}
                      >
                        {u.is_admin ? "Demote" : "Promote"}
                      </button>
                      <button
                        type="button"
                        className="admin-btn admin-btn--danger"
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
      </div>
      <Toast message={notice} type="success" onClose={() => setNotice(null)} />
    </>
  );
}
