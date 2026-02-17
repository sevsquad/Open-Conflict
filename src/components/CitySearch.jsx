import { useState, useRef, useEffect, useCallback } from "react";
import { colors, typography, radius, shadows, animation, space } from "../theme.js";

// Lazy-loaded city data — imported once, stays in module scope
let _cities = null;
function getCities() {
  if (!_cities) {
    _cities = import("../data/cities.json").then(m => m.default || m);
  }
  return _cities;
}

// Format population for display: 13960000 -> "14.0M", 450000 -> "450K"
function fmtPop(p) {
  if (p >= 1e6) return (p / 1e6).toFixed(1) + "M";
  if (p >= 1e3) return Math.round(p / 1e3) + "K";
  return String(p);
}

// Search: prefix match first (score 2), then substring (score 1), sorted by score then population
function searchCities(query, cities, limit = 8) {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];
  const results = [];
  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    const name = city.n.toLowerCase();
    if (name.startsWith(q)) {
      results.push({ ...city, _score: 2 });
    } else if (name.includes(q)) {
      results.push({ ...city, _score: 1 });
    }
  }
  // Sort: prefix matches first, then by population descending
  results.sort((a, b) => b._score - a._score || b.p - a.p);
  return results.slice(0, limit);
}

/**
 * City search autocomplete. Searches a bundled dataset of world cities.
 * @param {Object} props
 * @param {Function} props.onSelect - Called with (lat, lng, cityName) when a city is chosen
 * @param {Object} [props.inputStyle] - Style object matching Parser's iS pattern
 */
export default function CitySearch({ onSelect, inputStyle }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [cities, setCities] = useState(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // Load city data on mount
  useEffect(() => {
    getCities().then(setCities);
  }, []);

  // Update results when query changes
  useEffect(() => {
    if (!cities || query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    const r = searchCities(query, cities);
    setResults(r);
    setOpen(r.length > 0);
    setHighlight(-1);
  }, [query, cities]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = useCallback((city) => {
    onSelect(city.lat, city.lng, city.n);
    setQuery("");
    setResults([]);
    setOpen(false);
    inputRef.current?.blur();
  }, [onSelect]);

  const handleKeyDown = useCallback((e) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(h => (h + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(h => (h <= 0 ? results.length - 1 : h - 1));
    } else if (e.key === "Enter" && highlight >= 0) {
      e.preventDefault();
      handleSelect(results[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlight(-1);
    }
  }, [open, results, highlight, handleSelect]);

  // Default input style matching Parser's iS pattern
  const baseInputStyle = inputStyle || {
    width: "100%", padding: "5px 8px", borderRadius: radius.md,
    border: `1px solid ${colors.border.default}`, background: colors.bg.raised,
    color: colors.text.primary, fontSize: typography.body.md,
    fontFamily: typography.fontFamily, outline: "none",
    transition: `border-color ${animation.fast}`, boxSizing: "border-box",
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", marginBottom: space[2] }}>
      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search cities..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onKeyDown={handleKeyDown}
          style={{
            ...baseInputStyle,
            paddingRight: query ? 28 : 8,
          }}
        />
        {query && (
          <span
            onClick={() => { setQuery(""); setResults([]); setOpen(false); inputRef.current?.focus(); }}
            style={{
              position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
              cursor: "pointer", color: colors.text.muted, fontSize: 14, lineHeight: 1,
              userSelect: "none",
            }}
          >
            &times;
          </span>
        )}
      </div>

      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
          marginTop: 2, background: colors.bg.raised,
          border: `1px solid ${colors.border.default}`,
          borderRadius: radius.md, boxShadow: shadows.lg,
          maxHeight: 280, overflowY: "auto",
        }}>
          {results.map((city, i) => (
            <div
              key={`${city.n}-${city.c}-${city.lat}`}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(city); }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                padding: `${space[1] + 1}px ${space[2]}px`,
                cursor: "pointer",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                background: i === highlight ? colors.bg.surface : "transparent",
                borderBottom: i < results.length - 1 ? `1px solid ${colors.border.subtle}` : "none",
                transition: `background ${animation.fast}`,
              }}
            >
              <span style={{ fontSize: typography.body.sm, color: colors.text.primary }}>
                {city.n}<span style={{ color: colors.text.muted, marginLeft: space[1] }}>{city.c}</span>
              </span>
              <span style={{
                fontSize: typography.body.xs, color: colors.text.muted,
                fontFamily: typography.monoFamily, whiteSpace: "nowrap", marginLeft: space[2],
              }}>
                {fmtPop(city.p)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
