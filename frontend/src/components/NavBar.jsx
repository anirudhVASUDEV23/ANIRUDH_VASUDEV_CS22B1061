import { NavLink } from "react-router-dom";

const links = [
  { to: "/", label: "Live Dashboard" },
  { to: "/analytics", label: "Analytics Lab" },
  { to: "/backtest", label: "Backtester" },
  { to: "/data", label: "Data & Alerts" },
];

const NavBar = () => {
  return (
    <header className="navbar">
      <span className="navbar__brand">Market Intelligence</span>
      <nav className="navbar__links">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === "/"}
            className={({ isActive }) =>
              `navbar__link ${isActive ? "navbar__link--active" : ""}`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
};

export default NavBar;
