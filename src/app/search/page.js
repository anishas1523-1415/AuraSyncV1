"use client";
import styles from "./page.module.css";
import { MagnifyingGlass, Play, ClockCounterClockwise, X } from "@phosphor-icons/react/dist/ssr";
import { useState, useEffect, useRef } from "react";
import { useAudio } from "@/contexts/AudioContext";
import { useRouter } from "next/navigation";

const RECENT_KEY = "aurasynq_recent_searches";

const genres = [
  { name: "Pop", slug: "pop", gradient: "linear-gradient(135deg, #FF416C 0%, #FF4B2B 100%)", shadowColor: "rgba(255, 65, 108, 0.5)", image: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&q=80" },
  { name: "Hip-Hop", slug: "hiphop", gradient: "linear-gradient(135deg, #4776E6 0%, #8E54E9 100%)", shadowColor: "rgba(142, 84, 233, 0.5)", image: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=300&q=80" },
  { name: "Indie", slug: "indie", gradient: "linear-gradient(135deg, #FF8008 0%, #FFA081 100%)", shadowColor: "rgba(255, 128, 8, 0.5)", image: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80" },
  { name: "Chill", slug: "chill", gradient: "linear-gradient(135deg, #11998e 0%, #38ef7d 100%)", shadowColor: "rgba(56, 239, 125, 0.5)", image: "https://images.unsplash.com/photo-1458560871784-56d23406c091?w=300&q=80" },
  { name: "Electronic", slug: "electronic", gradient: "linear-gradient(135deg, #b224ef 0%, #7579ff 100%)", shadowColor: "rgba(178, 36, 239, 0.5)", image: "https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=300&q=80" },
  { name: "Rock", slug: "rock", gradient: "linear-gradient(135deg, #8A2387 0%, #E94057 50%, #F27121 100%)", shadowColor: "rgba(233, 64, 87, 0.5)", image: "https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=300&q=80" },
  { name: "Tamil", slug: "tamil", gradient: "linear-gradient(135deg, #f7971e 0%, #ffd200 100%)", shadowColor: "rgba(247, 151, 30, 0.5)", image: "https://images.unsplash.com/photo-1493225457124-a1a2a5f5f9af?w=300&q=80" },
  { name: "Sleep", slug: "sleep", gradient: "linear-gradient(135deg, #2C3E50 0%, #4CA1AF 100%)", shadowColor: "rgba(76, 161, 175, 0.5)", image: "https://images.unsplash.com/photo-1436891620584-47fd0e565afb?w=300&q=80" },
];

export default function Search() {
  const { playTrack } = useAudio();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_KEY);
      if (stored) setRecentSearches(JSON.parse(stored));
    } catch (e) {}
  }, []);

  const saveRecent = (q) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setRecentSearches(prev => {
      const filtered = prev.filter(s => s.toLowerCase() !== trimmed.toLowerCase());
      const updated = [trimmed, ...filtered].slice(0, 7);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(updated)); } catch (e) {}
      return updated;
    });
  };

  const removeRecent = (term) => {
    setRecentSearches(prev => {
      const updated = prev.filter(s => s !== term);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(updated)); } catch (e) {}
      return updated;
    });
  };

  const doSearch = async (searchQuery) => {
    const q = (searchQuery || query).trim();
    if (!q) return;
    setLoading(true);
    saveRecent(q);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.tracks) setResults(data.tracks);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") doSearch();
  };

  const handleGenreClick = (genre) => {
    router.push(`/category/${genre.slug}`);
  };

  const handleRecentClick = (term) => {
    setQuery(term);
    doSearch(term);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Search</h1>
        <div className={styles.searchBar}>
          <MagnifyingGlass size={20} className={styles.searchIcon} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Songs, artists, moods..."
            className={styles.searchInput}
            value={query}
            onChange={(e) => { setQuery(e.target.value); if (!e.target.value) setResults([]); }}
            onKeyDown={handleKeyDown}
          />
          {query && (
            <button className={styles.clearBtn} onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}>
              <X size={16} />
            </button>
          )}
        </div>
      </header>

      {loading && (
        <div className={styles.loadingBar}>
          <div className={styles.loadingFill} />
        </div>
      )}

      {results.length > 0 && (
        <section className={styles.section}>
          <h2>Search Results <span className={styles.count}>{results.length}</span></h2>
          <div className={styles.resultsList}>
            {results.map((track) => (
              <div key={track.id} className={styles.resultItem} onClick={() => playTrack(track, results)}>
                <img src={track.cover} alt={track.title} className={styles.resultCover} />
                <div className={styles.resultInfo}>
                  <h4>{track.title}</h4>
                  <p>{track.artist}</p>
                </div>
                <div className={styles.playIcon}><Play size={20} weight="fill" /></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {results.length === 0 && !loading && (
        <>
          {recentSearches.length > 0 && (
            <section className={styles.section}>
              <h2>Recent Searches</h2>
              <div className={styles.recentList}>
                {recentSearches.map((search, i) => (
                  <div key={i} className={`glass ${styles.recentItem}`} onClick={() => handleRecentClick(search)}>
                    <ClockCounterClockwise size={16} />
                    <span>{search}</span>
                    <button
                      className={styles.removeRecent}
                      onClick={(e) => { e.stopPropagation(); removeRecent(search); }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className={styles.section}>
            <h2>Browse All</h2>
            <div className={styles.grid}>
              {genres.map(genre => (
                <div
                  key={genre.name}
                  className={styles.genreCard}
                  style={{ background: genre.gradient, "--shadow-color": genre.shadowColor }}
                  onClick={() => handleGenreClick(genre)}
                >
                  <h3>{genre.name}</h3>
                  <img src={genre.image} alt={genre.name} className={styles.genreImg} />
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
