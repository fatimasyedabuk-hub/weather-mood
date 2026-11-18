// =========================================================
// Weather Mood — live weather data drives visuals, motion & sound
// API: Open-Meteo (free, no API key, CORS-enabled)
// =========================================================

const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const REFRESH_MS = 10 * 60 * 1000; // re-fetch every 10 minutes

// ---------- DOM references ----------
const $ = (id) => document.getElementById(id);
const els = {
  status: $("status"), weather: $("weather"), place: $("place"),
  localTime: $("local-time"), icon: $("icon"), temp: $("temp"),
  desc: $("desc"), feels: $("feels"), humidity: $("humidity"),
  wind: $("wind"), clouds: $("clouds"), precip: $("precip"),
  mood: $("mood"), updated: $("updated"), sound: $("sound"),
  flash: $("flash"), form: $("search"), city: $("city"), locate: $("locate"),
};

// Current state shared by the animation + audio loops
let state = {
  type: "clear", temp: 15, wind: 5, windDir: 270, clouds: 0,
  precip: 0, isDay: 1, thunder: false,
};
let currentLocation = null;
let refreshTimer = null;

// ---------- Weather code lookup (WMO codes) ----------
function describe(code) {
  if (code === 0) return { text: "Clear sky", icon: "☀️", type: "clear" };
  if (code <= 2) return { text: "Partly cloudy", icon: "⛅", type: "cloudy" };
  if (code === 3) return { text: "Overcast", icon: "☁️", type: "cloudy" };
  if (code <= 48) return { text: "Fog", icon: "🌫️", type: "fog" };
  if (code <= 57) return { text: "Drizzle", icon: "🌦️", type: "rain" };
  if (code <= 67) return { text: "Rain", icon: "🌧️", type: "rain" };
  if (code <= 77) return { text: "Snow", icon: "❄️", type: "snow" };
  if (code <= 82) return { text: "Rain showers", icon: "🌧️", type: "rain" };
  if (code <= 86) return { text: "Snow showers", icon: "🌨️", type: "snow" };
  return { text: "Thunderstorm", icon: "⛈️", type: "storm" };
}

// ---------- Fetching ----------
async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

async function searchCity(name) {
  const data = await getJSON(`${GEO_URL}?name=${encodeURIComponent(name)}&count=1&language=en`);
  if (!data.results || data.results.length === 0) throw new Error(`Couldn't find "${name}"`);
  const r = data.results[0];
  return { name: [r.name, r.admin1, r.country].filter(Boolean).join(", "), lat: r.latitude, lon: r.longitude };
}

async function loadWeather(loc) {
  currentLocation = loc;
  els.status.hidden = false;
  els.status.className = "";
  els.status.textContent = `Fetching live weather for ${loc.name}…`;

  const params = new URLSearchParams({
    latitude: loc.lat,
    longitude: loc.lon,
    current: [
      "temperature_2m", "apparent_temperature", "relative_humidity_2m",
      "is_day", "precipitation", "weather_code", "cloud_cover",
      "wind_speed_10m", "wind_direction_10m",
    ].join(","),
    timezone: "auto",
  });

  try {
    const data = await getJSON(`${WEATHER_URL}?${params}`);
    render(loc, data);
  } catch (err) {
    els.status.textContent = `⚠️ ${err.message}. Try again in a moment.`;
    els.status.className = "error";
  }

  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => loadWeather(currentLocation), REFRESH_MS);
}

