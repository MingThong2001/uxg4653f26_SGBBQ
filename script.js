import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* ==========================================================================
   1. CONFIGURATION & CLIENT INITIALIZATION
   ========================================================================== */

const SUPABASE_URL = "https://xatgzoturyuygtgukegt.supabase.co";
const SUPABASE_KEY = "sb_publishable_k6u5Nka26BQpQOP4R1H6Zw_lJ4PBUpT";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
    if (res.status === 401 && retry) {
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
   2. APP STATE & SAFETY NET DATA (CSV Pits Fallback)
   ========================================================================== */

const PRICE = '$20/pit · 2hrs';
const FAC_ICON = { Toilets: 'pin', Water: 'drop', Lights: 'bulb', Parking: 'compass' };

// Instant safety net dataset so the map and list never get stuck loading
let PITS = {
  "A": { id: "A", area: "Pasir Ris-Changi", rating: 4.4, reviews: 56, access: "Access information unavailable", accessLong: "Accessibility details have not been verified. Contact the managing agency before visiting.", fac: ["Toilets", "Water"], photo: "default-bbq-pit", price: "$19/pit · 2hrs", coords: [1.381086, 103.957466] },
  "B": { id: "B", area: "Mountbatten", rating: 4.6, reviews: 71, access: "Access information unavailable", accessLong: "Accessibility details have not been verified. Contact the managing agency before visiting.", fac: ["Water", "Lights"], photo: "default-bbq-pit", price: "$17/pit · 2hrs", coords: [1.298286, 103.907651] },
  "C": { id: "C", area: "Marine Parade", rating: 4.8, reviews: 120, access: "Paved access", accessLong: "Paved approach.", fac: ["Toilets", "Water"], photo: "default-bbq-pit", price: "$20/pit · 2hrs", coords: [1.306348, 103.935754] },
  "D": { id: "D", area: "Pasir Ris-Changi", rating: 4.2, reviews: 34, access: "Paved access", accessLong: "Paved approach.", fac: ["Toilets", "Water"], photo: "default-bbq-pit", price: "$22/pit · 2hrs", coords: [1.388407, 103.940455] },
  "E": { id: "E", area: "South West", rating: 4.5, reviews: 45, access: "Stair-free access", accessLong: "Stair-free approach.", fac: ["Toilets", "Water", "Lights"], photo: "default-bbq-pit", price: "$18/pit · 2hrs", coords: [1.292417, 103.765278] }
};

const state = {
  saved: new Set(['A']),
  viewing: 'A',
  comparing: ['A'],
  baseline: 'A',
  listMode: 'list',
};

async function loadPits() {
  try {
    // Limit to 200 rows for lightning-fast mobile performance and smooth map rendering
    const { data, error } = await supabase
      .from("pits")
      .select("*")
      .limit(200);

    if (error) {
      console.warn("Supabase query error. Using CSV safety net data.", error);
      return;
    }

    if (data && data.length > 0) {
      const newPits = {};
      data.forEach((pit, index) => {
        const pitId = pit.id ? String(pit.id).trim() : `pit_${index + 1}`;
        
        let parsedFacilities = ['Toilets', 'Water'];
        if (Array.isArray(pit.facilities)) {
          parsedFacilities = pit.facilities;
        } else if (typeof pit.facilities === 'string') {
          parsedFacilities = pit.facilities
            .replace(/^\{|\}$/g, '')
            .split(',')
            .map(f => f.trim().replace(/^"|"$/g, ''))
            .filter(Boolean);
        }
        if (parsedFacilities.length === 0) parsedFacilities = ['Toilets', 'Water'];

        const lat = parseFloat(pit.latitude);
        const lng = parseFloat(pit.longitude);

        newPits[pitId] = {
          id: pitId,
          area: pit.area || `Pit ${pitId}`,
          rating: pit.rating || 4.5,
          reviews: pit.reviews || 0,
          access: pit.access || 'Paved access',
          accessLong: pit.access_long || 'Paved approach.',
          fac: parsedFacilities,
          photo: pit.photo_key || 'default-bbq-pit',
          price: pit.price || '$20/pit · 2hrs',
          coords: [!isNaN(lat) ? lat : 1.3000, !isNaN(lng) ? lng : 103.9110]
        };
      });

      PITS = newPits;
      console.log(`Successfully loaded ${Object.keys(PITS).length} BBQ pits from Supabase (capped at 200).`);

      const allIds = Object.keys(PITS);
      if (allIds.length > 0) {
        state.viewing = allIds[0];
        state.baseline = allIds[0];
      }

      // Refresh current screen if active
      const currentRoute = document.getElementById('view')?.dataset?.route;
      if (currentRoute === 'explore' || currentRoute === 'map') {
        go(currentRoute, { push: false });
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
      <div class="photo photo-${p.photo === 'default-bbq-pit' ? 'd' : p.photo}" role="img" aria-label="Photo of ${p.area}"></div>
      <div>
        <span class="tag">Public Sector</span>
        <h3>${p.area}</h3>
        <p class="rating">★ ${p.rating} (${p.reviews} demo reviews)</p>
        <p class="meta"><span>${icon('pin')} ${p.area}, Singapore</span><span>${icon('compass')} Nearest MRT: confirm route</span></p>
        <p class="price">${p.price || PRICE}</p>
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
    <span class="row" style="font-weight:600;font-size:.9rem">${icon('compass')}Singapore Parks (${Object.keys(PITS).length} Pits)</span>
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
    ? `${exploreHeader()}
       <div id="onemap" class="map" role="region" aria-label="Map of BBQ Pits"></div>`
    : `${exploreHeader()}
       ${Object.keys(PITS).slice(0, 5).map(id => pitCard(id)).join('')}
       ${notice('Confirm facilities, availability and final prices on the official site.')}`,

  map: () => `
    ${exploreHeader()}
    <div id="onemap" class="map" role="region" aria-label="Map of BBQ Pits"></div>`,

  pit: () => {
    const p = PITS[state.viewing] || Object.values(PITS)[0];
    return `
    <div class="top"><button data-back>‹ Back</button><button class="btn sm" data-go="search">${icon('swap')}Compare Pit</button></div>
    <header><h1>${p.area}</h1><p class="sub">Public-sector BBQ pit</p></header>
    <div class="photo photo-d hero">${saveBtn(p.id)}<span class="badge">1 / 3 · illustrative</span></div>
    <div class="gallery">${['d','a','c'].map(k => `<div class="photo photo-${k}"></div>`).join('')}</div>
    <div class="row between" style="align-items:flex-start">
      <p><span class="rating" style="font-size:1.1rem">★ ${p.rating}</span><br><span class="muted">${p.reviews} demo reviews</span></p>
      <p style="text-align:right"><strong style="font-size:1.1rem">${p.price || PRICE}</strong><br><span class="muted">Sample price</span></p>
    </div>

    <!-- LIVE WEATHER WIDGET -->
    <section class="card stack">
      <h2>Live Weather Forecast</h2>
      <div id="weather-text" class="sub">🔄 Loading weather...</div>
    </section>

    <!-- LIVE CARPARK WIDGET -->
    <section class="card stack">
      <h2>Nearby Carpark Availability</h2>
      <div id="carpark-text" class="sub">🔄 Loading carpark availability...</div>
    </section>

    ${notice('Demo listing and illustrative photos.')}
    <section class="stack"><h2>Plan your visit</h2>
      <ul class="facts">
        <li class="fact"><i>${icon('compass')}</i><span><small>Organisation</small>Managing agency: confirmation pending</span></li>
        <li class="fact"><i>${icon('clock')}</i><span><small>Operating times</small>Not confirmed. Check official booking times.</span></li>
        <li class="fact"><i>${icon('pin')}</i><span><small>Address</small>${p.area}, Singapore.</span></li>
        <li class="fact"><i>${icon('access')}</i><span><small>Accessibility</small>${p.accessLong}</span></li>
      </ul>
    </section>
    <section class="stack"><div class="row between"><h2>Facilities</h2><span class="link">Attributes</span></div>
      <div class="fac-grid">${p.fac.map(f => `<div>${icon(FAC_ICON[f] \vert{}\vert{} 'pin')}${f}</div>`).join('')}</div>
    </section>
    <a class="btn" href="#pit" onclick="return false">Book now ${icon('out')}</a>`;
  },

  search: () => {
    const base = PITS[state.baseline] || Object.values(PITS)[0];
    // Use your tracked recent items, or increase the slice limit:
    const recentIds = state.recent.length > 0 ? state.recent : Object.keys(PITS).filter(id => id !== state.baseline);
    
    return `
    ${eyebrow('Recently Seen')}
    <h1>Search and compare</h1>
    ${search()}
    <div class="card comparing"><div class="photo photo-${base?.photo || 'd'}"></div>
      <p><small class="accent" style="font-size:.7rem">COMPARING WITH</small><br><strong>${base?.area || ''}</strong><br><span class="muted">${PRICE} · sample</span></p>
      <span class="accent">${icon('target')}</span></div>
    <div class="chips"><span class="chip">Toilets</span><span class="chip">Step-free</span><span class="chip">WiFi</span></div>
    <div class="row between"><h2>Recently Seen</h2><span class="link">${recentIds.length} other pits</span></div>
    ${recentIds.slice(0, 3).map(id => pitCard(id, { label: `<button class="btn" data-compare="${id}">Compare with this pit ${icon('swap')}</button>` })).join('')}`;
  },

  compare: () => {
    const keys = Object.keys(PITS);
    const a = PITS[state.comparing[0]] || PITS[keys[0]];
    const b = PITS[state.comparing[1]] || PITS[keys[1] || keys[0]];
    if (!a || !b) return `<div class="top"><button data-back>‹ Back</button></div><p class="card sub">Loading comparison...</p>`;
    
    const section = (title, ic, leftVal, rightVal, note) => `
      <details class="card" open style="padding: 14px; margin-bottom: 12px;">
        <summary style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">${icon(ic)}${title}</summary>
        <div class="duo">
          <div><strong style="font-size:0.9rem">${a.area}</strong><span class="sub">${leftVal}</span></div>
          <div><strong style="font-size:0.9rem">${b.area}</strong><span class="sub">${rightVal}</span></div>
        </div>
        <p class="muted" style="margin-top: 12px; border-top: 1px solid var(--line-soft); padding-top: 8px;">${note}</p>
      </details>`;

    return `
    <div class="top"><button data-back>‹ Back</button><button class="go-btn" data-go="search">Change pit</button></div>
    <header><h1>Which fire fits?</h1><p class="sub">Two spots. One easier decision.</p></header>
    
    <div class="card" style="margin-bottom: 12px;">
      <div class="duo">
        <div>
          <div class="photo photo-${a.photo}" style="min-height:96px; margin-bottom:8px;"></div>
          <h2 style="font-size:1.1rem; line-height: 1.2;">${a.area}</h2>
          <span class="rating">★ ${a.rating} · ${a.reviews} rev</span>
          <strong style="margin-top:4px;">${a.price || PRICE}</strong>
        </div>
        <div>
          <div class="photo photo-${b.photo}" style="min-height:96px; margin-bottom:8px;"></div>
          <h2 style="font-size:1.1rem; line-height: 1.2;">${b.area}</h2>
          <span class="rating">★ ${b.rating} · ${b.reviews} rev</span>
          <strong style="margin-top:4px;">${b.price || PRICE}</strong>
        </div>
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 4px;">
      ${section('Location', 'pin', a.nearestMRT || 'Confirm route', b.nearestMRT || 'Confirm route', 'Nearest MRT and walking route.')}
      ${section('Price', 'compass', a.price || PRICE, b.price || PRICE, 'Final prices and time slots are set by the official booking site.')}
      ${section('Accessibility', 'access', a.access, b.access, 'Demo attributes. Step-free access needs confirmation.')}
      ${section('Facilities', 'flame', a.fac.join(', '), b.fac.join(', '), 'Illustrative amenities; check managing agency listing.')}
    </div>

    <div class="duo" style="margin: 16px 0 12px 0;">
      <button class="btn sm" data-pit="${a.id}">View ${a.area}</button>
      <button class="btn sm" data-pit="${b.id}">View ${b.area}</button>
    </div>
    ${notice('Demo comparison. Agency, facilities and availability have not been independently verified.')}`;
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
  const container = document.getElementById('onemap');
  if (!container || typeof L === 'undefined') return;

  if (leafletMapInstance) {
    leafletMapInstance.remove();
    leafletMapInstance = null;
  }

  leafletMapInstance = L.map(container, { zoomControl: false }).setView([1.3521, 103.8198], 11);
  L.control.zoom({ position: 'bottomright' }).addTo(leafletMapInstance);

  L.tileLayer("https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png", {
    detectRetina: true,
    minZoom: 9,
    maxZoom: 19,
    attribution: '<a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener">OneMap</a>'
  }).addTo(leafletMapInstance);

  const bounds = [];
  const pitValues = Object.values(PITS);
  console.log(`Plotting ${pitValues.length} BBQ pits onto the Leaflet map.`);

  pitValues.forEach(pit => {
    if (!pit.coords || pit.coords.length !== 2) return;
    const latLng = [pit.coords[0], pit.coords[1]];
    bounds.push(latLng);

    const marker = L.circleMarker(latLng, {
      radius: 6,
      fillColor: '#ff6a1a',
      color: '#ffffff',
      weight: 1.5,
      opacity: 1,
      fillOpacity: 0.9
    }).addTo(leafletMapInstance);

    marker.bindPopup(`<strong>${pit.area}</strong><br>${pit.access}<br><button class="link" onclick="window.viewPitFromMap('${pit.id}')">View Details →</button>`);
  });

  if (bounds.length > 0) {
    leafletMapInstance.fitBounds(bounds, { padding: [30, 30] });
  }

  setTimeout(() => {
    leafletMapInstance.invalidateSize();
  }, 200);
}

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

  if ((route === 'explore' && state.listMode === 'map') || route === 'map') {
    requestAnimationFrame(initLeafletMap);
  }

  if (route === 'pit') {
    loadPitWeather();
    loadPitCarparks();
  }
}

function back() {
  historyStack.pop();
  go(historyStack[historyStack.length - 1] || 'explore', { push: false });
}

/* ==========================================================================
   5. EVENT LISTENERS & LIVE PUBLIC DATA APIs
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

/* ==========================================================================
   6. REALTIME SUBSCRIPTION & INITIALIZATION
   ========================================================================== */

// Enable Supabase Realtime live updates
supabase
  .channel('public:pits')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'pits' }, payload => {
    console.log('Realtime DB change received:', payload);
    loadPits();
  })
  .subscribe();

// Initialize app immediately with safety net, then sync Supabase
loadPits();
go('login');