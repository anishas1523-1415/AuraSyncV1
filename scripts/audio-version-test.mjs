// Audio-version matching tests (run: node scripts/audio-version-test.mjs). Offline.
// Real chart videos (2026-11-12) and the YouTube Music audio tracks they should, or must not, map to.
import { isAudioMatch, sameSongName } from "../src/lib/musicTracks.js";

let failures = 0;
let total = 0;
const check = (name, ok) => { total += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures += 1; };
const v = (title, artist, duration, extra = {}) => ({ id: `v${total}${title.length}`, title, artist, duration, media: "video", ...extra });
const a = (title, artist, duration, album) => ({ id: `a${title.length}${duration}`, title, artist, duration, album, media: "audio" });

// Should match
check("Magale video (4:43, intro) -> Magale (From \"Baththa\") 4:18",
  isAudioMatch(v("Magale", "Sai Abhyankkar, Harini, Karthik Netha", 283, { album: "Baththa" }), a("Magale (From \"Baththa\")", "Sai Abhyankkar, Harini, Karthik Netha", 258)));
check("label-channel upload -> the film's audio (Kalyana Virundhu, Sony Music South)",
  isAudioMatch(v("Kalyana Virundhu", "Sony Music South", 250, { album: "Dorothy" }), a("Kalyana Virundhu (From \"Dorothy\")", "Ilaiyaraaja, Priya Jerson", 238)));
check("spelling variant Kanukulla -> Kannukulla", sameSongName("kanukulla", "kannukulla")
  && isAudioMatch(v("Kanukulla", "Sai Abhyankkar, Jonita Gandhi", 277), a("Kannukulla", "Sai Abhyankkar, Jonita Gandhi, Adesh Krishna", 274)));
check("a shortened video edit still gets the full song (Mutta Kalakki 2:20 -> 2:47)",
  isAudioMatch(v("Mutta Kalakki", "Ken Karunaas, G. V. Prakash Kumar", 140), a("Mutta Kalakki (From \"Youth\")", "G. V. Prakash Kumar, Ken Karunaas", 167)));
check("credited to a dancer, film confirmed by the video's tags (Thalapathy Kacheri)",
  isAudioMatch(v("Thalapathy Kacheri", "Jayanth Maadhur", 294), a("Thalapathy Kacheri", "Anirudh Ravichander, Thalapathy Vijay, Arivu", 198, "Jana Nayagan - Tamil"),
    { keywords: ["thalapathy kacheri song", "jana nayagan movie"], language: "tamil" }));
check("a slowed upload maps to the original song", isAudioMatch(v("Why This Kolaveri Di? (Perfectly Slowed)", "Anirudh Ravichander", 249), a("Why This Kolaveri Di? (The Soup of Love)", "Anirudh Ravichander, Dhanush", 260)));

// Must not match
check("not a different song by the same artist", !isAudioMatch(v("Magale", "Sai Abhyankkar", 283), a("Pavazha Malli (From \"Think Indie\")", "Sai Abhyankkar, Shruti Haasan", 253)));
check("not an unplugged / other version of the song", !isAudioMatch(v("Pavazha Malli", "Sai Abhyankkar, Shruti Haasan", 260), a("Pavazha Malli Unplugged (From \"Think Indie\")", "Sai Abhyankkar", 81)));
check("not the Hindi dub of a Tamil song", !isAudioMatch(v("Thalapathy Kacheri", "Jayanth Maadhur", 294), a("Thalapathy Kacheri", "Anirudh Ravichander, Nazeeruddin", 195, "Jan Neta - Hindi"),
  { keywords: ["jana nayagan movie"], language: "tamil" }));
check("not a same-named song with no shared singer or film", !isAudioMatch(v("Pattampoochi (feat. Suriya & Mamitha)", "Sublahshini, G. V. Prakash Kumar", 280), a("Pattampoochi (feat. Pragathi Guruprasad & M.Kowtham)", "Kadhalviruz", 382)));
check("not a much shorter part or promo", !isAudioMatch(v("Raathu Raasan", "Sai Abhyankkar", 300), a("Raathu Raasan", "Sai Abhyankkar", 60)));
check("short names need an exact match", !sameSongName("aathi", "aathu"));

console.log(failures ? `\n${failures} of ${total} failed` : `\nAll ${total} audio-version tests passed`);
process.exit(failures ? 1 : 0);
