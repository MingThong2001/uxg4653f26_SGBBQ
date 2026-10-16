import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* ==========================================================================
   1. CONFIGURATION & CLIENT INITIALIZATION
   ========================================================================== */

const SUPABASE_URL = "https://xatgzoturyuygtgukegt.supabase.co";
const SUPABASE_KEY = "sb_publishable_k6u5Nka26BQpQOP4R1H6Zw_lJ4PBUpT";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* OneMap: never put your email/password in front-end code.
   Point tokenUrl at a small backend endpoint that logs in to OneMap with
   credentials kept in environment variables and returns { "token": "..." }.
   For quick local testing only, you may paste a short-lived token into devToken. */
const ONEMAP_CONFIG = {
  tokenUrl: "https://xatgzoturyuygtgukegt.supabase.co/functions/v1/onemap-token",
  devToken: ""
};

let onemapToken = ONEMAP_CONFIG.devToken || null;

async function getOneMapToken(forceRefresh = false) {
  if (onemapToken && !forceRefresh) return onemapToken;
  try {
    const res = await fetch(ONEMAP_CONFIG.tokenUrl);
    if (!res.ok) throw new Error(`Token endpoint returned ${res.status}`);
    onemapToken = (await res.json()).token;
  } catch (err) {
    console.error("Could not get OneMap token:", err);
    onemapToken = null;
  }
  return onemapToken;
}

async function searchOneMap(query, retry = true) {
  const token = await getOneMapToken();
  if (!token) return [];
  const endpoint = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(query)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
  try {
    const res = await fetch(endpoint, { headers: { Authorization: token } });
    if (res.status === 401 && retry) {          // token expired: refresh once
      await getOneMapToken(true);
      return searchOneMap(query, false);
    }
    if (!res.ok) return [];
    return (await res.json()).results || [];
  } catch (err) {
    console.error("OneMap Search Error:", err);
    return [];
  }
}

/* ==========================================================================
   2. APP STATE & DATA
   ========================================================================== */

const PRICE = '$20/pit · 2hrs';
const FAC_ICON = { Toilets: 'pin', Water: 'drop', Lights: 'bulb', Parking: 'compass' };

let PITS = {
  D: { id:'D', area:'Area D', rating:4.6, reviews:24, access:'Stair-free access', accessLong:'Stair-free approach. Confirm access and path conditions with the managing agency.', fac:['Toilets','Water','Lights'], photo:'d', coords: [1.3000, 103.9110] },
  A: { id:'A', area:'Area A', rating:4.4, reviews:18, access:'Paved access', accessLong:'Paved approach. Confirm route conditions before travelling.', fac:['Toilets','Water','Lights'], photo:'a', coords: [1.3030, 103.9050] },
  C: { id:'C', area:'Area C', rating:4.6, reviews:24, access:'Paved access', accessLong:'Paved approach. Confirm route conditions before travelling.', fac:['Toilets','Parking'], photo:'c', coords: [1.3015, 103.9080] },
};

const state = {
  saved: new Set(['D', 'A']),
  viewing: 'D',
  comparing: ['D', 'A'],
  baseline: 'D',
  listMode: 'list',
};

async function loadPits() {
  try {
    const { data, error } = await supabase.from("pits").select("*");
    if (!error && data && data.length > 0) {
      PITS = data.reduce((acc, pit) => {
        acc[pit.id] = {
          id: pit.id,
          area: pit.area,
          rating: pit.rating,
          reviews: pit.reviews,
          access: pit.access,
          accessLong: pit.access_long,
          fac: pit.facilities || [],
          photo: pit.photo_key || 'd',
          coords: pit.coords || [1.3000, 103.9110]
        };
        return acc;
      }, {});
      if (document.getElementById('view').dataset.route === 'explore') {
        go('explore', { push: false });
      }
    }
  } catch (err) {
    console.error("Error connecting to Supabase:", err);
  }
}

