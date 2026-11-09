// Song classification: language and mood, with a multinomial Naive Bayes over the words of a
// song's title, film and artists (Lidstone smoothing, alpha 0.1: with seed lexicons this small,
// add-one smoothing drowns the evidence; words never seen in training are ignored).
// The training "documents" are small seed lexicons; artists act as strong language evidence.
import { tokenize, normalize, parseTitle } from "./text.js";
import { identifyLanguage, learnArtistLanguage } from "./language.js";

const LANGUAGE_SEEDS = {
  tamil: `kadhal kaadhal kadhale nenjam nenje uyire uyir kanne kannamma penne ponnu poove vaa va
    en un nee naan enna ennai unnai unakku enakku idhu adi di da machi machan thalaivar kuthu
    nila nilave kaatru mazhai vizhi vizhigal kangal pattu paattu raja rani amma appa thambi
    anbe anbu azhagu azhage mella kadhali kaathalae pogum varum vandha vanthu ponaal ondru
    kannu kanavu kanave vaanam veetu oorum thendral sollu solla sonna paathu paarvai
    anirudh ravichander ilaiyaraaja ilayaraja yuvan shankar raja harris jayaraj gv prakash d imman
    santhosh narayanan hiphop tamizha sai abhyankkar dhanush vijay sean roldan deva vidyasagar
    spb balasubrahmanyam chinmayi pradeep kumar haricharan karthik vijay yesudas dhee
    kollywood thalapathy rajini ajith suriya kanneer thuli sid sriram chithra vairamuthu
    na muthukumar thamarai madhan karky vivek rahman hariharan unni menon sujatha srinivas
    bombay jayashree shankar mahadevan mano swarnalatha janaki naresh iyer harini devan tippu
    vijay antony ghibran leon james jakes bejoy sanjith hegde andrea jeremiah rojave rojaa`,
  hindi: `dil tum mera meri tera teri pyaar pyar ishq hai hain ke ki ka se mein main yaar jaana
    jaane sanam zindagi aankhein rang kya kyun hum humko tujhe mujhe tujh mujh saath raat baat
    dard mohabbat sajna sajni chaand ishqa piya jiya jiya raha rahe kahin kabhi naina
    arijit singh pritam atif aslam neha kakkar badshah jubin nautiyal kk sonu nigam vishal mishra
    amitabh bhattacharya sachin jigar shankar ehsaan loy kumar sanu lata mangeshkar kishore
    bollywood`,
  telugu: `prema nuvvu nenu naa nee ra ammaye manasu vachindi chilaka bava kanulu andam oohalu
    neeve nannu ninnu cheppu ninne nuvve gundello guvva sita ramaa
    devi sri prasad dsp thaman ss thaman keeravani mm keeravani anurag kulkarni ram miriyala
    sid sriram mangli tollywood pushpa allu arjun mahesh babu`,
  malayalam: `ente ninte pranayam mazha kaattu ponne ninne njan nee manassil omane chirakil
    vineeth sreenivasan sushin shyam hesham abdul wahab ks chithra shaan rahman`,
  kannada: `ninna nanna preethi hudugi baare nanu ninage
    arjun janya v harikrishna vijay prakash`,
  punjabi: `jatt kudi munda tere gal vich soniye yaara mainu tainu
    diljit dosanjh ap dhillon karan aujla sidhu moose wala guru randhawa`,
  english: `the you me my love baby girl night heart i your we dance feel want know never
    ed sheeran taylor swift the weeknd imagine dragons dua lipa justin bieber coldplay
    eminem drake billie eilish bruno mars maroon charlie puth shawn mendes`,
};

const MOOD_SEEDS = {
  romantic: `love kadhal kaadhal kadhale pyaar pyar ishq mohabbat dil uyire nenjam kanne anbe
    anbu sanam jaana prema manasu pranayam romantic melody heart baby kiss forever`,
  sad: `sad cry tears broken alone lonely pain dard judaai tanha sogam kanneer heartbreak
    goodbye miss lost hurt sorrow vali valiye pirivu`,
  party: `kuthu mass dance party club naach dappankuthu thara local beat dj boom anthem
    celebration jalsa`,
  energetic: `phonk power fire rage beast workout gym fight rap hip hop rock attack warrior
    thalaivar hukum intro theme bgm aggressive`,
  chill: `lofi chill slowed reverb relax vibe sunset coffee rain mazhai`,
  calm: `sleep calm peace peaceful lullaby flute piano instrumental meditation ambient`,
  devotional: `amma murugan shiva krishna ganesha ayyappa bhajan aarti devotional god lord
    jesus allah hanuman rama sai baba`,
  happy: `happy smile sunshine joy fun good feel celebrate friendship nanba nanban yaaro`,
};

function train(seeds) {
  const counts = {};
  const totals = {};
  const vocab = new Set();
  for (const [label, text] of Object.entries(seeds)) {
    counts[label] = {};
    totals[label] = 0;
    for (const token of tokenize(text)) {
      counts[label][token] = (counts[label][token] || 0) + 1;
      totals[label]++;
      vocab.add(token);
    }
  }
  return { counts, totals, vocab, labels: Object.keys(seeds) };
}

