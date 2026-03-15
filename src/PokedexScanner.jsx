import { useState, useRef, useCallback, useEffect } from "react";

const POKEDEX_RED = "#DC0A2D";
const POKEDEX_DARK = "#A00020";
const POKEDEX_DARKER = "#7A0018";
const SCREEN_BG = "#98CB98";
const SCREEN_DARK = "#6B9B6B";

const typeColors = {
  normal:"#A8A878",fire:"#F08030",water:"#6890F0",electric:"#F8D030",
  grass:"#78C850",ice:"#98D8D8",fighting:"#C03028",poison:"#A040A0",
  ground:"#E0C068",flying:"#A890F0",psychic:"#F85888",bug:"#A8B820",
  rock:"#B8A038",ghost:"#705898",dragon:"#7038F8",dark:"#705848",
  steel:"#B8B8D0",fairy:"#EE99AC",
};

function TypeBadge({ type }) {
  return (
    <span style={{
      background: typeColors[type] || "#888", color: "#fff",
      padding: "2px 12px", borderRadius: "12px", fontSize: "13px",
      fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px",
      textShadow: "0 1px 2px rgba(0,0,0,0.3)", display: "inline-block",
    }}>{type}</span>
  );
}

function LEDLight({ color, size = 12, glow = false, pulse = false }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: `radial-gradient(circle at 35% 35%, ${color}ee, ${color}88, ${color}44)`,
      border: `1px solid ${color}44`,
      boxShadow: glow ? `0 0 ${size}px ${color}88, inset 0 0 ${size/3}px rgba(255,255,255,0.3)` : `inset 0 0 ${size/3}px rgba(255,255,255,0.2)`,
      animation: pulse ? "pokedexPulse 1.5s ease-in-out infinite" : "none",
    }} />
  );
}

function BlueLens({ speaking }) {
  return (
    <div style={{
      width: 60, height: 60, borderRadius: "50%",
      background: "radial-gradient(circle at 35% 35%, #7DF9FF, #00BFFF, #0077BE)",
      border: "4px solid #eee",
      boxShadow: speaking
        ? "0 0 20px rgba(0,191,255,0.7), 0 0 40px rgba(0,191,255,0.3), inset 0 0 20px rgba(255,255,255,0.3)"
        : "0 0 15px rgba(0,191,255,0.4), inset 0 0 20px rgba(255,255,255,0.3)",
      outline: "3px solid #ccc",
      animation: speaking ? "lensGlow 0.6s ease-in-out infinite alternate" : "none",
    }} />
  );
}

function SpeakingWaveform() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, height: 16 }}>
      {[0,1,2,3,4,5,6].map(i => (
        <div key={i} style={{
          width: 3, borderRadius: 2, background: "#00BFFF",
          animation: `waveBar 0.8s ease-in-out ${i*0.1}s infinite alternate`,
        }} />
      ))}
      <span style={{ fontSize: 11, color: "#00BFFF", marginLeft: 6, fontWeight: 600, letterSpacing: 1 }}>SPEAKING</span>
    </div>
  );
}

