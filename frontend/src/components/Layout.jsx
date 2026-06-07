import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

function NavItems({ user, onLogout }) {
  return user ? (
    <>
      <Link to="/library">Library</Link>
      <Link to="/saved">Saved</Link>
      {user.is_admin && <Link to="/admin">Admin</Link>}
      <span className="topbar-email">{user.email}</span>
      <form className="logout-form" onSubmit={onLogout}>
        <button type="submit" className="link-button">
          Log out
        </button>
      </form>
    </>
  ) : (
    <>
      <Link to="/login" className="topbar-secondary">
        Log in
      </Link>
      <Link to="/signup" className="topbar-cta">
        Sign up
      </Link>
    </>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Auto-close the mobile menu on navigation.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

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
        <div className="topbar-right">
          <ThemeToggle />
          <nav className="topbar-nav">
            <NavItems user={user} onLogout={onLogout} />
          </nav>
          <button
            type="button"
            className="hamburger"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={(e) => {
              setMenuOpen((o) => !o);
              e.currentTarget.blur();
            }}
          >
            {menuOpen ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
        </div>
      </header>
      <nav
        id="mobile-menu"
        className={`mobile-menu ${menuOpen ? "open" : ""}`}
        aria-hidden={!menuOpen}
      >
        <NavItems user={user} onLogout={onLogout} />
      </nav>
      <main>
        <Outlet />
      </main>
    </>
  );
}
