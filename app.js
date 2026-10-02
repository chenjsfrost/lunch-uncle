const $ = (sel) => document.querySelector(sel);
const app = $('.app');
const chat = $('#chat');
const form = $('#composer');
const input = $('#input');
const headerStatus = $('#header-status');
const voiceToggle = $('#voice-toggle');
const uncleTemplate = $('#uncle-template');

const history = [];
let busy = false;
let voiceOn = true;
let speakingAvatar = null;

// ---------- avatar ----------
function makeUncle(size) {
  const el = document.createElement('div');
  el.className = `uncle uncle--${size}`;
  el.appendChild(uncleTemplate.content.firstElementChild.cloneNode(true));
  return el;
}
const headerUncle = $('#header-uncle');
headerUncle.appendChild(uncleTemplate.content.firstElementChild.cloneNode(true));

function setUncleState(el, state) {
  if (!el) return;
  el.classList.toggle('thinking', state === 'thinking');
  el.classList.toggle('talking', state === 'talking');
}

// ---------- location (exposed to the agent as a tool) ----------
let locationPromise = null;
function getLocation() {
  const fallback = { lat: 1.3521, lng: 103.8198, label: 'somewhere in Singapore (approx.)' };
  if (!locationPromise) {
    locationPromise = new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(fallback);
      const timer = setTimeout(() => resolve(fallback), 5000);
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          clearTimeout(timer);
          resolve({ lat: coords.latitude, lng: coords.longitude, label: `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}` });
        },
        () => { clearTimeout(timer); resolve(fallback); },
        { timeout: 5000, maximumAge: 600000 },
      );
    });
  }
  return locationPromise;
}

// ---------- messages ----------
function scrollToBottom() {
  chat.scrollTop = chat.scrollHeight;
}

function addUserMsg(text) {
  const row = document.createElement('div');
  row.className = 'msg msg--user';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  row.appendChild(bubble);
  chat.appendChild(row);
  scrollToBottom();
}

function placeCard(p, i) {
  const card = document.createElement('div');
  card.className = 'place';
  const dist = p.distance < 1000 ? `${p.distance} m` : `${(p.distance / 1000).toFixed(1)} km`;
  card.innerHTML = `
    <div class="place__top"><span></span><span class="badge ${p.open ? '' : 'badge--closed'}">${p.open ? 'Open now' : 'Closed'}</span></div>
    <div class="place__meta">⭐ ${p.rating} · ${p.price} · ${dist} away</div>
    <p class="place__note"></p>
    <button class="place__go" type="button">Bring me there →</button>`;
  const title = card.querySelector('.place__top span');
  title.innerHTML = `<span class="place__num">${i + 1}</span>`;
  title.append(p.name);
  card.querySelector('.place__note').textContent = p.note;
  card.querySelector('.place__go').addEventListener('click', () => openNav(p));
  return card;
}

function addUncleMsg(text, places = [], origin = null) {
  const row = document.createElement('div');
  row.className = 'msg msg--uncle';
  const avatar = makeUncle('small');
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  if (places.length) {
    const list = document.createElement('div');
    list.className = 'places';
    const mapEl = origin && placesMap(places, origin);
    if (mapEl) list.appendChild(mapEl);
    places.forEach((p, i) => list.appendChild(placeCard(p, i)));
    bubble.appendChild(list);
  }
  row.append(avatar, bubble);
  chat.appendChild(row);
  row.querySelectorAll('.places-map').forEach((el) => el.render());
  scrollToBottom();
  return avatar;
}

function showThinking() {
  const row = document.createElement('div');
  row.className = 'msg msg--uncle thinking';
  const avatar = makeUncle('small');
  setUncleState(avatar, 'thinking');
  row.appendChild(avatar);
  row.insertAdjacentHTML('beforeend', `
    <div class="bubble">
      <div class="thinking__status">
        <span class="kopi">☕<span class="steam"><span></span><span></span><span></span></span></span>
        <span class="thinking__text"></span>
        <span class="dots"><span></span><span></span><span></span></span>
      </div>
      <ul class="steps"></ul>
    </div>`);
  chat.appendChild(row);
  scrollToBottom();

  const textEl = row.querySelector('.thinking__text');
  const stepsEl = row.querySelector('.steps');
  const steps = new Map();
  return {
    setStatus(text) {
      textEl.textContent = text;
      headerStatus.textContent = text;
    },
    addStep(id, label) {
      const li = document.createElement('li');
      li.className = 'step';
      li.textContent = label;
      stepsEl.appendChild(li);
      steps.set(id, li);
      scrollToBottom();
    },
    completeStep(id, summary) {
      const li = steps.get(id);
      if (!li) return;
      li.classList.add('done');
      if (summary) li.textContent = summary;
    },
    remove() { row.remove(); },
  };
}

// ---------- uncle voice ----------
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  return (
    voices.find((v) => /en[-_]SG/i.test(v.lang)) ||
    voices.find((v) => /Daniel|Aaron|Rishi|Fred|Google UK English Male|Male/i.test(v.name)) ||
    voices.find((v) => v.lang.startsWith('en')) ||
    null
  );
}

