// Song language identification for romanised Indian-language and English titles.
// Three kinds of evidence, combined as log-probabilities (a Naive Bayes over all of them):
//   1. Title/film words found in per-language vocabularies (word-level multinomial NB)
//   2. Word shape for words not in any vocabulary: character-trigram NB trained on the same
//      vocabularies, so e.g. Telugu "-aaluga", Tamil "-kku"/"zh", Malayalam "-nnu" endings count
//   3. Artists as soft priors: single-language artists point firmly, multilingual composers and
//      singers (Anirudh, A.R. Rahman, Sid Sriram...) spread their weight, so the title can win
import { tokenize, normalize } from "./text.js";

export const LANGUAGES = ["tamil", "telugu", "hindi", "malayalam", "kannada", "punjabi", "bengali", "marathi", "english"];

const VOCAB = {
  tamil: `ennoda unnoda ennai unnai avan aval avanga ivan ival ithu enge inge ange eppo ippo
    appo eppadi ippadi appadi romba konjam nalla nallaa paaru paarungo vaanga ponga sollunga
    vandhutten vanthaen ponen poren varen varuven irukken irukku irundha illai illaye illama
    venum vendam aagum aachu achu theriyum theriyala puriyala puriyuthu thaan thaane dhaan
    mudiyala mudiyum kekkuthu ketkudhu odudhu aadudhu paadudhu thudikkudhu thudikkuthu
    nenjil nenjile kannil kannile manathil manadhil uyiril uyirile vizhiyil mozhi mozhiye
    maname manamae thaamarai thaamaraiye malar malare roja rojaa malligai mullai
    vaanavil sooriyan suriyan nilavu natchathiram kadal karai alai alaigal thuli thuligal
    kaatril mazhaiyil iravil pagalil kanavil ninaivil ninaivellam unnaal ennaal
    selladi selvame chellam chellame kutti kuttima ponmagal raasaa raasathi rasathi
    thaalattu thaalaattu kolusu kannadi jannal vaasal veedhi oor ooru gramam pattanam
    kalyanam kalyaanam thirumanam thaali sondham bandham uravu nanban nanbane thozha thozhi
    vettri vetri jeyikkum jeyichutta sema mass verithanam aattam paattam kondattam
    pongal thiruvizha deepavali pachai neelam sivappu manjal vellai karuppu
    kadhal kaadhal kadhale kaathal kaathalae nenjam nenje nenjukkul uyire uyir kanne kannamma kannu
    kanavu kanave penne ponnu poove poo vaa vaadi va en un nee naan naa enna ennai unnai unakku enakku
    idhu adhu adi di da machi machan thalaivar thalaiva kuthu nila nilave kaatru kaatre mazhai vizhi
    vizhigal kangal paattu pattu raja rani amma appa thambi anbe anbu azhagu azhage azhagiye mella
    kadhali pogum varum vandha vanthu ponaal ondru oru rendu thendral sollu solla sonna paathu paarvai
    vaanam vaaname veedu oorum yaar yaaro yen enakkul unakkul manasu manasula nenjukulle thottu
    thotta thottu kaadhalae kaathale mudhal kadaisi pudhu pudhiya vellai mazhaiye megam megame
    kanmani kannamma ponnu ponmaane paadum paadal pirandhaen piranthaen thaai thaaye maaman maama
    vaathi rowdy kolaveri kuruvi mavandaa raavana alappara jalabulajangu manasilaayo pathala
    otha oththa sontham sondham ammadi ammaadi aathi aatha marandhu maranthen ninaivu ninaivugal
    unnale ennale vandhaal vandhaai poga pona thedi thedum kaathirundhen iravu pagal kaalai maalai
    vaa vaa singari sundari ponnu kili kiliye mayil kuyil kuyile thangam thanga velli vettai
    sagaa sagi vazhi vazhkai vaazhkai valiyae kaayam kaneer kanneer`,
  telugu: `nenu nuvvu meeru memu manam vaadu aame idi adi ikkada akkada ippudu appudu
    ela emiti enduku chala konchem baagundi bagundi manchidi cheyyi chesthanu chesanu
    vastanu vachanu veltanu vellanu unnanu undi ledu lenu kaadu kavali kaavali
    teliyadu telusu chupinchu matladu maataladu nadichi parigettu aadu paadu
    gundelona manasulona kallalona kalalo kalalona nidhura nidura kala kalalu
    andamaina andhamaina muddu muddugaa siggu siggulu navvu navvulu navvuthu
    vayyari singari bangaaru chinnadana chinnari ammadu abbayilu ammayilu
    pelli pellikoduku pellikuthuru seetakoka ponnu ra ree rammantu raaraa
    jathara sankranti dasara pataas
    prema premaga nuvvu nuvve nenu naa nee ra raa ammaye ammayi abbayi manasu manase vachindi
    vachchindi chilaka bava kanulu kannulu andam andame oohalu neeve nannu ninnu cheppu cheppave
    ninne gundello gundelo guvva sita ramaa ramuloo ramulaa samajavaragamana butta bomma naatu
    kurchi madathapetti antava oo kallalona kallalo kaavaale inkem gaali vaaluga adhento gaani
    vunnapaatuga emaindi emito ela ekkada evaru eppudu inka ika poye poyindi raave raavaa chudu
    chudaku choodu choosi cheli cheliya cheppaali paata paataa pilla pillaa naalo neelo nee kosam
    kosame jaabili vennela vennelave manchu varsham hrudayam hrudhayam tholi tholiprema saami
    ammo abba ayyo bangaru bangaram kanne anthe antha entha gunde gundello mama baava baby
    oorantha vasthunnadu vachaadu poddu poddhu ninnila neetho naatho manalo`,
  hindi: `aaj kal abhi phir fir bas sirf kuch koi kaun kaise kahan kab jab tab yahan wahan
    nahi nahin haan hona hua hui hue gaya gayi gaye raha rahi diya liya karo karna karke
    dekh dekhna milna mila mile milke chahiye chahta chahti lagta lagti lage lagi
    pyaari pyare pyara dilruba dildaar mehboob mehbooba jaanam jaaneman sanam humsafar
    aashiq aashiqui deewana deewani pagal paagal mastani mastana nasha nashili
    raatein raaton subah shaam shaame suraj chanda sitare taare aasmaan zameen
    samandar dariya nadi pani paani aag hawa phool khushboo
    shaadi baraat mehendi dulhan dulha ghoda doli vidaai maa papa bhai behen
    dil dilbar tum tumhe tumhari mera meri mere tera teri tere pyaar pyar ishq ishqa hai hain ke ki
    ka se mein main yaar yaara jaana jaane jaan sanam zindagi aankhein aankhon rang kya kyun hum
    humko tujhe mujhe tujh mujh saath raat baat dard mohabbat sajna sajni chaand piya jiya raha rahe
    kahin kabhi naina naino kesariya chaleya raataan lambiyan kun faya jai ho chaiyya zinda banda
    pehle bhi apna bana le duniya khuda rabba mahi soniye dhadkan dhadak saans saanson baarish
    sapna sapne yaadein yaad waqt pal lamhe tanha judaai ghar raah manzil kudiye hawa hawayein
    mann man bheegi chalna chal chalo naach nacho gaana gaane dekha dekho suno sun bolo kehna`,
  malayalam: `njangal ningal avan aval avar ithu athu evide avide ippol appol engane
    enthu enthaa enthanu venam venda undu illa aayi aakum varum pokum vannu poyi
    kandu kettu paranju chirichu karanju snehichu ormayund marakkilla
    hridayam hrudayam manasu manassu mizhikal kannukal chundil chundu
    pookkal poovu poonilave chandrika kaayal kadal theeram thira
    amma achan ettan chechi aniyan aniyathi kalyanam kalyana pennu chekkan
    mazhavillu
    ente ninte pranayam mazha kaattu ponne ninne njan nee manassil omane chirakil thallumaala
    jimikki kammal malare illuminati darshana kudukku kanmani ponnolam kayal poomaram pottu
    aaro aarum ennum ennile ninnile nilaave nilavu mizhi mizhiyil mohame kaanaan kaanum paadaam
    poonkuyile thennal vaanam veyil kaatte kanavil thaalam thudiyil ishtam ishtamaanu aanu alle
    ille illa enthu enthinu eppozhum ormakal ormayil sneham snehamaay`,
  kannada: `naanu neenu avanu avalu naavu neevu idu adu illi alli eega aaga hege yaake
    yenu beku beda ide illa aaytu banni hogi baruttene hogutteeni nodu nodi
    preeti premada hrudayadi manasu manasina kanasina kanasugalu nagu nagutha
    chanda chandada belaku belakina tavaru ooru halli kalyana maduve hudugi huduga
    ninna nanna preethi hudugi baare nanu ninage belageddu karabuu bombe helutaite baa baaro
    hrudaya hrudayadalli kanasu kannu nannolu ninnolu jeeva jeevana olave olavina banna bannada
    mallige chandada sundari huduga hudugi yaake enu gombe thangali bidu beda ninnade nannade`,
  punjabi: `tusi asi oh ki kive kithe kado hun hunn ae aa si sige ho rahe gaye
    dil da di de nu ton tu tenu menu saanu tuhanu sajna sajni ishq pyaar
    jatta jatti gabru kudiyan mundeyan billo heer ranjha yaar yaaran
    jatt jatti kudi munda tere gal vich soniye yaara mainu tainu brown munde excuses lover
    pagg sardar putt yaari dil sohneya sohni mutiyar gabru bhangra balle chak de nachna kalla
    pind wala vekh vekhi rehnda kardi kardiyan ni ve`,
  bengali: `bhalobasha bhalobashi tumi ami amar tomar mon praan shona akash brishti chokh`,
  marathi: `mazi tuzi zingat sairat kalji ga baai aai tula mala prem`,
  english: `a an and or but if then so as at by for from in into of on to up down out over
    under about after before again all any are be been being both can could did do does
    each few had has have he her here him his how i is it its just more most my no not now
    only other our out own same she should some such than that their them there these they
    this those through too very was way were what when where which while who why will with
    would you your yours yourself love loving lover girl boy baby honey sugar sweet darling
    up gone go going come coming back mine ours
    blue red gold golden diamond silver black white green
    party club drive road city town street ocean river mountain moon sun star
    feeling feelings feels touch closer higher faded levitating watermelon
    the you me my love baby girl night heart your we dance feel want know never forever tonight
    summer shape perfect believer blinding lights cruel senorita lover thunder dream dreams light
    fire world time life alone together stay home crazy heaven angel story sky stars rain beautiful
    happy sad tears hold kiss hands eyes run fly free wild young old remember goodbye hello`,
};