/* ==========================================================================
   3. UI HELPERS & TEMPLATES
   ========================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#${name}"/></svg>`;
const saveBtn = id => `<button class="save" data-save="${id}" aria-pressed="${state.saved.has(id)}" aria-label="Save ${PITS[id]?.area || ''}">${icon('bookmark')}</button>`;
const notice = text => `<button class="notice" data-go="explore">${icon('info')}<span>${text}</span><span class="go">${icon('chev')}</span></button>`;
const searchBar = () => `<label class="field">${icon('search')}<input type="search" id="onemap-search-input" placeholder="Search by park, area or facility" aria-label="Search by park, area or facility"></label>`;
const eyebrow = text => `<p class="eyebrow">${icon('flame')}${text}</p>`;

function pitCard(id, { cta = true, label = '' } = {}) {
  const p = PITS[id];
  if (!p) return '';
  return `
  <article class="card pit">
    <div class="pit-main">
      <div class="photo photo-${p.photo}" role="img" aria-label="Photo of ${p.area}"></div>
      <div>
        <span class="tag">Public Sector</span>
        <h3>East Coast Park ${p.area}</h3>
        <p class="rating">★ ${p.rating} (${p.reviews} demo reviews)</p>
        <p class="meta"><span>${icon('pin')} East Coast Park, ${p.area}</span><span>${icon('compass')} Nearest MRT: confirm route</span></p>
        <p class="price">${PRICE}</p>
      </div>
      ${saveBtn(id)}
    </div>
    ${cta ? `<div class="pit-foot">
      <div class="row accent">${icon('access')}<span style="color:var(--text)">${p.access}</span></div>
      <div class="row"><span>${p.fac.join(' · ')}</span><button class="link" data-pit="${id}">View Pit →</button></div>
    </div>` : ''}
    ${label}
  </article>`;
}

const exploreHeader = () => `
  ${eyebrow('BBQ PIT FINDER')}
  <h1>Find your fire.</h1>
  ${searchBar()}
  <div id="search-results-output" style="display:none; flex-direction:column; gap:8px;" class="card"></div>
  <div class="filters">
    <button class="field">${icon('cal')}<span>Date and time</span></button>
    <button class="field">${icon('users')}<span>Number of guests</span></button>
  </div>
  <div class="row between">
    <span class="row" style="font-weight:600;font-size:.9rem">${icon('compass')}East Coast Park</span>
    <div class="toggle" role="group" aria-label="View mode">
      <button data-mode="map" aria-pressed="${state.listMode === 'map'}">${icon('pin')}Map</button>
      <button data-mode="list" aria-pressed="${state.listMode === 'list'}">${icon('search')}List</button>
    </div>
  </div>`;

/* ==========================================================================
   4. SCREENS & ROUTER
   ========================================================================== */

