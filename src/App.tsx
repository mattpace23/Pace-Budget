import { useEffect, useState } from "react";
import {
  Routes,
  Route,
  Navigate,
  useNavigate,
  NavLink,
} from "react-router-dom";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Budget from "./pages/Budget";
import UploadPage from "./pages/Upload";

type AuthState = "loading" | "authed" | "unauthed";

export default function App() {
  const [auth, setAuth] = useState<AuthState>("loading");

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => setAuth(r.ok ? "authed" : "unauthed"))
      .catch(() => setAuth("unauthed"));
  }, []);

  if (auth === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          auth === "authed" ? (
            <Navigate to="/" replace />
          ) : (
            <Login onSuccess={() => setAuth("authed")} />
          )
        }
      />
      <Route
        path="/*"
        element={
          auth === "authed" ? (
            <AuthedShell onLogout={() => setAuth("unauthed")} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
}

function AuthedShell({ onLogout }: { onLogout: () => void }) {
  const navigate = useNavigate();
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    onLogout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink/10 bg-paper">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold tracking-tight">Pace Budget</h1>
            <nav className="flex gap-1 text-sm">
              <NavTab to="/">Scoreboard</NavTab>
              <NavTab to="/budget">Budget</NavTab>
              <NavTab to="/upload">Upload</NavTab>
            </nav>
          </div>
          <button onClick={logout} className="text-sm text-muted hover:text-ink">
            Log out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/budget" element={<Budget />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function NavTab({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        [
          "rounded-md px-3 py-1.5 transition-colors",
          isActive
            ? "bg-ink text-paper"
            : "text-muted hover:bg-ink/5 hover:text-ink",
        ].join(" ")
      }
    >
      {children}
    </NavLink>
  );
}