// ---------- DOM updates driven by the data ----------
function render(loc, data) {
  const c = data.current;
  const info = describe(c.weather_code);

  els.status.hidden = true;
  els.weather.hidden = false;
  els.place.textContent = loc.name;
  els.localTime.textContent = `Local time: ${new Date(c.time).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`;
  els.icon.textContent = c.is_day || info.type !== "clear" ? info.icon : "🌙";
  els.temp.textContent = `${Math.round(c.temperature_2m)}°C`;
  els.desc.textContent = info.text;
  els.feels.textContent = `${Math.round(c.apparent_temperature)}°C`;
  els.humidity.textContent = `${c.relative_humidity_2m}%`;
  els.wind.textContent = `${Math.round(c.wind_speed_10m)} km/h ${compass(c.wind_direction_10m)}`;
  els.clouds.textContent = `${c.cloud_cover}%`;
  els.precip.textContent = `${c.precipitation} mm`;
  els.updated.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  document.title = `${Math.round(c.temperature_2m)}° ${info.icon} ${loc.name} — Weather Mood`;

  state = {
    type: info.type,
    temp: c.temperature_2m,
    wind: c.wind_speed_10m,
    windDir: c.wind_direction_10m,
    clouds: c.cloud_cover,
    precip: c.precipitation,
    isDay: c.is_day,
    thunder: info.type === "storm",
  };

  els.mood.textContent = moodLine(state);
  applyColours(state);
  buildParticles();
  updateAudio();
}

function compass(deg) {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}

function moodLine(s) {
  if (s.thunder) return "The sky is restless tonight. Stay in, turn the sound up.";
  if (s.type === "snow") return "Soft and quiet — the world is muffled in white.";
  if (s.type === "rain") return "A grey, rhythmic kind of day. Good for thinking.";
  if (s.type === "fog") return "Everything feels a little far away.";
  if (s.temp >= 28) return "Heavy, golden heat. Move slowly.";
  if (s.temp <= -5) return "Sharp, glassy cold. Every breath shows.";
  if (s.wind > 30) return "The wind has opinions today.";
  if (!s.isDay) return "A calm night sky.";
  return "Bright and easy. A good day to be outside.";
}

// Temperature → hue (cold = blue/violet, hot = orange/red); night & clouds darken it
function applyColours(s) {
  const t = Math.max(-20, Math.min(40, s.temp));
  const hue = 230 - ((t + 20) / 60) * 210; // 230 (blue) → 20 (orange)
  const grey = s.clouds / 100;              // clouds desaturate
  const sat = 65 - grey * 45;
  let light = s.isDay ? 55 : 14;
  if (s.type === "storm") light -= 15;

  const top = `hsl(${hue + 15}, ${sat}%, ${Math.max(6, light - 20)}%)`;
  const bottom = `hsl(${hue}, ${sat}%, ${light}%)`;
  const root = document.documentElement.style;
  root.setProperty("--sky-top", top);
  root.setProperty("--sky-bottom", bottom);
  root.setProperty("--accent", `hsl(${hue}, 90%, 75%)`);
  document.body.style.background = `linear-gradient(180deg, ${top}, ${bottom})`;
  document.body.style.backgroundAttachment = "fixed";
}

// ---------- Canvas animation (particles depend on weather) ----------
const canvas = $("sky");
const ctx = canvas.getContext("2d");
let particles = [];
let lastFlash = 0;