// Artist -> language weights (most of an artist's catalogue). Multilingual artists are spread out.
const ARTISTS = {
  "anirudh ravichander": { tamil: 0.6, telugu: 0.25, hindi: 0.15 },
  "a r rahman": { tamil: 0.45, hindi: 0.45, telugu: 0.1 },
  "ar rahman": { tamil: 0.45, hindi: 0.45, telugu: 0.1 },
  "sid sriram": { tamil: 0.5, telugu: 0.45, malayalam: 0.05 },
  "shreya ghoshal": { hindi: 0.4, tamil: 0.2, telugu: 0.15, malayalam: 0.13, kannada: 0.12 },
  "shilpa rao": { hindi: 0.6, tamil: 0.2, telugu: 0.2 },
  "k s chithra": { malayalam: 0.4, tamil: 0.4, telugu: 0.1, kannada: 0.1 },
  "chithra": { malayalam: 0.4, tamil: 0.4, telugu: 0.1, kannada: 0.1 },
  "s p balasubrahmanyam": { tamil: 0.5, telugu: 0.4, kannada: 0.1 },
  "hariharan": { tamil: 0.6, hindi: 0.2, malayalam: 0.2 },
  "ilaiyaraaja": { tamil: 0.85, telugu: 0.1, malayalam: 0.05 },
  "ilayaraja": { tamil: 0.85, telugu: 0.1, malayalam: 0.05 },
  "yuvan shankar raja": { tamil: 0.9, telugu: 0.1 },
  "harris jayaraj": { tamil: 0.8, telugu: 0.2 },
  "d imman": { tamil: 1 }, "santhosh narayanan": { tamil: 0.9, telugu: 0.1 },
  "g v prakash": { tamil: 0.9, telugu: 0.1 }, "gv prakash": { tamil: 0.9, telugu: 0.1 },
  "hiphop tamizha": { tamil: 1 }, "sai abhyankkar": { tamil: 1 }, "dhanush": { tamil: 0.9, hindi: 0.1 },
  "vijay": { tamil: 0.9, telugu: 0.1 }, "sean roldan": { tamil: 1 }, "deva": { tamil: 1 },
  "vidyasagar": { tamil: 0.6, malayalam: 0.4 }, "naresh iyer": { tamil: 0.7, telugu: 0.3 },
  "devi sri prasad": { telugu: 0.85, tamil: 0.15 }, "thaman s": { telugu: 0.9, tamil: 0.1 },
  "ss thaman": { telugu: 0.9, tamil: 0.1 }, "thaman": { telugu: 0.9, tamil: 0.1 },
  "m m keeravani": { telugu: 0.85, hindi: 0.15 }, "mm keeravani": { telugu: 0.85, hindi: 0.15 },
  "anurag kulkarni": { telugu: 1 }, "ram miriyala": { telugu: 1 }, "mangli": { telugu: 1 },
  "rahul sipligunj": { telugu: 1 }, "kaala bhairava": { telugu: 1 }, "armaan malik": { hindi: 0.7, telugu: 0.3 },
  "indravathi chauhan": { telugu: 1 }, "sahithi chaganti": { telugu: 1 },
  "arijit singh": { hindi: 0.95, bengali: 0.05 }, "pritam": { hindi: 1 }, "atif aslam": { hindi: 1 },
  "neha kakkar": { hindi: 0.9, punjabi: 0.1 }, "badshah": { hindi: 0.6, punjabi: 0.4 },
  "jubin nautiyal": { hindi: 1 }, "vishal mishra": { hindi: 1 }, "sonu nigam": { hindi: 0.85, kannada: 0.15 },
  "sukhwinder singh": { hindi: 0.9, punjabi: 0.1 }, "sachin jigar": { hindi: 1 }, "javed ali": { hindi: 0.9, telugu: 0.1 },
  "mohit chauhan": { hindi: 1 }, "kk": { hindi: 1 }, "lata mangeshkar": { hindi: 1 }, "kishore kumar": { hindi: 1 },
  "asees kaur": { hindi: 0.7, punjabi: 0.3 }, "shankar ehsaan loy": { hindi: 1 },
  "vineeth sreenivasan": { malayalam: 1 }, "sushin shyam": { malayalam: 1 }, "hesham abdul wahab": { malayalam: 1 },
  "vijay yesudas": { malayalam: 0.6, tamil: 0.4 }, "k j yesudas": { malayalam: 0.6, tamil: 0.3, hindi: 0.1 },
  "rajesh murugesan": { malayalam: 1 }, "dabzee": { malayalam: 1 }, "vishnu vijay": { malayalam: 1 },
  "shaan rahman": { malayalam: 1 }, "ranjith unni": { malayalam: 1 },
  "vijay prakash": { kannada: 0.6, hindi: 0.2, tamil: 0.2 }, "arjun janya": { kannada: 1 },
  "v harikrishna": { kannada: 1 }, "chandan shetty": { kannada: 1 }, "puneeth rajkumar": { kannada: 1 },
  "ap dhillon": { punjabi: 1 }, "diljit dosanjh": { punjabi: 0.9, hindi: 0.1 }, "karan aujla": { punjabi: 1 },
  "sidhu moose wala": { punjabi: 1 }, "gurinder gill": { punjabi: 1 }, "guru randhawa": { punjabi: 0.7, hindi: 0.3 },
  "silambarasan": { tamil: 0.95, telugu: 0.05 },
  "karthik": { tamil: 0.6, telugu: 0.3, malayalam: 0.1 },
  "haricharan": { tamil: 0.7, telugu: 0.2, malayalam: 0.1 }, "pradeep kumar": { tamil: 0.9, telugu: 0.1 },
  "leon james": { tamil: 1 }, "ghibran": { tamil: 1 }, "vijay antony": { tamil: 1 }, "govind vasantha": { tamil: 0.6, malayalam: 0.4 },
  "amit trivedi": { hindi: 1 }, "vishal dadlani": { hindi: 1 }, "shaan": { hindi: 1 },
  "ram charan": { telugu: 1 }, "rahul nambiar": { telugu: 0.5, tamil: 0.5 },
  "justin varghese": { malayalam: 1 },
  "sanjith hegde": { kannada: 0.5, tamil: 0.3, telugu: 0.2 },
  "ariana grande": { english: 1 }, "olivia rodrigo": { english: 1 }, "post malone": { english: 1 }, "sia": { english: 1 },
  "adele": { english: 1 }, "lady gaga": { english: 1 }, "rihanna": { english: 1 }, "beyonce": { english: 1 },
  "travis scott": { english: 1 }, "kendrick lamar": { english: 1 }, "sza": { english: 1 }, "doja cat": { english: 1 },
  "ed sheeran": { english: 1 }, "taylor swift": { english: 1 }, "the weeknd": { english: 1 },
  "imagine dragons": { english: 1 }, "dua lipa": { english: 1 }, "justin bieber": { english: 1 },
  "shawn mendes": { english: 1 }, "camila cabello": { english: 1 }, "coldplay": { english: 1 },
  "billie eilish": { english: 1 }, "bruno mars": { english: 1 }, "maroon 5": { english: 1 },
  "charlie puth": { english: 1 }, "eminem": { english: 1 }, "drake": { english: 1 },
};