const screens = {
  login: () => `
    <section class="card auth-card">
      ${eyebrow('BBQ PIT FINDER')}
      <h1>Welcome Back!</h1>
      <p class="sub">Sign in to your Account</p>
      <label class="field" style="flex-direction:row;text-align:left">
        <span style="flex:1"><small class="accent" style="display:block">Email</small>
        <input type="email" placeholder="example@email.com" autocomplete="email"></span>
        <button class="go-btn" data-go="explore" aria-label="Continue">${icon('chev')}</button>
      </label>
      <p class="or">OR</p>
      <button class="field social" data-go="explore"><strong style="color:#4285f4">G</strong>Continue with Google</button>
      <button class="field social" data-go="explore"><strong style="color:#fff"></strong>Continue with Apple</button>
      <p class="sub">Don't have an account? <a href="#login" class="accent" style="text-decoration:none">Sign up</a></p>
    </section>`,

  explore: () => state.listMode === 'map'
    ? `${exploreHeader('map')}
       <div id="onemap-leaflet-container" class="map" role="region" aria-label="Map of East Coast Park"></div>`
    : `${exploreHeader('list')}
       ${Object.keys(PITS).map(id => pitCard(id)).join('')}
       ${notice('Confirm facilities, availability and final prices on the official site.')}`,

  map: () => `
    ${exploreHeader('map')}
    <section class="map" aria-label="Illustrative map of East Coast Park">
      <div class="pills"><span class="pill">${icon('flame')}BBQ pits ✓</span><span class="pill">${icon('pin')}Facilities ✓</span></div>
      <div class="pins">
        <button class="pin" data-pit="A"><span class="drop">${icon('flame')}</span>Area A<br>120m<br>2min walk</button>
        <span class="you" role="img" aria-label="Your location"></span>
        <button class="pin" data-pit="D"><span class="drop">${icon('flame')}</span>Area D<br>85m<br>1min walk</button>
      </div>
      <p class="muted">Illustrative map · sample walking estimates</p>
    </section>`,

  pit: () => {
    const p = PITS[state.viewing] || PITS['D'];
    return `
    <div class="top"><button data-back>‹ Back</button><button class="btn sm" data-go="search">${icon('swap')}Compare Pit</button></div>
    <header><h1>East Coast Park</h1><p class="sub">${p.area} · Public-sector BBQ pit</p></header>
    <div class="photo photo-${p.photo} hero">${saveBtn(p.id)}<span class="badge">1 / 3 · illustrative</span></div>
    <div class="gallery">${['d','a','c'].map(k => `<div class="photo photo-${k}"></div>`).join('')}</div>
    <div class="row between" style="align-items:flex-start">
      <p><span class="rating" style="font-size:1.1rem">★ ${p.rating}</span><br><span class="muted">${p.reviews} demo reviews</span></p>
      <p style="text-align:right"><strong style="font-size:1.1rem">${PRICE}</strong><br><span class="muted">Sample price</span></p>
    </div>
    ${notice('Demo listing and illustrative photos.')}
    <section class="stack"><h2>Plan your visit</h2>
      <ul class="facts">
        <li class="fact"><i>${icon('compass')}</i><span><small>Organisation</small>Managing agency: confirmation pending</span></li>
        <li class="fact"><i>${icon('clock')}</i><span><small>Operating times</small>Not confirmed. Check official booking times.</span></li>
        <li class="fact"><i>${icon('pin')}</i><span><small>Address</small>East Coast Park, ${p.area}, Singapore.</span></li>
        <li class="fact"><i>${icon('access')}</i><span><small>Accessibility</small>${p.accessLong}</span></li>
      </ul>
    </section>
    <section class="stack"><div class="row between"><h2>Facilities</h2><span class="link">Attributes</span></div>
      <div class="fac-grid">${p.fac.map(f => `<div>${icon(FAC_ICON[f] || 'pin')}${f}</div>`).join('')}</div>
    </section>
    <a class="btn" href="#pit" onclick="return false">Book now ${icon('out')}</a>`;
  },

  search: () => {
    const base = PITS[state.baseline] || PITS['D'];
    const others = Object.keys(PITS).filter(id => id !== state.baseline);
    return `
    ${eyebrow('Recently Seen')}
    <h1>Search and compare</h1>
    ${searchBar()}
    <div class="card comparing"><div class="photo photo-${base.photo}"></div>
      <p><small class="accent" style="font-size:.7rem">COMPARING WITH</small><br><strong>East Coast Park · ${base.area}</strong><br><span class="muted">${PRICE}</span></p>
      <span class="accent">${icon('target')}</span></div>
    <div class="chips"><span class="chip">East Coast Park</span><span class="chip">Toilets</span><span class="chip">Step-free</span></div>
    <div class="row between"><h2>Recently Seen</h2><span class="link">${others.length} other pits</span></div>
    ${others.slice(0, 1).map(id => pitCard(id, { label: `<button class="btn" data-compare="${id}">Compare with this pit ${icon('swap')}</button>` })).join('')}`;
  },

  compare: () => {
    const [a, b] = state.comparing.map(id => PITS[id] || PITS['D']);
    return `
    <div class="top"><button data-back>‹ Back</button><button class="go-btn" data-go="search">Change pit</button></div>
    <header><h1>Which fire fits?</h1><p class="sub">Two spots. One easier decision.</p></header>
    <div class="duo">${[a, b].map(p => `<div><div class="photo photo-${p.photo}"></div>
      <span class="muted accent" style="font-size:.7rem">East Coast Park</span><h2 style="font-size:1.2rem">${p.area}</h2>
      <span class="rating">★ ${p.rating} · ${p.reviews} demo reviews</span><strong>${PRICE}</strong></div>`).join('')}</div>
    <div class="duo"><button class="btn" data-pit="${a.id}">View ${a.area}</button><button class="btn" data-pit="${b.id}">View ${b.area}</button></div>`;
  },

  saved: () => `
    ${eyebrow('BBQ PIT FINDER')}
    <h1>Your favourite fires.</h1>
    <p class="sub">Good spots, kept close for your next gathering.</p>
    ${searchBar()}
    <div class="row between"><h2>Saved pits</h2><span class="link">${state.saved.size} places</span></div>
    ${state.saved.size ? [...state.saved].map(id => pitCard(id)).join('') : '<p class="card sub">Nothing saved yet.</p>'}`,

  profile: () => `
    ${eyebrow('BBQ PIT FINDER')}
    <h1>Your Page</h1>
    <section class="card row"><span class="avatar">AL</span><div><strong style="font-size:1.2rem">Alex Lim</strong></div></section>
    <h2>General Settings</h2>
    <ul class="card list">
      <li>${icon('compass')}<span>Language<small>English</small></span><span class="go">${icon('chev')}</span></li>
      <li>${icon('info')}<span>About BBQ Pit Finder<small>Demo version</small></span><span class="go">${icon('chev')}</span></li>
    </ul>`
};

