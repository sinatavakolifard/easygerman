import { Link, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = async (e) => {
    e.preventDefault();
    await logout();
    navigate("/login");
  };

  return (
    <>
      <header className="topbar">
        <Link to={user ? "/" : "/login"} className="brand">
          easy-german
        </Link>
        <nav className="topbar-nav">
          {user ? (
            <>
              <Link to="/library">Library</Link>
              <span className="topbar-email">{user.email}</span>
              <form className="logout-form" onSubmit={onLogout}>
                <button type="submit" className="link-button">
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link to="/login">Log in</Link>
              <Link to="/signup" className="topbar-cta">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