function speak(text, avatar) {
  if (!voiceOn || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text.replace(/\p{Extended_Pictographic}/gu, ''));
  utter.voice = pickVoice();
  utter.pitch = 0.75; // deeper, older-sounding
  utter.rate = 0.95;
  speakingAvatar = avatar;
  utter.onstart = () => { setUncleState(headerUncle, 'talking'); setUncleState(avatar, 'talking'); };
  utter.onend = utter.onerror = () => { setUncleState(headerUncle, 'idle'); setUncleState(avatar, 'idle'); };
  speechSynthesis.speak(utter);
}

// Chrome loads voices lazily; touching getVoices early warms the list.
if ('speechSynthesis' in window) speechSynthesis.getVoices();
voiceToggle.addEventListener('click', () => {
  voiceOn = !voiceOn;
  voiceToggle.setAttribute('aria-pressed', String(voiceOn));
  voiceToggle.textContent = voiceOn ? '🔊' : '🔇';
  if (!voiceOn && 'speechSynthesis' in window) {
    speechSynthesis.cancel();
    setUncleState(headerUncle, 'idle');
    setUncleState(speakingAvatar, 'idle');
  }
});

// ---------- maps (Leaflet + OpenStreetMap for the wireframe) ----------
const hasMap = () => typeof L !== 'undefined';
const tiles = () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap',
});
const pinIcon = (label, cls = '') => L.divIcon({
  className: '', html: `<div class="pin ${cls}"><span>${label}</span></div>`,
  iconSize: [30, 30], iconAnchor: [15, 30],
});
const meIcon = () => L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
const toLatLng = (p) => [p.lat, p.lng];

// Small overview map inside uncle's reply. Tap a pin to get directions.
function placesMap(places, origin) {
  if (!hasMap()) return null;
  const el = document.createElement('div');
  el.className = 'places-map';
  // Leaflet needs the element in the DOM to measure it, so render after insert.
  el.render = () => {
    const map = L.map(el, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false });
    tiles().addTo(map);
    L.marker(toLatLng(origin), { icon: meIcon() }).addTo(map);
    places.forEach((p, i) => L.marker(toLatLng(p), { icon: pinIcon(i + 1) }).addTo(map).on('click', () => openNav(p)));
    map.fitBounds([origin, ...places].map(toLatLng), { padding: [28, 28] });
  };
  return el;
}

// ---------- in-chat directions ----------
const nav = $('#nav');
const navTitle = $('#nav-title');
const navEta = $('#nav-eta');
const navSay = $('#nav-say');
const navSteps = $('#nav-steps');
const navWalk = $('#nav-walk');
const navMapEl = $('#nav-map');
const navUncle = $('#nav-uncle');
navUncle.appendChild(uncleTemplate.content.firstElementChild.cloneNode(true));

let navMap = null;
let navLayers = null;
let meMarker = null;
let navRoute = null;
let navPlace = null;
let navToken = 0;
let walkFrame = null;
let arrived = false;

const WALK_SPEED = 80; // metres per minute

// Rough metres between two points; plenty accurate over a few km.
function metres(a, b) {
  const kx = 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((b.lng - a.lng) * kx, (b.lat - a.lat) * 111320);
}

function uncleSays(text, voice = true) {
  navSay.textContent = text;
  if (voice) speak(text, navUncle);
}

function setStep(idx) {
  [...navSteps.children].forEach((li, i) => {
    li.classList.toggle('active', i === idx);
    li.classList.toggle('passed', i < idx);
  });
  uncleSays(navRoute.steps[idx].text);
}

function drawRoute(origin, route) {
  if (!hasMap()) {
    navMapEl.textContent = 'Map cannot load leh. Check your internet?';
    return;
  }
  if (!navMap) {
    navMap = L.map(navMapEl);
    tiles().addTo(navMap);
    navLayers = L.layerGroup().addTo(navMap);
  }
  navMap.invalidateSize();
  navLayers.clearLayers();
  const line = route.path.map(toLatLng);
  L.polyline(line, { color: '#fff', weight: 10, opacity: 0.9 }).addTo(navLayers);
  L.polyline(line, { color: '#d64534', weight: 6, dashArray: '2 10', lineCap: 'round' }).addTo(navLayers);
  L.marker(line[line.length - 1], { icon: pinIcon('🍜', 'pin--dest') }).addTo(navLayers);
  meMarker = L.marker(toLatLng(origin), { icon: meIcon(), zIndexOffset: 1000 }).addTo(navLayers);
  navMap.fitBounds(line, { padding: [40, 40] });
}

