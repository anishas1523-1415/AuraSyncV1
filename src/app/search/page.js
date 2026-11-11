"use client";
import styles from "./page.module.css";
import { MagnifyingGlass, Play, ClockCounterClockwise, X, Plus, User, Sparkle, Microphone } from "@phosphor-icons/react";
import { useState, useEffect, useRef } from "react";
import { useAudio } from "@/contexts/AudioContext";
import { useRouter } from "next/navigation";
import AddToPlaylistModal from "@/components/AddToPlaylistModal";
import { toast } from "@/lib/toast";
import { searchSongs, suggestQueries, localSuggestions, searchMoments, relatedSongs } from "@/lib/catalog";
import { voiceAvailable } from "@/lib/voice";
import { Capacitor } from "@capacitor/core";
import ListenOverlay from "@/components/ListenOverlay";

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
  const { playTrack, currentTrack } = useAudio();
  const [canListen, setCanListen] = useState(false);
  const [listenOpen, setListenOpen] = useState(false);
  // Song (hum) search needs songs cached on the device, which only the Android app does
  const [canHum, setCanHum] = useState(false);
  useEffect(() => {
    voiceAvailable().then(setCanListen).catch(() => setCanListen(false));
    setCanHum(Capacitor.isNativePlatform());
  }, []);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeModalTrack, setActiveModalTrack] = useState(null);
  const [recentSearches, setRecentSearches] = useState([]);
  const inputRef = useRef(null);
  const lastSearchedRef = useRef("");
  const requestIdRef = useRef(0);
  const [suggestions, setSuggestions] = useState([]);
  const [focused, setFocused] = useState(false);
  const [moments, setMoments] = useState([]);
  useEffect(() => { setMoments(searchMoments()); }, []);

  // Autocomplete while typing: the listener's own recents/artists instantly, then YouTube Music's
  useEffect(() => {
    const text = query.trim();
    if (!text) { setSuggestions([]); return; }
    setSuggestions(localSuggestions(text));
    let cancelled = false;
    const timer = setTimeout(() => {
      suggestQueries(text).then((remote) => {
        if (cancelled) return;
        const local = localSuggestions(text);
        const seen = new Set(local.map((s) => s.text.toLowerCase()));
        setSuggestions([...local, ...remote.filter((r) => !seen.has(r.toLowerCase()) && r.toLowerCase() !== text.toLowerCase()).map((r) => ({ text: r, kind: "suggest" }))].slice(0, 7));
      });
    }, 160);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

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

  // Shared by typing and Enter; only the newest request may update results (typing fast used
  // to let a slow, older response overwrite the latest one)
  const runSearch = async (q, { spoken = "" } = {}) => {
    const requestId = ++requestIdRef.current;
    lastSearchedRef.current = q;
    setLoading(true);
    try {
      const tracks = await searchSongs(q, { spoken });
      if (requestId === requestIdRef.current) setResults(tracks);
      return requestId === requestIdRef.current ? tracks : null;
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      if (err.rateLimited) toast("Searching too fast — take a breath and try again", { variant: "error" });
      else console.error(err);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  const doSearch = (searchQuery) => {
    const q = (searchQuery || query).trim();
    if (!q) return;
    saveRecent(q);
    runSearch(q);
  };

  // Debounced typing search
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      requestIdRef.current++;
      lastSearchedRef.current = "";
      setResults([]);
      setLoading(false);
      return;
    }

    if (trimmed === lastSearchedRef.current) {
      return;
    }

    const timer = setTimeout(() => runSearch(trimmed), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const handleKeyDown = (e) => {
    if (e.key !== "Enter") return;
    // Hidden way into Hum Lab, the hum-recording tool (it has no link in the app's screens)
    if (query.trim().toLowerCase() === "humlab") {
      router.push("/humlab");
      return;
    }
    doSearch();
  };

  // A hummed tune's matches go straight into the results list (best guesses when not sure)
  const handleSongResults = (tracks, { guess = false } = {}) => {
    setListenOpen(false);
    const label = guess ? "Hummed tune · best guesses" : "Hummed tune";
    lastSearchedRef.current = label; // a label, not a search: the typing search must skip it
    requestIdRef.current++;
    setQuery(label);
    setResults(tracks);
  };

  // A spoken request runs through the same search as typing (ir/voice.js turns "play ...",
  // "find that ... song", "something similar to this" into an action and search words)
  const handleVoiceCommand = async (command) => {
    setListenOpen(false);
    try {
      if (command.action === "similar") {
        if (!currentTrack) {
          toast("Play a song first, then ask for similar ones");
          return;
        }
        const label = `Songs like ${currentTrack.title}`;
        lastSearchedRef.current = label; // a label, not a search: the typing search must skip it
        requestIdRef.current++;
        setQuery(label);
        setLoading(true);
        setResults(await relatedSongs(currentTrack));
        setLoading(false);
        return;
      }
      if (!command.query) return;
      setQuery(command.query);
      saveRecent(command.query);
      // The parsed words AND the whole sentence (searched as is, like YouTube's voice search)
      const tracks = await runSearch(command.query, { spoken: command.transcript });
      if (command.action === "play" && tracks?.[0]) playTrack(tracks[0], [tracks[0]]);
      if (command.action === "playlist") toast("Here are songs for your playlist. Tap + to add them");
    } catch (err) {
      toast(err?.message || "Voice search failed", { variant: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleGenreClick = (genre) => {
    router.push(`/category/${genre.slug}`);
  };

  const handleRecentClick = (term) => {
    setQuery(term);
    doSearch(term);
  };

  const handlePlayTrack = (track, trackList) => {
    if (query) {
      saveRecent(query);
    }
    // Only the chosen song: when it ends, Aura Radio queues songs related to it (same mood,
    // artists, language), not other results that merely share words with the search
    playTrack(track, [track]);
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
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
          />
          {query && (
            <button className={styles.clearBtn} onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}>
              <X size={16} />
            </button>
          )}
          {!query && canListen && (
            <button
              className={`${styles.micBtn} ${listenOpen ? styles.micBtnActive : ""}`}
              onClick={() => setListenOpen(true)}
              aria-label="Search by voice or song"
              title="Search by voice or humming"
            >
              <Microphone size={20} weight={listenOpen ? "fill" : "regular"} />
            </button>
          )}
        </div>
      </header>

      {focused && suggestions.length > 0 && (
        <div className={`glass ${styles.suggestions}`}>
          {suggestions.map((s) => (
            <div
              key={`${s.kind}-${s.text}`}
              className={styles.suggestion}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setQuery(s.text); setFocused(false); inputRef.current?.blur(); doSearch(s.text); }}
            >
              {s.kind === "recent" ? <ClockCounterClockwise size={16} /> : s.kind === "artist" ? <User size={16} /> : <MagnifyingGlass size={16} />}
              <span>{s.text}</span>
            </div>
          ))}
        </div>
      )}

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
              <div key={track.id} className={styles.resultItem} onClick={() => handlePlayTrack(track, results)}>
                <img src={track.cover} alt={track.title} className={styles.resultCover} />
                <div className={styles.resultInfo}>
                  <h4>{track.title?.split("|")[0].split("(")[0].trim()}</h4>
                  <p>{track.artist}</p>
                </div>
                
                <div className={styles.resultActions}>
                  <button
                    className={styles.addBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveModalTrack(track);
                    }}
                    title="Add to Playlist"
                  >
                    <Plus size={18} />
                  </button>
                  <div className={styles.playIcon}><Play size={20} weight="fill" /></div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {results.length === 0 && !loading && (
        <>
          {moments.length > 0 && (
            <section className={styles.section}>
              <h2><Sparkle size={16} weight="fill" style={{ verticalAlign: "-2px", marginRight: 6 }} />For this moment</h2>
              <div className={styles.chips}>
                {moments.map((m) => (
                  <button key={m.query} className={styles.momentChip} onClick={() => { setQuery(m.query); doSearch(m.query); }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </section>
          )}

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

      {activeModalTrack && (
        <AddToPlaylistModal
          track={activeModalTrack}
          onClose={() => setActiveModalTrack(null)}
        />
      )}

      <ListenOverlay
        open={listenOpen}
        canHum={canHum}
        onClose={() => setListenOpen(false)}
        onVoiceCommand={handleVoiceCommand}
        onSongResults={handleSongResults}
      />
    </div>
  );
}