// ─── Training ───
const ALPHA = 0.1;
const words = {};
const wordTotals = {};
const wordVocab = new Set();
const grams = {};
const gramTotals = {};
const gramVocab = new Set();

const trigrams = (w) => {
  const s = `^${w}$`;
  const out = [];
  for (let i = 0; i < s.length - 2; i++) out.push(s.slice(i, i + 3));
  return out;
};

for (const lang of LANGUAGES) {
  words[lang] = {};
  grams[lang] = {};
  wordTotals[lang] = 0;
  gramTotals[lang] = 0;
  for (const w of tokenize(VOCAB[lang] || "")) {
    words[lang][w] = (words[lang][w] || 0) + 1;
    wordTotals[lang]++;
    wordVocab.add(w);
    for (const g of trigrams(w)) {
      grams[lang][g] = (grams[lang][g] || 0) + 1;
      gramTotals[lang]++;
      gramVocab.add(g);
    }
  }
}

const wordLogP = (lang, w) => Math.log(((words[lang][w] || 0) + ALPHA) / (wordTotals[lang] + ALPHA * wordVocab.size));
const gramLogP = (lang, g) => Math.log(((grams[lang][g] || 0) + 0.5) / (gramTotals[lang] + 0.5 * gramVocab.size));

// ─── Artist languages learned from listening data ───
// Every confidently identified song teaches its artists' languages (online learning), so artists
// missing from the table above are covered after a few of their songs have been seen.
const learned = new Map(); // artist -> { lang: count }
const LEARN_KEY = "aurasynq_artist_langs";
let learnedLoaded = false;
const loadLearned = () => {
  if (learnedLoaded) return;
  learnedLoaded = true;
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(LEARN_KEY) || "[]");
    for (const [artist, dist] of saved) learned.set(artist, dist);
  } catch (e) {}
};
let learnTimer = null;
const saveLearned = () => {
  clearTimeout(learnTimer);
  learnTimer = setTimeout(() => {
    try {
      const entries = [...learned.entries()].slice(-1500);
      globalThis.localStorage?.setItem(LEARN_KEY, JSON.stringify(entries));
    } catch (e) {}
  }, 1000);
};

