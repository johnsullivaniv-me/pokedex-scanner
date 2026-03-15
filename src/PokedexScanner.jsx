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
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
      if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    };
  }, [cameraStream]);

  // ─── Voice ───
  const getRoboticVoice = useCallback(() => {
    const voices = window.speechSynthesis.getVoices();
    const preferred = ["Google UK English Male","Microsoft David","Microsoft Mark","Daniel","Alex","Google US English"];
    for (const name of preferred) {
      const v = voices.find(voice => voice.name.includes(name));
      if (v) return v;
    }
    return voices.find(v => v.lang.startsWith("en")) || voices[0] || null;
  }, []);

  const speakPokedex = useCallback((entry) => {
    window.speechSynthesis.cancel();
    const doSpeak = () => {
      const text = `${entry.name}. Number ${entry.dexNumber}. ${entry.genus}. Type: ${entry.types.join(" and ")}. ${entry.description}`;
      const u = new SpeechSynthesisUtterance(text);
      const voice = getRoboticVoice();
      if (voice) u.voice = voice;
      u.rate = 0.95; u.pitch = 0.75; u.volume = 1;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    };
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = doSpeak;
    } else { doSpeak(); }
  }, [getRoboticVoice]);

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
  const fetchCardData = useCallback(async (pokemonName, cardNumber = null) => {
    try {
      const url = `https://api.pokemontcg.io/v2/cards?q=name:"${encodeURIComponent(pokemonName)}"&orderBy=-tcgplayer.prices.holofoil.market&pageSize=10`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.data || data.data.length === 0) return null;
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

  const lookupPokemon = useCallback(async (name, cardNumber = null) => {
    setStage("scanning"); setError(""); setSuggestions([]); setCardData(null);
    try {
      // Fire both API calls in parallel
      const displayName = name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("-");
      const [entry, tcgData] = await Promise.all([
        fetchFromPokeAPI(name),
        fetchCardData(displayName, cardNumber),
      ]);
      if (entry) {
        setPokemon(entry); setStage("result"); speakPokedex(entry);
        if (tcgData) setCardData(tcgData);
        // If TCG didn't match on display name, try the raw name
        if (!tcgData) {
          fetchCardData(entry.name, cardNumber).then(cd => { if (cd) setCardData(cd); });
        }
      } else {
        setError(`Couldn't find "${name}" in the Pokédex.`); setStage("error");
      }
    } catch {
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
    try {
      const res = await fetch("/api/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mimeType })
      });
      const data = await res.json();
      if (!data.name || data.name === "unknown") {
        const debugMsg = data.debug ? ` (${data.debug})` : "";
        setError(`Couldn't identify a Pokémon in that image.${debugMsg} Try another angle or search by name.`);
        setStage("error");
        return;
      }
      await lookupPokemon(data.name, data.cardNumber || null);
    } catch (e) {
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
    stopCamera(); setPokemon(null); setCardData(null); setError("");
    setSearchQuery(""); setSuggestions([]); setStage("idle");
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
                <div style={{ textAlign:"center", padding:30, animation:"fadeIn 0.3s ease" }}>
                  <div style={{ width:36,height:36,margin:"0 auto 12px", border:"3px solid #2a4a2a",borderTop:"3px solid transparent",
                    borderRadius:"50%",animation:"spin 0.8s linear infinite" }} />
                  <div style={{ fontSize:14,fontWeight:700,color:"#2a4a2a" }}>ANALYZING...</div>
                  <div style={{ fontSize:11,color:"#4a6a4a",marginTop:4 }}>Looking up Pokédex entry</div>
                </div>
              )}

              {/* RESULT */}
              {stage === "result" && pokemon && (
                <div style={{ width:"100%", padding:16, animation:"fadeIn 0.5s ease", color:"#e0e0e0" }}>
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
                  {/* Card Data */}
                  {cardData ? (
                    <div style={{ marginTop:8, animation:"fadeIn 0.4s ease" }}>
                      <div style={{ display:"flex", gap:8 }}>
                        <div style={{ flex:1, background:"rgba(255,255,255,0.05)", borderRadius:8, padding:"8px 10px", textAlign:"center" }}>
                          <div style={{ fontSize:10, color:"#888", fontWeight:600, letterSpacing:0.5, marginBottom:3, textTransform:"uppercase" }}>Rarity</div>
                          <div style={{
                            fontSize:13, fontWeight:700,
                            color: cardData.rarity.includes("Rare") ? "#FFD700" : cardData.rarity.includes("Uncommon") ? "#C0C0C0" : cardData.rarity === "Common" ? "#CD7F32" : "#aaa",
                          }}>
                            {cardData.rarity.includes("Illustration") ? "★★★ " + cardData.rarity
                              : cardData.rarity === "Rare Holo" ? "★ Rare Holo"
                              : cardData.rarity.includes("Ultra") || cardData.rarity.includes("EX") || cardData.rarity.includes("GX") || cardData.rarity.includes(" V") ? "★★ " + cardData.rarity
                              : cardData.rarity.includes("VMAX") || cardData.rarity.includes("Secret") || cardData.rarity.includes("Rainbow") ? "★★★ " + cardData.rarity
                              : cardData.rarity}
                          </div>
                        </div>
                        <div style={{ flex:1, background:"rgba(255,255,255,0.05)", borderRadius:8, padding:"8px 10px", textAlign:"center" }}>
                          <div style={{ fontSize:10, color:"#888", fontWeight:600, letterSpacing:0.5, marginBottom:3, textTransform:"uppercase" }}>Market Value</div>
                          <div style={{
                            fontSize:13, fontWeight:700,
                            color: cardData.marketPrice >= 50 ? "#FFD700" : cardData.marketPrice >= 10 ? "#66BB6A" : cardData.marketPrice ? "#aaa" : "#666",
                          }}>
                            {cardData.marketPrice ? `$${cardData.marketPrice.toFixed(2)}` : "N/A"}
                          </div>
                          <div style={{ fontSize:9, color:"#666", marginTop:1 }}>TCGplayer</div>
                        </div>
                      </div>
                      {cardData.tcgplayerUrl && (
                        <a href={cardData.tcgplayerUrl} target="_blank" rel="noopener noreferrer"
                          style={{
                            display:"block", marginTop:8, textAlign:"center",
                            background:"linear-gradient(180deg, #1a5c9e 0%, #0d3b6e 100%)",
                            color:"#fff", padding:"8px 16px", borderRadius:8,
                            fontSize:12, fontWeight:700, letterSpacing:0.5,
                            textDecoration:"none",
                            boxShadow:"0 2px 8px rgba(0,0,0,0.3)",
                          }}>
                          View on TCGplayer →{cardData.setName ? ` (${cardData.setName})` : ""}
                        </a>
                      )}
                    </div>
                  ) : stage === "result" && (
                    <div style={{ marginTop:8, textAlign:"center", fontSize:10, color:"#555", fontStyle:"italic" }}>Loading card market data...</div>
                  )}
                  {/* Speaker */}
                  <div style={{ marginTop:10,minHeight:20,display:"flex",justifyContent:"center" }}>
                    {speaking ? <SpeakingWaveform /> : (
                      <button onClick={() => speakPokedex(pokemon)} style={{
                        background:"none",border:"1px solid #00BFFF44",color:"#00BFFF",borderRadius:12,
                        padding:"4px 12px",fontSize:11,cursor:"pointer",fontWeight:600,letterSpacing:0.5,
                      }}>🔊 Replay Entry</button>
                    )}
                  </div>
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