async function openNav(place) {
  const token = ++navToken;
  stopWalk();
  arrived = false;
  navPlace = place;
  navRoute = null;
  nav.hidden = false;
  navTitle.textContent = place.name;
  navEta.textContent = 'Uncle finding the way…';
  navSteps.innerHTML = '';
  navWalk.disabled = true;
  navWalk.textContent = '🚶 Start walking (demo)';
  setUncleState(navUncle, 'thinking');
  uncleSays('Wait ah, uncle check the route for you…', false);

  const origin = await getLocation();
  const route = await getRoute(origin, place);
  if (token !== navToken) return; // user closed or picked another place meanwhile

  setUncleState(navUncle, 'idle');
  navRoute = route;
  const dist = route.distance >= 1000 ? `${(route.distance / 1000).toFixed(1)} km` : `${route.distance} m`;
  navEta.textContent = `🚶 ${route.minutes} min walk · ${dist}${route.approx ? ' (rough)' : ''}`;
  route.steps.forEach((step) => {
    const li = document.createElement('li');
    li.textContent = step.text;
    navSteps.appendChild(li);
  });
  navWalk.disabled = false;
  drawRoute(origin, route);
  uncleSays(route.approx
    ? "Aiyo, uncle's map signal weak. This one rough direction only ah. Press start when you ready."
    : `Okay, follow uncle ah! ${route.minutes} minutes walk only. Press start when you ready.`);
}

// Demo only: moves your dot along the route. The real version will follow
// navigator.geolocation.watchPosition and advance steps as you walk.
function startWalk() {
  if (!navRoute || !meMarker) return;
  stopWalk();
  const pts = navRoute.path;
  const segs = pts.slice(1).map((p, i) => metres(pts[i], p));
  const total = segs.reduce((a, b) => a + b, 0);
  const duration = Math.max(16000, navRoute.steps.length * 3500); // time for uncle to speak each step
  const t0 = performance.now();
  let lastStep = -1;
  navWalk.disabled = true;
  navWalk.textContent = 'Walking…';

  const tick = (now) => {
    const done = Math.min(1, (now - t0) / duration) * total;
    let i = 0;
    let acc = 0;
    while (i < segs.length - 1 && acc + segs[i] < done) acc += segs[i++];
    const f = segs[i] ? Math.min(1, (done - acc) / segs[i]) : 1;
    meMarker.setLatLng([pts[i].lat + (pts[i + 1].lat - pts[i].lat) * f, pts[i].lng + (pts[i + 1].lng - pts[i].lng) * f]);

    const finished = done >= total;
    const step = finished ? navRoute.steps.length - 1 : navRoute.steps.findLastIndex((s) => s.at <= i);
    if (step !== lastStep) setStep((lastStep = step));

    const left = total - done;
    navEta.textContent = finished ? '🎉 Reached!' : `🚶 ${Math.max(1, Math.ceil(left / WALK_SPEED))} min · ${Math.round(left)} m left`;
    if (finished) {
      walkFrame = null;
      arrived = true;
      navWalk.disabled = false;
      navWalk.textContent = '🔁 Walk again (demo)';
    } else {
      walkFrame = requestAnimationFrame(tick);
    }
  };
  walkFrame = requestAnimationFrame(tick);
}

function stopWalk() {
  if (walkFrame) cancelAnimationFrame(walkFrame);
  walkFrame = null;
}

function closeNav() {
  navToken++;
  stopWalk();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  setUncleState(navUncle, 'idle');
  nav.hidden = true;
  if (arrived && navPlace) {
    const text = `Reached ${navPlace.name} already? Shiok! Eat slowly ah, then come back tell uncle how.`;
    speak(text, addUncleMsg(text));
  }
  arrived = false;
}

navWalk.addEventListener('click', startWalk);
$('#nav-back').addEventListener('click', closeNav);

// ---------- send loop ----------
async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  app.classList.add('busy');
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  setUncleState(speakingAvatar, 'idle');

  addUserMsg(text);
  history.push({ role: 'user', content: text });

  const thinking = showThinking();
  setUncleState(headerUncle, 'thinking');

  try {
    for await (const ev of runAgent(history, { getLocation })) {
      if (ev.type === 'status') thinking.setStatus(ev.text);
      else if (ev.type === 'tool_call') thinking.addStep(ev.id, ev.label);
      else if (ev.type === 'tool_result') thinking.completeStep(ev.id, ev.summary);
      else if (ev.type === 'final') {
        thinking.remove();
        setUncleState(headerUncle, 'idle');
        const avatar = addUncleMsg(ev.text, ev.places, ev.origin);
        history.push({ role: 'assistant', content: ev.text });
        speak(ev.text, avatar);
      }
    }
  } catch (err) {
    console.error(err);
    thinking.remove();
    addUncleMsg("Aiyo, uncle's brain hang already. Try again leh?");
  } finally {
    setUncleState(headerUncle, 'idle');
    headerStatus.textContent = 'Sitting at kopitiam, ready to makan';
    busy = false;
    app.classList.remove('busy');
    input.focus();
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value;
  input.value = '';
  send(text);
});
$('#chips').addEventListener('click', (e) => {
  if (e.target.classList.contains('chip')) send(e.target.textContent);
});

addUncleMsg("Eh, hello! I'm Lunch Uncle. Tell me what you feel like eating and uncle find something nice near you. Or just tap one of the buttons below lah.");