export default function PokedexScanner() {
  const [stage, setStage] = useState("idle");
  const [pokemon, setPokemon] = useState(null);
  const [error, setError] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [cameraStream, setCameraStream] = useState(null);
  const [cardData, setCardData] = useState(null);
  const [scanStep, setScanStep] = useState(null); // { phase, pokemonName, progress }
  const [audioOn, setAudioOn] = useState(true);
  const [resultTab, setResultTab] = useState("pokedex"); // "pokedex" | "card"
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
      if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    };
  }, [cameraStream]);

  // ─── Voice (anime Pokédex style - clear, female, clinical) ───
  const getPokedexVoice = useCallback(() => {
    const voices = window.speechSynthesis.getVoices();
    // The anime Pokédex uses a female voice — clear, precise, slightly synthetic
    const preferred = [
      "Google UK English Female", "Google US English", "Samantha", "Karen",
      "Moira", "Tessa", "Microsoft Zira", "Microsoft Hazel",
      "Google UK English Male", "Microsoft David", "Daniel",
    ];
    for (const name of preferred) {
      const v = voices.find(voice => voice.name.includes(name));
      if (v) return v;
    }
    return voices.find(v => v.lang.startsWith("en") && v.name.toLowerCase().includes("female"))
      || voices.find(v => v.lang.startsWith("en"))
      || voices[0] || null;
  }, []);

  const speakPokedex = useCallback((entry) => {
    if (!audioOn) return;
    window.speechSynthesis.cancel();
    const doSpeak = () => {
      // Anime-style delivery: name first, then type, then description — clipped and factual
      const text = `${entry.name}. The ${entry.genus}. Type: ${entry.types.join(" and ")}. ${entry.description}`;
      const u = new SpeechSynthesisUtterance(text);
      const voice = getPokedexVoice();
      if (voice) u.voice = voice;
      // Anime Pokédex: slightly fast, higher pitch, very precise
      u.rate = 1.08;
      u.pitch = 1.15;
      u.volume = 1;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    };
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = doSpeak;
    } else { doSpeak(); }
  }, [getPokedexVoice, audioOn]);

  // ─── PokéAPI fetch ───
  const fetchFromPokeAPI = useCallback(async (name) => {
    const normalized = name.toLowerCase().trim().replace(/[^a-z0-9-]/g, "");
    const [speciesRes, pokemonRes] = await Promise.all([
      fetch(`https://pokeapi.co/api/v2/pokemon-species/${normalized}`),
      fetch(`https://pokeapi.co/api/v2/pokemon/${normalized}`)
    ]);
    if (!speciesRes.ok || !pokemonRes.ok) return null;
    const speciesData = await speciesRes.json();
    const pokemonData = await pokemonRes.json();
    const englishEntry = speciesData.flavor_text_entries?.find(e => e.language.name === "en");
    const description = englishEntry?.flavor_text?.replace(/[\n\f\r]/g, " ").replace(/\s+/g, " ").trim() || "No description available.";
    return {
      name: speciesData.name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("-"),
      dexNumber: speciesData.id,
      types: pokemonData.types.map(t => t.type.name),
      description,
      sprite: pokemonData.sprites?.other?.["official-artwork"]?.front_default || pokemonData.sprites?.front_default,
      genus: speciesData.genera?.find(g => g.language.name === "en")?.genus || "",
    };
  }, []);

  // ─── TCG API fetch ───
  const fetchCardData = useCallback(async (pokemonName, cardNumber = null, setCode = null) => {
    try {
      // Build the most specific query possible
      let query = `name:"${pokemonName}"`;
      if (cardNumber) {
        const num = cardNumber.split("/")[0];
        query += ` number:"${num}"`;
      }
      if (setCode) {
        // Try matching set code/name
        query += ` (set.id:"${setCode.toLowerCase()}" OR set.name:"${setCode}")`;
      }

      let res = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(query)}&pageSize=5`);
      let data = res.ok ? await res.json() : null;

      // If specific query found nothing, fall back to just name + number
      if (!data?.data?.length && (setCode || cardNumber)) {
        let fallbackQuery = `name:"${pokemonName}"`;
        if (cardNumber) fallbackQuery += ` number:"${cardNumber.split("/")[0]}"`;
        res = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(fallbackQuery)}&pageSize=10`);
        data = res.ok ? await res.json() : null;
      }

      // Last resort: just name
      if (!data?.data?.length) {
        res = await fetch(`https://api.pokemontcg.io/v2/cards?q=name:"${encodeURIComponent(pokemonName)}"&orderBy=-tcgplayer.prices.holofoil.market&pageSize=5`);
        data = res.ok ? await res.json() : null;
      }

      if (!data?.data?.length) return null;

      // Pick best match — prefer exact card number match
      let card = data.data[0];
      if (cardNumber) {
        const exactNum = cardNumber.split("/")[0];
        const exact = data.data.find(c => c.number === exactNum);
        if (exact) card = exact;
      }

      const prices = card.tcgplayer?.prices || {};
      const priceSource = prices.holofoil || prices["1stEditionHolofoil"] || prices.reverseHolofoil || prices.normal || prices["1stEditionNormal"] || {};
      return {
        rarity: card.rarity || "Unknown",
        marketPrice: priceSource.market || priceSource.mid || null,
        tcgplayerUrl: card.tcgplayer?.url || null,
        setName: card.set?.name || null,
        cardNumber: card.number ? `${card.number}/${card.set?.printedTotal || "?"}` : null,
      };
    } catch { return null; }
  }, []);

  // ─── Search (cached pokemon list) ───
  const searchTimeout = useRef(null);
  const pokemonListCache = useRef(null);
  const handleSearch = useCallback((q) => {
    setSearchQuery(q);
    if (q.length < 2) { setSuggestions([]); return; }
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      try {
        if (!pokemonListCache.current) {
          const res = await fetch(`https://pokeapi.co/api/v2/pokemon?limit=1302`);
          const data = await res.json();
          pokemonListCache.current = data.results;
        }
        const norm = q.toLowerCase();
        setSuggestions(pokemonListCache.current.filter(p => p.name.startsWith(norm) || p.name.includes(norm)).slice(0, 6).map(p => ({ name: p.name })));
      } catch { setSuggestions([]); }
    }, 200);
  }, []);

  const lookupPokemon = useCallback(async (name, cardNumber = null, fromScan = false, setCode = null) => {
    setStage("scanning"); setError(""); setSuggestions([]); setCardData(null);
    if (!fromScan) setScanStep({ phase: "pokedex", pokemonName: name, progress: 50 });
    try {
      setScanStep(prev => ({ ...prev, phase: "pokedex", progress: fromScan ? 50 : 60 }));
      const entry = await fetchFromPokeAPI(name);
      if (entry) {
        setScanStep({ phase: "found", pokemonName: entry.name, progress: 80 });
        setPokemon(entry);
        await new Promise(r => setTimeout(r, 600));
        setScanStep({ phase: "market", pokemonName: entry.name, progress: 90 });
        setStage("result"); speakPokedex(entry);
        const displayName = name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("-");
        fetchCardData(displayName, cardNumber, setCode).then(cd => {
          if (cd) setCardData(cd);
          else fetchCardData(entry.name, cardNumber, setCode).then(cd2 => { if (cd2) setCardData(cd2); });
          setScanStep(null);
        });
      } else {
        setScanStep(null);
        setError(`Couldn't find "${name}" in the Pokédex.`); setStage("error");
      }
    } catch {
      setScanStep(null);
      setError("Network error fetching Pokédex data."); setStage("error");
    }
  }, [fetchFromPokeAPI, speakPokedex, fetchCardData]);

  // ─── Camera ───
  const startCamera = useCallback(async () => {
    try {
      setError(""); setPokemon(null); setCardData(null); setStage("camera");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } }
      });
      setCameraStream(stream);
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
    } catch {
      setError("Camera access denied. Try uploading a photo instead."); setStage("error");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); setCameraStream(null); }
  }, [cameraStream]);

  // ─── Image → API → PokéAPI ───
  const identifyImage = useCallback(async (base64, mimeType) => {
    setStage("scanning");
    setScanStep({ phase: "uploading", pokemonName: null, progress: 10 });
    try {
      // Simulate progress during the API call
      const progressTimer = setInterval(() => {
        setScanStep(prev => prev && prev.phase === "identifying" ? { ...prev, progress: Math.min(prev.progress + 3, 45) } : prev);
      }, 400);

      setScanStep({ phase: "identifying", pokemonName: null, progress: 20 });
      const res = await fetch("/api/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mimeType })
      });
      clearInterval(progressTimer);
      const data = await res.json();

      if (!data.name || data.name === "unknown") {
        setScanStep(null);
        const debugMsg = data.debug ? ` (${data.debug})` : "";
        setError(`Couldn't identify a Pokémon in that image.${debugMsg} Try another angle or search by name.`);
        setStage("error");
        return;
      }
      setScanStep({ phase: "identified", pokemonName: data.name, progress: 50 });
      await new Promise(r => setTimeout(r, 800));
      await lookupPokemon(data.name, data.cardNumber || null, true, data.setCode || null);
    } catch (e) {
      setScanStep(null);
      setError("Image scan failed: " + e.message); setStage("error");
    }
  }, [lookupPokemon]);

  const captureAndScan = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    stopCamera();
    identifyImage(dataUrl.split(",")[1], "image/jpeg");
  }, [stopCamera, identifyImage]);

  const handleFileUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      identifyImage(ev.target.result.split(",")[1], file.type || "image/jpeg");
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [identifyImage]);

  const reset = () => {
    window.speechSynthesis.cancel(); setSpeaking(false);
    stopCamera(); setPokemon(null); setCardData(null); setScanStep(null); setError("");
    setSearchQuery(""); setSuggestions([]); setResultTab("pokedex"); setStage("idle");
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "20px", fontFamily: "'Segoe UI', system-ui, sans-serif",
    }}>
      <style>{`
        @keyframes pokedexPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spriteFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes lensGlow {
          from{box-shadow:0 0 15px rgba(0,191,255,0.5),inset 0 0 20px rgba(255,255,255,0.3)}
          to{box-shadow:0 0 30px rgba(0,191,255,0.8),0 0 60px rgba(0,191,255,0.3),inset 0 0 25px rgba(255,255,255,0.4)}
        }
        @keyframes waveBar { from{height:3px} to{height:14px} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes pokeBounce { 0%,100%{transform:translateY(0) rotate(0deg)} 25%{transform:translateY(-12px) rotate(-10deg)} 50%{transform:translateY(0) rotate(0deg)} 75%{transform:translateY(-6px) rotate(5deg)} }
        @keyframes shimmer { 0%{background-position:-200px 0} 100%{background-position:200px 0} }
        @keyframes nameReveal { from{opacity:0;transform:scale(0.5) translateY(10px);filter:blur(8px)} to{opacity:1;transform:scale(1) translateY(0);filter:blur(0)} }
        @keyframes progressPulse { 0%,100%{opacity:0.8} 50%{opacity:1} }
        @keyframes slideInRight { from{opacity:0;transform:translateX(30px)} to{opacity:1;transform:translateX(0)} }
        @keyframes slideInLeft { from{opacity:0;transform:translateX(-30px)} to{opacity:1;transform:translateX(0)} }
        @keyframes cardSpin { 0%{transform:rotateY(0deg)} 50%{transform:rotateY(180deg)} 100%{transform:rotateY(360deg)} }
      `}</style>

      <canvas ref={canvasRef} style={{ display: "none" }} />
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} style={{ display: "none" }} />

      <div style={{
        width: 380, maxWidth: "100%",
        background: `linear-gradient(160deg, ${POKEDEX_RED} 0%, ${POKEDEX_DARK} 60%, ${POKEDEX_DARKER} 100%)`,
        borderRadius: "20px 20px 12px 12px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          background: `linear-gradient(180deg, ${POKEDEX_RED} 0%, ${POKEDEX_DARK} 100%)`,
          padding: "16px 20px 12px", display: "flex", alignItems: "center", gap: 14,
          borderBottom: "4px solid rgba(0,0,0,0.2)",
        }}>
          <BlueLens speaking={speaking} />
          <div style={{ display: "flex", gap: 8, marginLeft: 8 }}>
            <LEDLight color="#FF4444" size={10} glow={stage==="error"} pulse={stage==="error"} />
            <LEDLight color="#FFDD44" size={10} glow={stage==="scanning"} pulse={stage==="scanning"} />
            <LEDLight color="#44FF66" size={10} glow={stage==="result"} />
          </div>
          {/* Audio toggle */}
          <div
            onClick={() => { setAudioOn(prev => !prev); if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); } }}
            style={{
              marginLeft: "auto", cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
              background: audioOn ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.4)",
              borderRadius: 16, padding: "5px 10px",
              border: `1px solid ${audioOn ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)"}`,
              transition: "all 0.2s ease",
            }}
          >
            <div style={{ fontSize: 14 }}>{audioOn ? "🔊" : "🔇"}</div>
            {/* Slider track */}
            <div style={{
              width: 28, height: 14, borderRadius: 7,
              background: audioOn ? "#44CC66" : "#555",
              position: "relative", transition: "background 0.2s ease",
            }}>
              {/* Slider knob */}
              <div style={{
                width: 10, height: 10, borderRadius: "50%",
                background: "#fff", position: "absolute", top: 2,
                left: audioOn ? 16 : 2,
                transition: "left 0.2s ease",
                boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
              }} />
            </div>
          </div>
        </div>

        {/* Hinge */}
        <div style={{ height: 20, background: "linear-gradient(180deg,rgba(0,0,0,0.15)0%,transparent 100%)", position: "relative" }}>
          <div style={{ position:"absolute",left:0,right:"50%",top:8,height:3,background:POKEDEX_DARKER,transform:"skewY(-2deg)",borderRadius:2 }} />
        </div>

        <div style={{ padding: "0 20px 20px" }}>
          {/* Screen */}
          <div style={{ background:"#2a2a2a", borderRadius:12, padding:8, boxShadow:"inset 0 4px 12px rgba(0,0,0,0.5)" }}>
            <div style={{
              background: stage==="result" ? "#1a1a2e" : (stage==="camera" ? "#000" : `linear-gradient(180deg,${SCREEN_BG},${SCREEN_DARK})`),
              borderRadius: 8, minHeight: 280, overflow: "hidden",
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
            }}>

              {/* IDLE */}
              {stage === "idle" && (
                <div style={{ textAlign:"center", padding:24, animation:"fadeIn 0.5s ease", width:"100%" }}>
                  <div style={{ fontSize:42, marginBottom:8 }}>📷</div>
                  <div style={{ fontSize:16, fontWeight:700, color:"#2a4a2a", marginBottom:4 }}>POKÉDEX v2.0</div>
                  <div style={{ fontSize:12, color:"#4a6a4a", lineHeight:1.5, marginBottom:16 }}>
                    Search by name, scan a card with<br/>your camera, or upload a photo
                  </div>
                  <div style={{ position:"relative", maxWidth:260, margin:"0 auto" }}>
                    <input type="text" value={searchQuery} placeholder="Search by name..."
                      onChange={e => handleSearch(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && searchQuery) lookupPokemon(searchQuery); }}
                      style={{
                        width:"100%", padding:"10px 14px", borderRadius:20,
                        border:"2px solid #5a8a5a", background:"rgba(255,255,255,0.85)",
                        fontSize:14, outline:"none", color:"#2a4a2a", fontWeight:500, boxSizing:"border-box",
                      }}
                    />
                    {suggestions.length > 0 && (
                      <div style={{
                        position:"absolute", top:"100%", left:0, right:0, zIndex:10,
                        background:"#fff", borderRadius:12, marginTop:4,
                        boxShadow:"0 8px 24px rgba(0,0,0,0.2)", overflow:"hidden",
                      }}>
                        {suggestions.map(p => (
                          <div key={p.name} onClick={() => { setSearchQuery(""); lookupPokemon(p.name); }}
                            style={{ padding:"8px 14px", cursor:"pointer", borderBottom:"1px solid #eee",
                              fontSize:13, color:"#333", fontWeight:500, textTransform:"capitalize" }}
                            onMouseEnter={e => e.currentTarget.style.background="#f0f8f0"}
                            onMouseLeave={e => e.currentTarget.style.background="#fff"}
                          >{p.name.replace(/-/g, " ")}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* CAMERA */}
              {stage === "camera" && (
                <div style={{ width:"100%", height:280, position:"relative" }}>
                  <video ref={videoRef} autoPlay playsInline muted style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                  <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}>
                    <div style={{ width:"70%", height:"75%", border:"2px solid rgba(255,255,255,0.6)", borderRadius:12, boxShadow:"0 0 0 2000px rgba(0,0,0,0.3)" }} />
                  </div>
                  <div style={{ position:"absolute", bottom:12, left:"50%", transform:"translateX(-50%)",
                    color:"#fff", fontSize:11, textShadow:"0 1px 4px rgba(0,0,0,0.8)", whiteSpace:"nowrap" }}>Center card in frame</div>
                </div>
              )}

              {/* SCANNING */}
              {stage === "scanning" && (
                <div style={{ textAlign:"center", padding:20, animation:"fadeIn 0.3s ease", width:"100%" }}>
                  {/* Pokéball animation */}
                  <div style={{ margin:"0 auto 16px", width:60, height:60, position:"relative", animation:"pokeBounce 1.2s ease-in-out infinite" }}>
                    {/* Top half (red) */}
                    <div style={{ position:"absolute", top:0, left:0, right:0, height:30, background:"#DC0A2D", borderRadius:"30px 30px 0 0", borderBottom:"3px solid #333" }} />
                    {/* Bottom half (white) */}
                    <div style={{ position:"absolute", bottom:0, left:0, right:0, height:27, background:"#fff", borderRadius:"0 0 30px 30px" }} />
                    {/* Center button */}
                    <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", width:18, height:18, borderRadius:"50%", background:"#fff", border:"3px solid #333", zIndex:2, boxShadow: scanStep?.phase === "identified" || scanStep?.phase === "found" ? "0 0 12px rgba(68,255,102,0.8)" : "none", transition:"box-shadow 0.3s" }} />
                    {/* Outer ring */}
                    <div style={{ position:"absolute", inset:0, borderRadius:"50%", border:"3px solid #333" }} />
                  </div>

                  {/* Status text */}
                  <div style={{ fontSize:14, fontWeight:700, color:"#2a4a2a", marginBottom:4 }}>
                    {scanStep?.phase === "uploading" && "INITIALIZING POKÉDEX..."}
                    {scanStep?.phase === "identifying" && "SCANNING POKÉMON DATA..."}
                    {scanStep?.phase === "identified" && "POKÉMON IDENTIFIED!"}
                    {scanStep?.phase === "pokedex" && "RETRIEVING POKÉDEX ENTRY..."}
                    {scanStep?.phase === "found" && "DATA DOWNLOAD COMPLETE!"}
                    {(!scanStep || scanStep.phase === "market") && "PROCESSING..."}
                  </div>

                  {/* Pokémon name reveal */}
                  {scanStep?.pokemonName && (scanStep.phase === "identified" || scanStep.phase === "found" || scanStep.phase === "pokedex") && (
                    <div style={{
                      fontSize:22, fontWeight:800, color:"#2a4a2a", marginTop:4, marginBottom:8,
                      textTransform:"capitalize", animation:"nameReveal 0.5s ease-out",
                      textShadow:"0 1px 2px rgba(0,0,0,0.1)",
                    }}>
                      {scanStep.pokemonName.replace(/-/g, " ")}
                    </div>
                  )}

                  {/* Sub-status */}
                  <div style={{ fontSize:11, color:"#4a6a4a", marginBottom:12 }}>
                    {scanStep?.phase === "uploading" && "Calibrating optical sensors..."}
                    {scanStep?.phase === "identifying" && "Cross-referencing with known species..."}
                    {scanStep?.phase === "identified" && "Querying Professor Oak's database..."}
                    {scanStep?.phase === "pokedex" && "Downloading field research notes..."}
                    {scanStep?.phase === "found" && "Compiling habitat and type data..."}
                    {(!scanStep || scanStep.phase === "market") && "Searching Pokédex records..."}
                  </div>

                  {/* Progress bar */}
                  <div style={{ maxWidth:220, margin:"0 auto", height:6, background:"rgba(0,0,0,0.15)", borderRadius:3, overflow:"hidden" }}>
                    <div style={{
                      height:"100%", borderRadius:3,
                      background:"linear-gradient(90deg, #44CC66, #22AA44)",
                      width: `${scanStep?.progress || 10}%`,
                      transition:"width 0.4s ease-out",
                      animation:"progressPulse 1.5s ease-in-out infinite",
                    }} />
                  </div>
                </div>
              )}

              {/* RESULT */}
              {stage === "result" && pokemon && (
                <div style={{ width:"100%", color:"#e0e0e0", overflow:"hidden" }}>
                  {/* Tab switcher */}
                  <div style={{ display:"flex", borderBottom:"1px solid rgba(255,255,255,0.1)" }}>
                    <button onClick={() => setResultTab("pokedex")} style={{
                      flex:1, padding:"10px 0", fontSize:12, fontWeight:700, letterSpacing:1,
                      background: resultTab==="pokedex" ? "rgba(255,255,255,0.08)" : "transparent",
                      color: resultTab==="pokedex" ? "#fff" : "#666",
                      border:"none", cursor:"pointer", textTransform:"uppercase",
                      borderBottom: resultTab==="pokedex" ? "2px solid #00BFFF" : "2px solid transparent",
                      transition:"all 0.2s",
                    }}>📖 Pokédex</button>
                    <button onClick={() => setResultTab("card")} style={{
                      flex:1, padding:"10px 0", fontSize:12, fontWeight:700, letterSpacing:1,
                      background: resultTab==="card" ? "rgba(255,255,255,0.08)" : "transparent",
                      color: resultTab==="card" ? "#fff" : "#666",
                      border:"none", cursor:"pointer", textTransform:"uppercase",
                      borderBottom: resultTab==="card" ? "2px solid #FFD700" : "2px solid transparent",
                      transition:"all 0.2s",
                      position:"relative",
                    }}>
                      💰 Card Info
                      {!cardData && <span style={{ position:"absolute", top:6, right:"15%", width:6, height:6, borderRadius:"50%", background:"#FFDD44", animation:"pokedexPulse 1.5s infinite" }} />}
                    </button>
                  </div>

                  {/* POKÉDEX TAB */}
                  {resultTab === "pokedex" && (
                    <div style={{ padding:16, animation:"slideInLeft 0.3s ease" }}>
                      {/* Sprite */}
                      <div style={{ display:"flex", justifyContent:"center", marginBottom:12 }}>
                        <div style={{
                          width:120, height:120, borderRadius:"50%",
                          background:`radial-gradient(circle, ${typeColors[pokemon.types[0]]||"#888"}33 0%, ${typeColors[pokemon.types[0]]||"#888"}11 60%, transparent 70%)`,
                          display:"flex", alignItems:"center", justifyContent:"center",
                        }}>
                          {pokemon.sprite && (
                            <img src={pokemon.sprite} alt={pokemon.name} style={{
                              width:110, height:110, objectFit:"contain",
                              filter:"drop-shadow(0 6px 12px rgba(0,0,0,0.5))",
                              animation:"spriteFloat 3s ease-in-out infinite",
                            }} />
                          )}
                        </div>
                      </div>
                      {/* Info */}
                      <div style={{ textAlign:"center", marginBottom:10 }}>
                        <div style={{ fontSize:11,color:"#888",fontWeight:600,letterSpacing:1 }}>#{String(pokemon.dexNumber).padStart(3,"0")}</div>
                        <div style={{ fontSize:24,fontWeight:800,color:"#fff",marginBottom:2,textTransform:"capitalize" }}>{pokemon.name.replace(/-/g," ")}</div>
                        {pokemon.genus && <div style={{ fontSize:12,color:"#aaa",fontStyle:"italic",marginBottom:8 }}>{pokemon.genus}</div>}
                        <div style={{ display:"flex",gap:6,flexWrap:"wrap",justifyContent:"center" }}>
                          {pokemon.types.map(t => <TypeBadge key={t} type={t} />)}
                        </div>
                      </div>
                      {/* Description */}
                      <div style={{
                        background:"rgba(255,255,255,0.07)", borderRadius:8,
                        padding:"10px 12px", fontSize:13, lineHeight:1.6, color:"#ccc",
                        borderLeft:`3px solid ${typeColors[pokemon.types[0]]||"#888"}`,
                      }}>{pokemon.description}</div>
                      {/* Speaker */}
                      <div style={{ marginTop:10,minHeight:20,display:"flex",justifyContent:"center" }}>
                        {speaking ? <SpeakingWaveform /> : audioOn ? (
                          <button onClick={() => speakPokedex(pokemon)} style={{
                            background:"none",border:"1px solid #00BFFF44",color:"#00BFFF",borderRadius:12,
                            padding:"4px 12px",fontSize:11,cursor:"pointer",fontWeight:600,letterSpacing:0.5,
                          }}>🔊 Replay Entry</button>
                        ) : (
                          <div style={{ fontSize:10, color:"#555", fontStyle:"italic" }}>Audio off — toggle on device to enable</div>
                        )}
                      </div>
                      {/* Swipe hint */}
                      <div style={{ textAlign:"center", marginTop:8, fontSize:10, color:"#555" }}>
                        Tap <span style={{ color:"#FFD700" }}>Card Info</span> for rarity & value →
                      </div>
                    </div>
                  )}

                  {/* CARD INFO TAB */}
                  {resultTab === "card" && (
                    <div style={{ padding:16, animation:"slideInRight 0.3s ease", minHeight:200 }}>
                      {cardData ? (
                        <div style={{ animation:"fadeIn 0.4s ease" }}>
                          {/* Card header */}
                          <div style={{ textAlign:"center", marginBottom:12 }}>
                            <div style={{ fontSize:18, fontWeight:800, color:"#fff", textTransform:"capitalize", marginBottom:2 }}>
                              {pokemon.name.replace(/-/g," ")}
                            </div>
                            {cardData.setName && (
                              <div style={{ fontSize:11, color:"#aaa" }}>{cardData.setName}{cardData.cardNumber ? ` · #${cardData.cardNumber}` : ""}</div>
                            )}
                          </div>
                          {/* Rarity & Price */}
                          <div style={{ display:"flex", gap:8, marginBottom:12 }}>
                            <div style={{ flex:1, background:"rgba(255,255,255,0.05)", borderRadius:8, padding:"12px 10px", textAlign:"center" }}>
                              <div style={{ fontSize:10, color:"#888", fontWeight:600, letterSpacing:0.5, marginBottom:4, textTransform:"uppercase" }}>Rarity</div>
                              <div style={{
                                fontSize:15, fontWeight:700,
                                color: cardData.rarity.includes("Rare") ? "#FFD700" : cardData.rarity.includes("Uncommon") ? "#C0C0C0" : cardData.rarity === "Common" ? "#CD7F32" : "#aaa",
                              }}>
                                {cardData.rarity.includes("Illustration") ? "★★★ " + cardData.rarity
                                  : cardData.rarity === "Rare Holo" ? "★ Rare Holo"
                                  : cardData.rarity.includes("Ultra") || cardData.rarity.includes("EX") || cardData.rarity.includes("GX") || cardData.rarity.includes(" V") ? "★★ " + cardData.rarity
                                  : cardData.rarity.includes("VMAX") || cardData.rarity.includes("Secret") || cardData.rarity.includes("Rainbow") ? "★★★ " + cardData.rarity
                                  : cardData.rarity}
                              </div>
                            </div>
                            <div style={{ flex:1, background:"rgba(255,255,255,0.05)", borderRadius:8, padding:"12px 10px", textAlign:"center" }}>
                              <div style={{ fontSize:10, color:"#888", fontWeight:600, letterSpacing:0.5, marginBottom:4, textTransform:"uppercase" }}>Market Value</div>
                              <div style={{
                                fontSize:22, fontWeight:800,
                                color: cardData.marketPrice >= 50 ? "#FFD700" : cardData.marketPrice >= 10 ? "#66BB6A" : cardData.marketPrice ? "#fff" : "#666",
                              }}>
                                {cardData.marketPrice ? `$${cardData.marketPrice.toFixed(2)}` : "N/A"}
                              </div>
                              <div style={{ fontSize:9, color:"#666", marginTop:2 }}>TCGplayer Market</div>
                            </div>
                          </div>
                          {/* TCGplayer link */}
                          {cardData.tcgplayerUrl && (
                            <a href={cardData.tcgplayerUrl} target="_blank" rel="noopener noreferrer"
                              style={{
                                display:"block", textAlign:"center",
                                background:"linear-gradient(180deg, #1a5c9e 0%, #0d3b6e 100%)",
                                color:"#fff", padding:"10px 16px", borderRadius:8,
                                fontSize:13, fontWeight:700, letterSpacing:0.5,
                                textDecoration:"none", boxShadow:"0 2px 8px rgba(0,0,0,0.3)",
                              }}>
                              View on TCGplayer →
                            </a>
                          )}
                        </div>
                      ) : (
                        /* Card data loading state */
                        <div style={{ textAlign:"center", paddingTop:20 }}>
                          {/* Card flip animation */}
                          <div style={{ margin:"0 auto 16px", width:60, height:80, perspective:200 }}>
                            <div style={{
                              width:"100%", height:"100%", borderRadius:6,
                              background:"linear-gradient(135deg, #FFD700 0%, #FFA500 50%, #FFD700 100%)",
                              animation:"cardSpin 2s ease-in-out infinite",
                              boxShadow:"0 4px 12px rgba(0,0,0,0.3)",
                              display:"flex", alignItems:"center", justifyContent:"center",
                            }}>
                              <div style={{ fontSize:24 }}>🃏</div>
                            </div>
                          </div>
                          <div style={{ fontSize:14, fontWeight:700, color:"#2a4a2a", marginBottom:4 }}>
                            SEARCHING CARD DATABASE...
                          </div>
                          <div style={{ fontSize:11, color:"#4a6a4a", marginBottom:12 }}>
                            Matching card to TCGplayer listings...
                          </div>
                          {/* Progress bar */}
                          <div style={{ maxWidth:200, margin:"0 auto", height:5, background:"rgba(255,255,255,0.1)", borderRadius:3, overflow:"hidden" }}>
                            <div style={{
                              height:"100%", borderRadius:3,
                              background:"linear-gradient(90deg, #FFD700, #FFA500)",
                              width:"60%",
                              animation:"progressPulse 1.5s ease-in-out infinite",
                            }} />
                          </div>
                        </div>
                      )}
                      {/* Back hint */}
                      <div style={{ textAlign:"center", marginTop:12, fontSize:10, color:"#555" }}>
                        ← Tap <span style={{ color:"#00BFFF" }}>Pokédex</span> for entry details
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ERROR */}
              {stage === "error" && (
                <div style={{ textAlign:"center", padding:24, animation:"fadeIn 0.3s ease", width:"100%" }}>
                  <div style={{ fontSize:36,marginBottom:8 }}>⚠️</div>
                  <div style={{ fontSize:12,color:"#5a3a2a",lineHeight:1.5,maxWidth:260,margin:"0 auto 16px",wordBreak:"break-word" }}>{error}</div>
                  <div style={{ position:"relative", maxWidth:240, margin:"0 auto" }}>
                    <input type="text" value={searchQuery} placeholder="Try searching by name..."
                      onChange={e => handleSearch(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && searchQuery) lookupPokemon(searchQuery); }}
                      style={{
                        width:"100%",padding:"8px 12px",borderRadius:16,
                        border:"2px solid #8a6a5a",background:"rgba(255,255,255,0.85)",
                        fontSize:13,outline:"none",color:"#2a4a2a",fontWeight:500,boxSizing:"border-box",
                      }}
                    />
                    {suggestions.length > 0 && (
                      <div style={{
                        position:"absolute",top:"100%",left:0,right:0,zIndex:10,
                        background:"#fff",borderRadius:10,marginTop:4,
                        boxShadow:"0 8px 24px rgba(0,0,0,0.2)",overflow:"hidden",
                      }}>
                        {suggestions.map(p => (
                          <div key={p.name} onClick={() => { setSearchQuery(""); lookupPokemon(p.name); }}
                            style={{ padding:"7px 12px",cursor:"pointer",borderBottom:"1px solid #eee",
                              fontSize:12,color:"#333",fontWeight:500,textTransform:"capitalize" }}
                            onMouseEnter={e => e.currentTarget.style.background="#f0f8f0"}
                            onMouseLeave={e => e.currentTarget.style.background="#fff"}
                          >{p.name.replace(/-/g," ")}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Controls */}
          <div style={{ marginTop:16, display:"flex", justifyContent:"center", gap:8, flexWrap:"wrap" }}>
            {stage === "idle" && (
              <>
                <button onClick={startCamera} style={btnStyle("#444","#222","#555","#fff")}>📷 Camera</button>
                <button onClick={() => fileInputRef.current?.click()} style={btnStyle("#3a3a5a","#22223a","#4a4a6a","#ccc")}>🖼️ Upload</button>
              </>
            )}
            {stage === "camera" && (
              <>
                <button onClick={captureAndScan} style={btnStyle("#44CC66","#22AA44","#33BB55","#fff")}>⚡ Capture</button>
                <button onClick={() => { stopCamera(); setStage("idle"); }} style={btnStyle("#666","#444","#555","#ccc")}>Cancel</button>
              </>
            )}
            {(stage === "result" || stage === "error") && (
              <button onClick={reset} style={btnStyle("#444","#222","#555","#fff")}>🔄 New Search</button>
            )}
          </div>

          {/* D-pad */}
          <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
            <div style={{ position:"relative", width:60, height:60 }}>
              {[{top:0,left:18,w:24,h:20},{top:40,left:18,w:24,h:20},{top:18,left:0,w:20,h:24},{top:18,left:40,w:20,h:24},{top:18,left:18,w:24,h:24}]
                .map((s,i) => <div key={i} style={{ position:"absolute",top:s.top,left:s.left,width:s.w,height:s.h,
                  background:"linear-gradient(180deg,#333 0%,#1a1a1a 100%)",borderRadius:2 }} />)}
            </div>
          </div>
        </div>
        <div style={{ height:8, background:POKEDEX_DARKER }} />
      </div>
    </div>
  );
}

function btnStyle(from, to, border, color) {
  return {
    background: `linear-gradient(180deg, ${from} 0%, ${to} 100%)`,
    color, border: `2px solid ${border}`, borderRadius: 30,
    padding: "10px 20px", fontSize: 12, fontWeight: 700, cursor: "pointer",
    boxShadow: "0 4px 12px rgba(0,0,0,0.4)", letterSpacing: 1, textTransform: "uppercase",
  };
}