const artistNames = (line) => String(line || "").split(/,|&| x | feat\.? | ft\.? | and /i).map((a) => normalize(a)).filter(Boolean);

export function learnArtistLanguage(artistLine, language) {
  if (!language) return;
  loadLearned();
  for (const name of artistNames(artistLine)) {
    if (ARTISTS[name]) continue;
    const dist = learned.get(name) || {};
    dist[language] = (dist[language] || 0) + 1;
    learned.set(name, dist);
  }
  saveLearned();
}

// Artist priors for a credit line ("A, B & C"): the average of the known artists' distributions
function artistPrior(artistLine) {
  loadLearned();
  const dist = {};
  let known = 0;
  for (const name of artistNames(artistLine)) {
    const key = ARTISTS[name] ? name : Object.keys(ARTISTS).find((k) => k.length > 4 && (name.includes(k) || k.includes(name)));
    if (key) {
      known++;
      for (const [lang, w] of Object.entries(ARTISTS[key])) dist[lang] = (dist[lang] || 0) + w;
      continue;
    }
    // Learned from listening: trusted in proportion to how many songs taught it
    const seen = learned.get(name);
    if (!seen) continue;
    const total = Object.values(seen).reduce((a, b) => a + b, 0);
    const trust = Math.min(1, total / 3);
    known += trust;
    for (const [lang, n] of Object.entries(seen)) dist[lang] = (dist[lang] || 0) + trust * (n / total);
  }
  if (!known) return null;
  for (const lang of Object.keys(dist)) dist[lang] /= known;
  return dist;
}