const languageModel = train(LANGUAGE_SEEDS);
const moodModel = train(MOOD_SEEDS);

// Returns { label, confidence } or { label: null } when no known word was seen
function naiveBayes(model, tokens) {
  const known = tokens.filter((t) => model.vocab.has(t));
  if (!known.length) return { label: null, confidence: 0, scores: {} };
  const V = model.vocab.size;
  const ALPHA = 0.1;
  const scores = {};
  for (const label of model.labels) {
    let logp = Math.log(1 / model.labels.length); // uniform prior
    for (const t of known) {
      logp += Math.log(((model.counts[label][t] || 0) + ALPHA) / (model.totals[label] + ALPHA * V));
    }
    scores[label] = logp;
  }
  // Softmax over log-probabilities for a confidence
  const max = Math.max(...Object.values(scores));
  const exp = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, Math.exp(v - max)]));
  const sum = Object.values(exp).reduce((a, b) => a + b, 0);
  const [label, best] = Object.entries(exp).sort((a, b) => b[1] - a[1])[0];
  return { label, confidence: best / sum, scores };
}

// Native scripts settle the language outright (rule-based extraction)
const SCRIPTS = [
  [/[஀-௿]/, "tamil"], [/[ऀ-ॿ]/, "hindi"], [/[ఀ-౿]/, "telugu"],
  [/[ഀ-ൿ]/, "malayalam"], [/[ಀ-೿]/, "kannada"], [/[਀-੿]/, "punjabi"],
];

const cache = new Map();

export function classifyTrack(track) {
  if (!track?.id && !track?.title) return { language: null, mood: null };
  const key = track.id || track.title;
  if (cache.has(key)) return cache.get(key);

  const text = `${track.title || ""} ${track.album || ""} ${track.artist || ""}`;
  const parsed = parseTitle(track.title);
  const script = SCRIPTS.find(([re]) => re.test(text));
  // One vote per word (initials like "K.S." carry no information)
  const tokens = [...new Set(tokenize(`${parsed.song} ${parsed.film} ${track.album || ""} ${track.artist || ""}`))]
    .filter((t) => t.length > 1);

  let language = parsed.language || (script && script[1]) || null;
  let confidence = language ? 1 : 0;
  if (!language) {
    // Words, word shapes and artist priors (see language.js)
    const guess = identifyLanguage({ song: parsed.song, film: parsed.film || track.album || "", artist: track.artist });
    language = guess.language;
    confidence = guess.confidence;
    if (language && guess.confidence >= 0.8) learnArtistLanguage(track.artist, language);
  } else {
    learnArtistLanguage(track.artist, language); // explicit marker or script: certain
  }
  const moodResult = naiveBayes(moodModel, tokenize(`${parsed.song} ${parsed.film}`));
  let mood = moodResult.label && moodResult.confidence >= 0.5 ? moodResult.label : null;
  if (!mood && parsed.variants.includes("lofi")) mood = "chill";
  if (!mood && parsed.variants.includes("slowed")) mood = "chill";

  const result = { language, mood, film: parsed.film || null, confidence };
  if (cache.size > 2000) cache.clear();
  cache.set(key, result);
  return result;
}

// Feature vector of a song for similarity and the listener profile (sparse map name -> weight)
export function trackFeatures(track) {
  const features = {};
  const { language, mood, film } = classifyTrack(track);
  const artists = String(track?.artist || "")
    .split(/,|&| x | feat\.? | ft\.? /i)
    .map((a) => normalize(a))
    .filter((a) => a && a !== "unknown artist" && a !== "various artists");
  artists.forEach((a, i) => { features[`artist:${a}`] = i === 0 ? 1 : 0.6; });
  if (language) features[`lang:${language}`] = 0.8;
  if (mood) features[`mood:${mood}`] = 0.7;
  if (film) features[`film:${normalize(film)}`] = 0.6;
  return features;
}

// ─── Neighbour vote (kNN over YouTube Music's co-listening lists) ───
// Songs in one radio/up-next list are listened to together and nearly always share a language.
// Songs whose own evidence is too weak take the list's majority language (if it is clear), and
// that also teaches their artists' language for next time.
export function classifyList(tracks) {
  const results = tracks.map((t) => classifyTrack(t));
  const counts = {};
  results.forEach((r) => { if (r.language) counts[r.language] = (counts[r.language] || 0) + 1; });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const [major, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [];
  if (!major || n / total < 0.6 || n < 3) return results;
  return results.map((r, i) => {
    // Keep confident answers; unknown or shaky ones (< 0.7) follow a clear neighbour majority
    if (r.language && (r.confidence ?? 1) >= 0.7) return r;
    if (r.language === major) return r;
    const filled = { ...r, language: major, byNeighbours: true };
    cache.set(tracks[i].id || tracks[i].title, filled);
    learnArtistLanguage(tracks[i].artist, major);
    return filled;
  });
}
