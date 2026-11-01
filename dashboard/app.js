(function () {
  'use strict';
  var API = '/api';
  var tok = null;
  try { tok = JSON.parse(sessionStorage.getItem('pr_tok') || 'null'); } catch (e) { tok = null; }
  var $ = function (s) { return document.querySelector(s); };
  // Every value that came from the server goes through esc() before it is placed in HTML.
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var kes = function (n) { return 'KES ' + Number(n || 0).toLocaleString('en-KE'); };
  var chip = function (s) { return '<span class="chip ' + esc(s) + '">' + esc(String(s).replace(/_/g, ' ').toLowerCase()) + '</span>'; };
  var STREAMS = ['RIDES', 'SUBSCRIPTIONS', 'PARCELS', 'TOURS'];
  var COL = ['var(--sea)', 'var(--sand)', 'var(--ok)', 'var(--warn)'];
  var MAPCOL = { ONLINE: '#1E8F62', ON_TRIP: '#0E7C9B', OFFLINE: '#8A9BA3', MAINTENANCE: '#B7740F', DISABLED: '#C4432F' };
  var timer = null, map = null, layer = null, fitted = false, selVehicle = null, fleet = [];

  function toast(t) { var e = $('#toast'); e.textContent = t; e.classList.add('on'); setTimeout(function () { e.classList.remove('on'); }, 2400); }
  function save(t) { tok = t; if (t) sessionStorage.setItem('pr_tok', JSON.stringify(t)); else sessionStorage.removeItem('pr_tok'); }

  async function api(path, opt, retry) {
    opt = opt || {};
    var r = await fetch(API + path, {
      method: opt.method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok.accessToken } : {}),
      body: opt.body ? JSON.stringify(opt.body) : undefined,
    });
    var j = await r.json().catch(function () { return {}; });
    if (r.status === 401 && tok && retry !== false && path !== '/auth/login') {
      try {
        var rr = await fetch(API + '/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: tok.refreshToken }) });
        if (!rr.ok) throw new Error('x');
        var n = await rr.json(); save({ accessToken: n.accessToken, refreshToken: n.refreshToken });
        return api(path, opt, false);
      } catch (e) { signOut(); throw new Error('Session expired. Please sign in again.'); }
    }
    if (!r.ok) { var er = new Error((j.error && j.error.message) || 'Request failed'); er.details = j.error && j.error.details; throw er; }
    return j;
  }
  var post = function (p, b) { return api(p, { method: 'POST', body: b || {} }); };
  function fail(e) { toast(e.message + (e.details ? ': ' + Object.keys(e.details).map(function (k) { return k + ' ' + e.details[k]; }).join(', ') : '')); }

  // ---------- auth ----------
  function showApp(on) { document.body.classList.toggle('anon', !on); if (on) draw(); }
  function signOut() { save(null); clearInterval(timer); showApp(false); }
  $('#lbtn').onclick = async function () {
    $('#lerr').textContent = '';
    try {
      var r = await post('/auth/login', { email: $('#em').value, password: $('#pw').value });
      save({ accessToken: r.accessToken, refreshToken: r.refreshToken }); $('#pw').value = ''; showApp(true);
    } catch (e) { $('#lerr').textContent = e.message; }
  };
  $('#out').onclick = signOut;
  $('#theme').onclick = function () { var r = document.documentElement, d = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches; r.dataset.theme = d ? 'light' : 'dark'; };

  // ---------- map ----------
  function mountMap(id) {
    if (map) { map.remove(); map = null; }
    fitted = false;
    map = L.map(id).setView([-3.63, 39.85], 9);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }
  function plot(list) {
    if (!map) return;
    layer.clearLayers();
    var pts = [];
    list.forEach(function (v) {
      if (v.last_lat == null) return;
      var ll = [v.last_lat, v.last_lng]; pts.push(ll);
      L.circleMarker(ll, { radius: 9, color: '#fff', weight: 2, fillColor: MAPCOL[v.status] || '#888', fillOpacity: 1 })
        .bindTooltip(v.plate_number + (v.driver_name ? ' · ' + v.driver_name : '') + (v.gps_lost ? ' (GPS lost)' : ''))
        .on('click', function () { selVehicle = v.id; if (location.hash === '#fleet') renderFleetPanel(); }).addTo(layer);
    });
    if (pts.length && !fitted) { map.fitBounds(pts, { padding: [40, 40], maxZoom: 13 }); fitted = true; }
  }
  async function loadFleet() { fleet = (await api('/admin/fleet/live')).vehicles; plot(fleet); return fleet; }

  // ---------- views ----------
  var V = {};
  V.overview = async function () {
    var res = await Promise.all([api('/admin/fleet/live'), api('/admin/drivers'), api('/admin/incidents'), api('/admin/reports/revenue?from=' + encodeURIComponent(new Date(new Date().setHours(0, 0, 0, 0)).toISOString()))]);
    fleet = res[0].vehicles;
    var today = Object.values(res[3].totals).reduce(function (a, b) { return a + b; }, 0);
    var c = function (st) { return fleet.filter(function (v) { return v.status === st; }).length; };
    $('#app').innerHTML = '<div class="top"><h1>Overview</h1><span class="mute">Mombasa to Malindi corridor</span></div>' +
      '<div class="kpis"><div class="kpi"><b>' + c('ONLINE') + '</b><span>Online, waiting</span></div><div class="kpi"><b>' + c('ON_TRIP') + '</b><span>On a trip</span></div>' +
      '<div class="kpi"><b>' + kes(today) + '</b><span>Revenue today</span></div><div class="kpi"><b>' + res[2].incidents.filter(function (i) { return i.status === 'OPEN'; }).length + '</b><span>Open incidents</span></div>' +
      '<div class="kpi"><b>' + res[1].drivers.filter(function (d) { return d.status === 'PENDING'; }).length + '</b><span>Drivers awaiting approval</span></div></div>' +
      '<div class="card"><h2>Live fleet</h2><div id="map"></div></div>';
    mountMap('map'); plot(fleet);
    timer = setInterval(function () { loadFleet().catch(function () {}); }, 10000);
  };

  function renderFleetPanel() {
    var v = fleet.find(function (x) { return x.id === selVehicle; });
    $('#panel').innerHTML = !v ? '<h2>Select a vehicle</h2><p class="mute">Click a dot on the map or a row in the table.</p>' :
      '<h2>' + esc(v.plate_number) + '</h2><p>' + chip(v.status) + '<br>Driver: ' + esc(v.driver_name || 'none on shift') + (v.last_seen_at ? '<br>Last seen: ' + esc(new Date(v.last_seen_at).toLocaleTimeString('en-KE')) : '') + (v.gps_lost ? '<br><b style="color:var(--bad)">GPS signal lost</b>' : '') + '</p>' +
      '<button data-a="flag">Flag maintenance</button><button data-a="camkey">Camera key</button><button class="d" data-a="disable">Disable vehicle</button>';
  }
  V.fleet = async function () {
    $('#app').innerHTML = '<div class="top"><h1>Fleet</h1></div><div class="grid"><div class="card"><div id="map"></div></div><div class="card" id="panel"></div></div>' +
      '<div class="card scroll"><div id="ftable"></div></div>' +
      '<div class="card"><h2>Add a vehicle</h2><div class="form"><div><label for="vp">Plate number</label><input id="vp"></div><div><label for="vm">Model</label><input id="vm" placeholder="Bajaj RE"></div><div><label for="vq">QR code text</label><input id="vq" placeholder="PR-VEH-006"></div><div><button class="p" id="vadd" type="button">Add vehicle</button></div></div></div>';
    mountMap('map');
    var draw2 = function () {
      plot(fleet);
      $('#ftable').innerHTML = '<table><tr><th>Plate</th><th>Driver</th><th>Status</th><th>Last seen</th></tr>' + fleet.map(function (v) {
        return '<tr><td><a href="#fleet" data-v="' + esc(v.id) + '">' + esc(v.plate_number) + '</a></td><td>' + esc(v.driver_name || '-') + '</td><td>' + chip(v.status) + '</td><td>' + (v.last_seen_at ? esc(new Date(v.last_seen_at).toLocaleTimeString('en-KE')) : 'no position') + '</td></tr>';
      }).join('') + '</table>';
      renderFleetPanel();
    };
    await loadFleet(); draw2();
    timer = setInterval(function () { loadFleet().then(draw2).catch(function () {}); }, 10000);
    $('#vadd').onclick = async function () {
      try { await post('/admin/vehicles', { plate_number: $('#vp').value, model: $('#vm').value || undefined, qr_code: $('#vq').value }); toast('Vehicle added'); draw(); } catch (e) { fail(e); }
    };
  };

  V.drivers = async function () {
    var d = (await api('/admin/drivers')).drivers;
    $('#app').innerHTML = '<div class="top"><h1>Drivers</h1></div><div class="card scroll"><table><tr><th>Driver</th><th>Phone</th><th>Status</th><th>Rating</th><th>Trips</th><th>Earnings</th><th>Tours</th><th>Actions</th></tr>' +
      d.map(function (x) {
        var live = x.status !== 'PENDING' && x.status !== 'SUSPENDED';
        return '<tr><td>' + esc(x.name) + '</td><td>' + esc(x.phone) + '</td><td>' + chip(x.status) + '</td><td>' + esc(Number(x.rating).toFixed(1)) + '</td><td>' + x.total_trips + '</td><td>' + kes(x.earnings) + '</td><td>' + (x.tour_certified ? 'certified' : '-') + '</td><td>' +
          (x.status === 'PENDING' ? '<button class="p" data-a="approve" data-id="' + esc(x.id) + '">Approve</button>' : '') +
          (x.status === 'SUSPENDED' ? '<button data-a="approve" data-id="' + esc(x.id) + '">Reinstate</button>' : '') +
          (live ? '<button data-a="tour" data-id="' + esc(x.id) + '" data-v="' + (x.tour_certified ? '0' : '1') + '">' + (x.tour_certified ? 'Remove tour cert' : 'Certify for tours') + '</button><button class="d" data-a="suspend" data-id="' + esc(x.id) + '">Suspend</button>' : '') + '</td></tr>';
      }).join('') + '</table></div>' +
      '<div class="card"><h2>Add a driver</h2><div class="form"><div><label for="dn">Name</label><input id="dn"></div><div><label for="dp">Phone</label><input id="dp" placeholder="0712 345 678"></div><div><label for="dpin">PIN (4 to 6 digits)</label><input id="dpin" type="password"></div><div><label for="dl">Licence number</label><input id="dl"></div><div><label for="db">PSV badge number</label><input id="db"></div><div><button class="p" id="dadd" type="button">Create driver</button></div></div><p class="mute">New drivers start as pending until you approve them.</p></div>';
    $('#dadd').onclick = async function () {
      try { await post('/admin/drivers', { name: $('#dn').value, phone: $('#dp').value, pin: $('#dpin').value, license_number: $('#dl').value, badge_number: $('#db').value }); toast('Driver created'); draw(); } catch (e) { fail(e); }
    };
  };

  V.shifts = async function () {
    var s = (await api('/admin/shifts')).shifts;
    var img = function (u, t) { return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener"><img class="thumb" src="' + esc(u) + '" alt="' + esc(t) + '"></a>' : ''; };
    $('#app').innerHTML = '<div class="top"><h1>Shifts</h1><span class="mute">Pre-shift checks from drivers</span></div>' + (s.map(function (x) {
      var c = x.checklist || {};
      return '<div class="card"><b>' + esc(x.driver_name) + '</b> · ' + esc(x.plate_number) + ' ' + chip(x.status) + '<br><span class="mute">Started ' + esc(new Date(x.start_time).toLocaleString('en-KE')) + ' · fuel ' + esc(x.start_fuel) + ' L' + (x.end_time ? ' to ' + esc(x.end_fuel) + ' L · ' + esc(x.mileage) + ' km' : '') + '</span><div style="margin-top:8px">' +
        img(x.selfie_url, 'Driver selfie') + img(c.tires_photo, 'Tires') + img(c.ac_photo, 'AC') + img(c.cleanliness_photo, 'Cleanliness') + img(c.camera_photo, 'Camera test') + '</div></div>';
    }).join('') || '<div class="card mute">No shifts yet.</div>');
  };

  V.revenue = async function () {
    var days = Number(sessionStorage.getItem('pr_days') || 7);
    var from = new Date(Date.now() - days * 86400000).toISOString();
    var r = await api('/admin/reports/revenue?from=' + encodeURIComponent(from));
    var by = {};
    r.daily.forEach(function (x) { var d = String(x.day).slice(0, 10); (by[d] = by[d] || {})[x.stream] = x.total; });
    var keys = Object.keys(by).sort(), sum = function (o) { return STREAMS.reduce(function (a, s) { return a + (o[s] || 0); }, 0); };
    var max = Math.max.apply(null, keys.map(function (k) { return sum(by[k]); }).concat([1]));
    $('#app').innerHTML = '<div class="top"><h1>Revenue</h1><div><button data-days="1">Today</button><button data-days="7">7 days</button><button data-days="30">30 days</button><button id="csv">Download CSV</button></div></div>' +
      '<div class="card"><h2>Last ' + days + ' day' + (days > 1 ? 's' : '') + '</h2>' + (keys.length ? '<div class="bars">' + keys.map(function (k) {
        return '<div class="c">' + esc(k.slice(5)) + STREAMS.map(function (s, i) { return '<i style="height:' + ((by[k][s] || 0) / max * 100) + '%;background:' + COL[i] + '"></i>'; }).join('') + '</div>';
      }).join('') + '</div>' : '<p class="mute">No paid trips in this period yet.</p>') +
      '<p class="leg">' + STREAMS.map(function (s, i) { return '<span><i style="background:' + COL[i] + '"></i>' + s.toLowerCase() + '</span>'; }).join('') + '</p></div>' +
      '<div class="card scroll"><table><tr><th>Stream</th><th>Total</th></tr>' + STREAMS.map(function (s) { return '<tr><td>' + s.toLowerCase() + '</td><td>' + kes(r.totals[s]) + '</td></tr>'; }).join('') + '<tr><td><b>All streams</b></td><td><b>' + kes(sum(r.totals)) + '</b></td></tr></table></div>';
    $('#csv').onclick = function () {
      var t = 'day,' + STREAMS.join(',') + '\n' + keys.map(function (k) { return k + ',' + STREAMS.map(function (s) { return by[k][s] || 0; }).join(','); }).join('\n');
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = 'revenue.csv'; a.click();
    };
  };

  V.maintenance = async function () {
    var t = (await api('/admin/maintenance')).tickets;
    $('#app').innerHTML = '<div class="top"><h1>Maintenance</h1></div>' + (t.filter(function (x) { return x.status !== 'DONE'; }).map(function (x) {
      return '<div class="card"><b>' + esc(x.plate_number) + '</b>: ' + esc(x.description) + '<br>' + chip(x.priority) + ' ' + chip(x.status) + ' <span class="mute">' + esc(x.assigned_to || '') + '</span><br>' +
        (x.status === 'OPEN' ? '<button class="p" data-a="mech" data-id="' + esc(x.id) + '">Assign mechanic</button>' : '') +
        (x.status === 'ASSIGNED' ? '<button data-a="prog" data-id="' + esc(x.id) + '">Mark in progress</button>' : '') +
        (x.status !== 'OPEN' ? '<button class="p" data-a="done" data-id="' + esc(x.id) + '">Complete and return to fleet</button>' : '') + '</div>';
    }).join('') || '<div class="card mute">No open tickets. Flag a vehicle from the Fleet page to create one.</div>');
  };

  V.incidents = async function () {
    var res = await Promise.all([api('/admin/incidents'), api('/admin/drivers')]);
    var open = res[0].incidents.filter(function (i) { return i.status === 'OPEN'; });
    $('#app').innerHTML = '<div class="top"><h1>Incidents</h1></div>' + (open.map(function (i) {
      return '<div class="card"><b>' + esc(i.driver_name || 'Unknown driver') + '</b> ' + chip(i.severity) + '<p>' + esc(i.description) + '</p><div class="fwrap" id="if-' + esc(i.id) + '"></div><button data-a="ifoot" data-id="' + esc(i.id) + '">View camera footage</button>' +
        '<button data-a="resolve" data-r="WARNING" data-id="' + esc(i.id) + '">Issue warning</button><button class="d" data-a="resolve" data-r="SUSPENSION" data-id="' + esc(i.id) + '">Suspend driver</button><button data-a="resolve" data-r="DISMISS" data-id="' + esc(i.id) + '">Close case</button></div>';
    }).join('') || '<div class="card mute">No open incidents.</div>') +
      '<div class="card"><h2>Log an incident</h2><div class="form"><div><label for="id">Driver</label><select id="id">' + res[1].drivers.map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>'; }).join('') + '</select></div>' +
      '<div><label for="is">Severity</label><select id="is"><option>LOW</option><option selected>MEDIUM</option><option>HIGH</option></select></div><div><label for="ix">What happened</label><input id="ix"></div><div><button class="p" id="iadd" type="button">Log incident</button></div></div></div>';
    $('#iadd').onclick = async function () { try { await post('/admin/incidents', { driver_id: $('#id').value, severity: $('#is').value, description: $('#ix').value }); toast('Incident logged'); draw(); } catch (e) { fail(e); } };
  };


  // ---------- payouts and footage ----------
  var mb = function (n) { return (Number(n) / 1048576).toFixed(1) + ' MB'; };
  function clipRow(c) {
    return '<tr><td>' + esc(c.plate_number || '') + '</td><td>' + esc(new Date(c.started_at).toLocaleString('en-KE')) + '</td><td>' + c.duration_s + ' s</td><td>' + mb(c.bytes) + '</td><td>' + (c.hold ? chip('HOLD') : '') + '</td><td>' +
      '<button class="p" data-a="play" data-id="' + esc(c.id) + '">Play</button><button data-a="hold" data-id="' + esc(c.id) + '" data-h="' + (c.hold ? '0' : '1') + '">' + (c.hold ? 'Release hold' : 'Keep (hold)') + '</button></td></tr>';
  }
  V.payouts = async function () {
    var p = (await api('/admin/payouts')).payouts;
    var d = function (x) { return new Date(x).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }); };
    $('#app').innerHTML = '<div class="top"><h1>Driver payouts</h1><button id="pgen" data-a="pgen">Create this week&rsquo;s payouts</button></div>' +
      '<p class="mute">Payouts are created every Monday (Nairobi time) for completed work and wait here. Only an admin can approve one, which sends the money by M-Pesa.</p>' +
      '<div class="card scroll">' + (p.length ? '<table><tr><th>Driver</th><th>Period</th><th>Trips</th><th>Gross</th><th>Commission</th><th>Net</th><th>Status</th><th></th></tr>' + p.map(function (x) {
        return '<tr><td>' + esc(x.driver_name) + '<br><span class="mute">' + esc(x.phone) + '</span></td><td>' + d(x.period_start) + ' to ' + d(x.period_end) + '</td><td>' + x.trips + '</td><td>' + kes(x.gross) + '</td><td>' + kes(x.commission) + '</td><td><b>' + kes(x.net) + '</b></td><td>' + chip(x.status) +
          (x.failure_reason ? '<br><span class="mute">' + esc(x.failure_reason) + '</span>' : '') + (x.receipt_ref ? '<br><span class="mute">' + esc(x.receipt_ref) + '</span>' : '') + '</td><td>' +
          (x.status === 'PENDING' || x.status === 'FAILED' ? '<button class="p" data-a="papprove" data-id="' + esc(x.id) + '" data-name="' + esc(x.driver_name) + '" data-phone="' + esc(x.phone) + '" data-net="' + esc(x.net) + '">Approve and send</button><button class="d" data-a="pcancel" data-id="' + esc(x.id) + '">Cancel</button>' : '') + '</td></tr>';
      }).join('') + '</table>' : '<p class="mute">No payouts yet. They appear after the first Monday with completed trips.</p>') + '</div>';
  };
  V.footage = async function () {
    var res = await Promise.all([api('/admin/footage'), api('/admin/fleet/live')]);
    $('#app').innerHTML = '<div class="top"><h1>Camera footage</h1></div>' +
      '<p class="mute">Clips are deleted after ' + esc(res[0].retention_days) + ' days unless held. Every viewing is logged. Playback links expire after 5 minutes.</p>' +
      '<div class="card fwrap"><video controls hidden></video></div>' +
      '<div class="card scroll">' + (res[0].clips.length ? '<table><tr><th>Vehicle</th><th>Started</th><th>Length</th><th>Size</th><th></th><th></th></tr>' + res[0].clips.map(clipRow).join('') + '</table>' : '<p class="mute">No clips in the last 7 days. Cameras upload clips with the vehicle&rsquo;s camera key (set one from the Fleet page).</p>') + '</div>';
  };

  // ---------- actions (event delegation) ----------
  document.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-a],[data-v],[data-days]');
    if (!b) return;
    try {
      if (b.dataset.days) { sessionStorage.setItem('pr_days', b.dataset.days); return draw(); }
      if (b.dataset.v && !b.dataset.a) { e.preventDefault(); selVehicle = b.dataset.v; return renderFleetPanel(); }
      var a = b.dataset.a, id = b.dataset.id;
      if (a === 'approve') { await post('/admin/drivers/' + id + '/approve'); toast('Driver activated'); }
      else if (a === 'suspend') { if (!confirm('Suspend this driver?')) return; await post('/admin/drivers/' + id + '/suspend'); toast('Driver suspended'); }
      else if (a === 'tour') { await post('/admin/drivers/' + id + '/training', { tour_certified: b.dataset.v === '1' }); toast('Updated'); }
      else if (a === 'flag') { var d = prompt('What needs fixing?'); if (!d) return; await post('/admin/maintenance', { vehicle_id: selVehicle, description: d, priority: 'MEDIUM' }); return toast('Maintenance ticket created'); }
      else if (a === 'disable') { if (!confirm('Disable this vehicle?')) return; await post('/admin/vehicles/' + selVehicle + '/disable'); toast('Vehicle disabled'); return V.fleet(); }
      else if (a === 'mech') { var n = prompt('Mechanic name'); if (!n) return; await api('/admin/maintenance/' + id, { method: 'PATCH', body: { status: 'ASSIGNED', assigned_to: n } }); }
      else if (a === 'prog') { await api('/admin/maintenance/' + id, { method: 'PATCH', body: { status: 'IN_PROGRESS' } }); }
      else if (a === 'done') { await api('/admin/maintenance/' + id, { method: 'PATCH', body: { status: 'DONE' } }); toast('Vehicle returned to fleet'); }
      else if (a === 'pgen') { var g = await post('/admin/payouts/generate'); toast(g.created + ' payout(s) created'); }
      else if (a === 'papprove') { if (!confirm('Send KES ' + b.dataset.net + ' to ' + b.dataset.name + ' (' + b.dataset.phone + ') by M-Pesa? This cannot be undone.')) return; await post('/admin/payouts/' + id + '/approve'); toast('Payout sent to M-Pesa'); }
      else if (a === 'pcancel') { if (!confirm('Cancel this payout? The trips roll into the next one.')) return; await post('/admin/payouts/' + id + '/cancel'); toast('Payout cancelled'); }
      else if (a === 'play') { var u = await post('/admin/footage/' + id + '/play'); var w = b.closest('.fwrap') || document; var vid = w.querySelector('video') || document.querySelector('video'); vid.hidden = false; vid.src = u.url; vid.play().catch(function () {}); return; }
      else if (a === 'hold') { await post('/admin/footage/' + id + '/hold', { hold: b.dataset.h === '1' }); toast('Updated'); }
      else if (a === 'ifoot') {
        var cl = (await api('/admin/incidents/' + id + '/footage')).clips, box = document.getElementById('if-' + id);
        box.innerHTML = cl.length ? '<table><tr><th></th><th>Started</th><th>Length</th><th>Size</th><th></th><th></th></tr>' + cl.map(clipRow).join('') + '</table><video controls hidden></video>' : '<p class="mute">No camera clips found around this incident.</p>';
        return;
      }
      else if (a === 'camkey') { if (!selVehicle || !confirm('Create a new camera key? Any existing key stops working.')) return; var k = await post('/admin/vehicles/' + selVehicle + '/camera-key'); prompt('Vehicle ID: ' + k.vehicle_id + '\n\nCamera key (copy it now, it is shown only once):', k.camera_key); return; }
      else if (a === 'resolve') { await post('/admin/incidents/' + id + '/resolve', { action: b.dataset.r }); toast('Incident closed'); }
      draw();
    } catch (err) { fail(err); }
  });

  async function draw() {
    clearInterval(timer);
    var k = (location.hash || '#overview').slice(1);
    if (!V[k]) k = 'overview';
    document.querySelectorAll('nav a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + k); });
    if (k !== 'overview' && k !== 'fleet' && map) { map.remove(); map = null; }
    $('#app').innerHTML = '<p class="mute">Loading...</p>';
    try { await V[k](); } catch (e) { if (tok) $('#app').innerHTML = '<div class="card"><b>' + esc(e.message) + '</b><br><button id="retry" type="button">Try again</button></div>'; var r = $('#retry'); if (r) r.onclick = draw; }
  }
  addEventListener('hashchange', function () { if (tok) draw(); });
  showApp(!!tok);
})();