// Returns { language, confidence } (language null when the evidence is too thin)
export function identifyLanguage({ song = "", film = "", artist = "" }) {
  const titleWords = [...new Set(tokenize(`${song} ${film}`))].filter((w) => w.length > 1 && !/^\d+$/.test(w));
  const prior = artistPrior(artist);
  const scores = {};
  let evidence = 0;

  for (const lang of LANGUAGES) {
    let s = 0;
    // Artists: soft prior (log of their share, floored so one credit can't veto the title)
    if (prior) s += 1.6 * Math.log((prior[lang] || 0) + 0.03);
    for (const w of titleWords) {
      if (wordVocab.has(w)) {
        s += 1.5 * wordLogP(lang, w);
      } else if (w.length >= 4) {
        // Unseen word: judge it by its shape (mean trigram log-probability)
        const g = trigrams(w);
        s += 0.9 * (g.reduce((n, x) => n + gramLogP(lang, x), 0) / g.length);
      }
    }
    scores[lang] = s;
  }
  if (prior) evidence++;
  if (titleWords.some((w) => wordVocab.has(w) || w.length >= 4)) evidence++;
  if (!evidence) return { language: null, confidence: 0 };

  const max = Math.max(...Object.values(scores));
  const exp = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, Math.exp(v - max)]));
  const sum = Object.values(exp).reduce((a, b) => a + b, 0);
  const [language, best] = Object.entries(exp).sort((a, b) => b[1] - a[1])[0];
  const confidence = best / sum;
  return confidence >= 0.4 ? { language, confidence } : { language: null, confidence };
}