function resize() {
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
addEventListener("resize", () => { resize(); buildParticles(); });
resize();

function buildParticles() {
  const area = innerWidth * innerHeight;
  let count;
  switch (state.type) {
    case "rain": case "storm": count = Math.min(600, 150 + state.precip * 120); break;
    case "snow": count = Math.min(400, 120 + state.precip * 80); break;
    case "fog": count = 25; break;
    case "cloudy": count = Math.round(4 + state.clouds / 12); break;
    default: count = state.isDay ? 30 : 160; // dust motes by day, stars by night
  }
  count = Math.round(count * Math.min(1.5, area / (1280 * 800)));
  particles = Array.from({ length: count }, () => newParticle(true));
}

function newParticle(randomY) {
  const w = innerWidth, h = innerHeight;
  return {
    x: Math.random() * w,
    y: randomY ? Math.random() * h : -20,
    size: Math.random(),
    speed: 0.5 + Math.random(),
    phase: Math.random() * Math.PI * 2,
  };
}

// Wind blowing *from* the west (270°) pushes particles to the right
function windX() {
  const rad = (state.windDir * Math.PI) / 180;
  return -Math.sin(rad) * (state.wind / 6);
}

function draw(time) {
  const w = innerWidth, h = innerHeight;
  ctx.clearRect(0, 0, w, h);
  const wx = windX();

  for (const p of particles) {
    switch (state.type) {
      case "rain":
      case "storm": {
        const vy = 9 + p.speed * 8;
        p.x += wx; p.y += vy;
        ctx.strokeStyle = `rgba(200,220,255,${0.25 + p.size * 0.4})`;
        ctx.lineWidth = 1 + p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - wx * 1.5, p.y - vy * 1.6);
        ctx.stroke();
        break;
      }
      case "snow": {
        p.x += wx * 0.5 + Math.sin(time / 1000 + p.phase) * 0.6;
        p.y += 0.6 + p.speed;
        ctx.fillStyle = `rgba(255,255,255,${0.5 + p.size * 0.5})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5 + p.size * 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "fog":
      case "cloudy": {
        p.x += (wx * 0.15 || 0.2) + p.speed * 0.15;
        const r = 120 + p.size * 220;
        const alpha = state.type === "fog" ? 0.08 : 0.05 + state.clouds / 2000;
        const g = ctx.createRadialGradient(p.x, p.y * 0.6, 0, p.x, p.y * 0.6, r);
        g.addColorStop(0, `rgba(255,255,255,${alpha})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(p.x - r, p.y * 0.6 - r, r * 2, r * 2);
        if (p.x - r > w) { p.x = -r; }
        if (p.x + r < 0) { p.x = w + r; }
        continue;
      }
      default: {
        if (state.isDay) {
          // floating sunlit dust
          p.x += wx * 0.2 + Math.sin(time / 2000 + p.phase) * 0.3;
          p.y -= 0.15 * p.speed;
          ctx.fillStyle = `rgba(255,240,200,${0.15 + p.size * 0.25})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1 + p.size * 2.5, 0, Math.PI * 2);
          ctx.fill();
          if (p.y < -10) p.y = h + 10;
        } else {
          // twinkling stars (static)
          const tw = 0.4 + 0.6 * Math.abs(Math.sin(time / 900 + p.phase));
          ctx.fillStyle = `rgba(255,255,255,${tw * (0.3 + p.size * 0.7)})`;
          ctx.fillRect(p.x, p.y * 0.75, 1 + p.size * 1.5, 1 + p.size * 1.5);
        }
        continue;
      }
    }
    // recycle falling particles
    if (p.y > h + 20 || p.x > w + 50 || p.x < -50) {
      Object.assign(p, newParticle(false));
      if (wx > 0) p.x -= wx * 40;
    }
  }

  // sun glow on clear days
  if (state.type === "clear" && state.isDay) {
    const g = ctx.createRadialGradient(w * 0.85, h * 0.12, 0, w * 0.85, h * 0.12, 260);
    g.addColorStop(0, "rgba(255,240,180,0.55)");
    g.addColorStop(1, "rgba(255,240,180,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // random lightning during thunderstorms
  if (state.thunder && time - lastFlash > 4000 && Math.random() < 0.006) {
    lastFlash = time;
    lightning();
  }

  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

function lightning() {
  els.flash.style.transition = "none";
  els.flash.style.opacity = "0.7";
  requestAnimationFrame(() => {
    els.flash.style.transition = "opacity 0.6s ease-out";
    els.flash.style.opacity = "0";
  });
  if (audio) thunderRumble();
}

// ---------- Web Audio: a generative soundscape from the data ----------
let audio = null; // created on first click (browsers block autoplay)

function initAudio() {
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const master = ac.createGain();
  master.gain.value = 0;
  master.connect(ac.destination);

  // Drone: three oscillators forming a chord
  const droneGain = ac.createGain();
  droneGain.gain.value = 0.12;
  const droneFilter = ac.createBiquadFilter();
  droneFilter.type = "lowpass";
  droneFilter.frequency.value = 900;
  droneGain.connect(droneFilter).connect(master);
  const oscs = [0, 1, 2].map((i) => {
    const o = ac.createOscillator();
    o.type = i === 0 ? "sine" : "triangle";
    o.connect(droneGain);
    o.start();
    return o;
  });

  // Noise: wind + rain texture
  const buffer = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const noiseFilter = ac.createBiquadFilter();
  noiseFilter.type = "bandpass";
  const noiseGain = ac.createGain();
  noise.connect(noiseFilter).connect(noiseGain).connect(master);
  noise.start();

  // Slow LFO makes the wind "gust"
  const lfo = ac.createOscillator();
  const lfoGain = ac.createGain();
  lfo.frequency.value = 0.15;
  lfo.connect(lfoGain).connect(noiseGain.gain);
  lfo.start();

  audio = { ac, master, oscs, droneFilter, noiseFilter, noiseGain, lfoGain, buffer, on: false };
}

function updateAudio() {
  if (!audio) return;
  const { ac, oscs, droneFilter, noiseFilter, noiseGain, lfoGain } = audio;
  const now = ac.currentTime;

  // Temperature sets the root pitch: colder = lower
  const t = Math.max(-20, Math.min(40, state.temp));
  const root = 110 * Math.pow(2, ((t + 20) / 60) * 1.5); // ~110 Hz → ~311 Hz
  // Clear = major chord, wet/grey = minor, storm = tense (tritone)
  const third = state.type === "clear" ? 5 / 4 : 6 / 5;
  const fifth = state.thunder ? Math.SQRT2 : 3 / 2;
  [1, third, fifth].forEach((ratio, i) => oscs[i].frequency.setTargetAtTime(root * ratio, now, 1.5));

  // Clouds muffle the drone
  droneFilter.frequency.setTargetAtTime(1800 - state.clouds * 14, now, 1);

  // Wind + rain loudness & colour of the noise
  const wet = state.type === "rain" || state.type === "storm";
  const level = Math.min(0.35, state.wind / 150 + (wet ? 0.08 + state.precip * 0.03 : 0));
  noiseGain.gain.setTargetAtTime(level, now, 1);
  lfoGain.gain.setTargetAtTime(level * 0.6, now, 1);
  noiseFilter.frequency.setTargetAtTime(wet ? 2500 : state.type === "snow" ? 600 : 400 + state.wind * 15, now, 1);
  noiseFilter.Q.value = wet ? 0.5 : 1.2;
}

function thunderRumble() {
  const { ac, master, buffer } = audio;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const f = ac.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 120;
  const g = ac.createGain();
  const now = ac.currentTime + 0.4; // thunder arrives just after the flash
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(1.2, now + 0.15);
  g.gain.exponentialRampToValueAtTime(0.001, now + 3);
  src.connect(f).connect(g).connect(master);
  src.start(now);
  src.stop(now + 3.2);
}

els.sound.addEventListener("click", async () => {
  if (!audio) { initAudio(); updateAudio(); }
  await audio.ac.resume();
  audio.on = !audio.on;
  audio.master.gain.setTargetAtTime(audio.on ? 0.8 : 0, audio.ac.currentTime, 0.5);
  els.sound.textContent = audio.on ? "🔊 Sound on — tap to mute" : "🔈 Play the weather";
  els.sound.classList.toggle("on", audio.on);
});

// ---------- User interaction ----------
async function goToCity(name) {
  try {
    els.status.hidden = false;
    els.status.className = "";
    els.status.textContent = `Searching for ${name}…`;
    const loc = await searchCity(name);
    loadWeather(loc);
  } catch (err) {
    els.status.hidden = false;
    els.status.textContent = `⚠️ ${err.message}`;
    els.status.className = "error";
  }
}

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = els.city.value.trim();
  if (name) goToCity(name);
});

document.querySelectorAll(".quick button").forEach((btn) =>
  btn.addEventListener("click", () => goToCity(btn.dataset.city))
);

els.locate.addEventListener("click", () => {
  if (!navigator.geolocation) return goToCity("Toronto");
  els.status.hidden = false;
  els.status.textContent = "Finding your location…";
  navigator.geolocation.getCurrentPosition(
    (pos) => loadWeather({ name: "Your location", lat: pos.coords.latitude, lon: pos.coords.longitude }),
    () => { els.status.textContent = "Location blocked — showing Toronto instead."; goToCity("Toronto"); }
  );
});

// Start with Toronto
goToCity("Toronto");