const TAB = { explore: 'explore', pit: 'explore', compare: 'explore', search: 'explore', saved: 'saved', profile: 'profile' };
const historyStack = [];

let leafletMapInstance = null;

function initLeafletMap() {
  const container = document.getElementById('onemap-leaflet-container');
  if (!container || typeof L === 'undefined') return;

  if (leafletMapInstance) {
    leafletMapInstance.remove();
    leafletMapInstance = null;
  }

  // Centre map on East Coast Park
  leafletMapInstance = L.map(container).setView([1.3000, 103.9100], 14);

  L.tileLayer("https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png", {
    detectRetina: true,
    minZoom: 11,
    maxZoom: 19,
    attribution: '<a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener">OneMap</a>&nbsp;&copy;&nbsp;contributors&nbsp;&#124;&nbsp;<a href="https://www.sla.gov.sg/" target="_blank" rel="noopener">Singapore Land Authority</a>'
  }).addTo(leafletMapInstance);

  // Add markers for each pit
  Object.values(PITS).forEach(pit => {
    const marker = L.marker(pit.coords).addTo(leafletMapInstance);
    marker.bindPopup(`<b>East Coast Park ${pit.area}</b><br>${pit.access}<br><button class="link" onclick="window.viewPitFromMap('${pit.id}')">View Details →</button>`);
  });

  setTimeout(() => {
    leafletMapInstance.invalidateSize();
  }, 200);
}

// Global hook for popup button click
window.viewPitFromMap = (pitId) => {
  state.viewing = pitId;
  go('pit');
};

function go(route, { push = true } = {}) {
  const view = $('#view');
  const nav = $('#nav');
  if (!screens[route]) route = 'login';
  if (push) historyStack.push(route);

  view.innerHTML = screens[route]();
  view.className = route === 'login' ? 'auth' : '';
  view.scrollTop = 0;
  nav.hidden = route === 'login';

  nav.querySelectorAll('[data-tab]').forEach(b => {
    if (b.dataset.tab === TAB[route]) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });

  view.dataset.route = route;
  attachSearchListener();

  if (route === 'explore' && state.listMode === 'map') {
    requestAnimationFrame(initLeafletMap);
  }
}

function back() {
  historyStack.pop();
  go(historyStack[historyStack.length - 1] || 'explore', { push: false });
}

/* ==========================================================================
   5. EVENT LISTENERS & INITIALIZATION
   ========================================================================== */

function attachSearchListener() {
  const input = $('#onemap-search-input');
  const output = $('#search-results-output');
  if (!input || !output) return;

  let timer;
  input.addEventListener('input', (e) => {
    clearTimeout(timer);
    const query = e.target.value.trim();
    if (query.length < 3) {
      output.style.display = 'none';
      return;
    }

    timer = setTimeout(async () => {
      output.style.display = 'flex';
      output.innerHTML = `<span class="muted">Searching OneMap...</span>`;
      const results = await searchOneMap(query);

      if (results.length === 0) {
        output.innerHTML = `<span class="muted">No locations found.</span>`;
        return;
      }

      output.innerHTML = results.slice(0, 4).map(res => `
        <div style="padding:6px 0; border-bottom:1px solid var(--line-soft)">
          <strong style="font-size:0.85rem; color:var(--text);">${res.BUILDING || res.SEARCHVAL}</strong><br>
          <small class="muted">${res.ROAD_NAME || res.ADDRESS}</small>
        </div>
      `).join('');
    }, 400);
  });
}
/* ==========================================================================
   LIVE PUBLIC DATA INTEGRATION (Data.gov.sg APIs)
   ========================================================================== */

async function fetchWeatherForecast() {
  try {
    const res = await fetch("https://api-open.data.gov.sg/v2/real-time/api/twenty-four-hr-forecast");
    const json = await res.json();
    if (json.code === 0 && json.data && json.data.records.length > 0) {
      const record = json.data.records[0];
      return {
        general: record.general.forecast.text,
        tempLow: record.general.temperature.low,
        tempHigh: record.general.temperature.high,
        humidityLow: record.general.relativeHumidity.low,
        humidityHigh: record.general.relativeHumidity.high
      };
    }
  } catch (err) {
    console.error("Weather API Error:", err);
  }
  return null;
}

async function fetchCarparkAvailability() {
  try {
    const res = await fetch("https://api.data.gov.sg/v1/transport/carpark-availability");
    const json = await res.json();
    if (json.items && json.items.length > 0) {
      return json.items[0].carpark_data;
    }
  } catch (err) {
    console.error("Carpark API Error:", err);
  }
  return [];
}

async function loadPitWeather() {
  const weatherText = document.getElementById('weather-text');
  if (!weatherText) return;

  const weather = await fetchWeatherForecast();
  if (weather) {
    weatherText.innerHTML = `🌤️ <strong>${weather.general}</strong><br>Temp: ${weather.tempLow}°C – ${weather.tempHigh}°C | Humidity: ${weather.humidityLow}%–${weather.humidityHigh}%`;
  } else {
    weatherText.textContent = "Live weather data currently unavailable.";
  }
}

async function loadPitCarparks() {
  const carparkText = document.getElementById('carpark-text');
  if (!carparkText) return;
  
  const carparks = await fetchCarparkAvailability();
  if (carparks.length > 0) {
    const carLots = carparks.filter(cp => cp.lot_type === 'C').slice(0, 3);
    carparkText.innerHTML = carLots.map(cp => 
      `<div>🅿️ Carpark ID ${cp.carpark_number || 'Lot'}: <strong>${cp.lots_available}</strong> / ${cp.total_lots} available (Cars)</div>`
    ).join('') || "No car parking data found.";
  } else {
    carparkText.textContent = "Live carpark data currently unavailable.";
  }
}
document.addEventListener('click', e => {
  const modeBtn = e.target.closest('[data-mode]');
  if (modeBtn) {
    state.listMode = modeBtn.dataset.mode;
    go('explore', { push: false });
    return;
  }

  const t = e.target.closest('[data-go],[data-save],[data-pit],[data-compare],[data-back]');
  if (!t) return;

  if (t.dataset.save) {
    const id = t.dataset.save;
    state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
    go($('#view').dataset.route, { push: false });
  } else if (t.dataset.pit) {
    state.viewing = t.dataset.pit;
    go('pit');
  } else if (t.dataset.compare) {
    state.comparing = [state.baseline, t.dataset.compare];
    go('compare');
  } else if ('back' in t.dataset) {
    back();
  } else {
    if (t.dataset.go === 'search') state.baseline = state.viewing;
    go(t.dataset.go);
  }
});

loadPits();
go('login');