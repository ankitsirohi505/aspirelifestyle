// Aspire Concierge chat widget.
// A custom front end, styled like the Salesforce Enhanced Chat window, that talks to the
// Aspire Travel Concierge Agentforce agent through a public Apex REST endpoint and renders
// the rich cards (profile, flight options, booking) produced by the agent's actions.
(function () {
  'use strict';

  var CONFIG = {
    endpoint: 'https://orgfarm-e88355df2d-dev-ed.develop.my.site.com/ESWAspireConciergeChat1791041414849vforc/services/apexrest/aspireConcierge/chat',
    agentName: 'Aspire Travel Concierge',
    launcherText: 'Ask Me Anything',
    welcome: 'Welcome to Aspire Concierge. I can plan and book trips tailored to you. To get started, what is your email address?',
    requestTimeoutMs: 35000,
    storageKey: 'aspireConciergeChat.v1'
  };

  var ICONS = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5c4.97 0 9 3.36 9 7.5s-4.03 7.5-9 7.5c-1.05 0-2.06-.15-3-.43L4.5 20l1.08-3.6C4.03 15.06 3 13.12 3 11c0-4.14 4.03-7.5 9-7.5z"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l7 7 7-7"/></svg>',
    agent: '<svg viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="10" r="5"/><path d="M3.5 25c.8-4.6 4.3-7.5 8.5-7.5 1.7 0 3.2.4 4.5 1.2"/><path d="M23 18v8M19 22h8"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    cloud: '<svg viewBox="0 0 44 30"><path fill="#00A1E0" d="M18.3 3.3A7.7 7.7 0 0 1 23.9 1a7.8 7.8 0 0 1 6.8 4 9.4 9.4 0 0 1 3.8-.8A9.5 9.5 0 0 1 44 13.7a9.5 9.5 0 0 1-11.3 9.3 6.9 6.9 0 0 1-9 2.8 7.9 7.9 0 0 1-14.6-.4 7.3 7.3 0 0 1-1.5.2A7.4 7.4 0 0 1 4 11.9a8.4 8.4 0 0 1 7.4-12.5 8.4 8.4 0 0 1 6.9 3.9z"/></svg>'
  };

  var AIRLINE_COLOURS = {
    'Emirates': '#c8102e', 'British Airways': '#075aaa', 'Virgin Atlantic': '#8f0d3c',
    'Qatar Airways': '#5c0632', 'Lufthansa': '#05164d', 'Singapore Airlines': '#f5a623'
  };

  // ───────────── state ─────────────
  var state = load() || freshState();
  var busy = false;
  var els = {};

  function freshState() {
    return { open: false, started: false, items: [], agentSessionId: null, customerSessionId: null, capturedEmail: null };
  }
  function load() {
    try { return JSON.parse(sessionStorage.getItem(CONFIG.storageKey)); } catch (e) { return null; }
  }
  function save() {
    try { sessionStorage.setItem(CONFIG.storageKey, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }

  // ───────────── helpers ─────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function richText(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '<a href="mailto:$1">$1</a>')
      .replace(/\n/g, '<br>');
  }
  function timeLabel(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function money(v, cur) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 0 }).format(v || 0);
    } catch (e) { return '$' + Math.round(v || 0); }
  }
  function num(v) { return new Intl.NumberFormat('en-US').format(v || 0); }

  // ───────────── DOM ─────────────
  function build() {
    var root = document.createElement('div');
    root.className = 'acw';
    root.innerHTML =
      '<button class="acw-launcher" type="button" aria-label="Open chat">' + ICONS.chat + '<span>' + esc(CONFIG.launcherText) + '</span></button>' +
      '<div class="acw-window" role="dialog" aria-label="' + esc(CONFIG.agentName) + ' chat">' +
        '<div class="acw-header">' +
          ICONS.chat.replace('<svg', '<svg class="acw-logo"') +
          '<div class="acw-title">' + esc(CONFIG.agentName) + '</div>' +
          '<button class="acw-icon-btn acw-more" type="button" aria-label="More options">' + ICONS.more + '</button>' +
          '<button class="acw-icon-btn acw-min" type="button" aria-label="Minimise chat">' + ICONS.chevron + '</button>' +
        '</div>' +
        '<div class="acw-menu" role="menu"><button type="button" class="acw-end" role="menuitem">End conversation</button></div>' +
        '<div class="acw-body" aria-live="polite"></div>' +
        '<div class="acw-composer">' +
          '<div class="acw-input-wrap">' +
            ICONS.plus.replace('<svg', '<svg class="acw-plus" aria-hidden="true"') +
            '<textarea class="acw-input" rows="1" placeholder="Type your message..." aria-label="Type your message"></textarea>' +
            '<button class="acw-send" type="button" aria-label="Send">' + ICONS.send + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="acw-footer">Powered by Agentforce from ' + ICONS.cloud + '<b>salesforce</b></div>' +
      '</div>';
    document.body.appendChild(root);

    els.root = root;
    els.launcher = root.querySelector('.acw-launcher');
    els.body = root.querySelector('.acw-body');
    els.input = root.querySelector('.acw-input');
    els.send = root.querySelector('.acw-send');
    els.menu = root.querySelector('.acw-menu');

    els.launcher.addEventListener('click', function () { setOpen(true); });
    root.querySelector('.acw-min').addEventListener('click', function () { setOpen(false); });
    root.querySelector('.acw-more').addEventListener('click', function (e) {
      e.stopPropagation();
      els.menu.classList.toggle('show');
    });
    document.addEventListener('click', function () { els.menu.classList.remove('show'); });
    root.querySelector('.acw-end').addEventListener('click', endConversation);

    els.input.addEventListener('input', function () {
      els.input.style.height = 'auto';
      els.input.style.height = Math.min(els.input.scrollHeight, 120) + 'px';
      els.send.classList.toggle('show', els.input.value.trim().length > 0);
    });
    els.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    els.send.addEventListener('click', submit);
    els.body.addEventListener('click', function (e) {
      var btn = e.target.closest('.acw-select');
      if (btn && !busy) send('Option ' + btn.getAttribute('data-rank'));
    });
  }

  function setOpen(open) {
    state.open = open;
    els.root.classList.toggle('acw-open', open);
    if (open && !state.started) {
      state.started = true;
      state.joinedAt = Date.now();
      push({ kind: 'agent', text: CONFIG.welcome, ts: Date.now() });
    }
    save();
    if (open) {
      render();
      setTimeout(function () { els.input.focus(); }, 50);
    }
  }

  function endConversation() {
    els.menu.classList.remove('show');
    state = freshState();
    state.open = true;
    save();
    setOpen(true);
  }

  // ───────────── conversation ─────────────
  function push(item) {
    state.items.push(item);
    save();
    render();
  }

  function submit() {
    var text = els.input.value.trim();
    if (!text || busy) return;
    els.input.value = '';
    els.input.style.height = 'auto';
    els.send.classList.remove('show');
    send(text);
  }

  function send(text) {
    push({ kind: 'user', text: text, ts: Date.now() });
    busy = true;
    render();

    var payload = {
      message: text,
      agentSessionId: state.agentSessionId,
      customerSessionId: state.customerSessionId,
      capturedEmail: state.capturedEmail
    };

    // A request to the Salesforce site occasionally stalls without any response; give up on it
    // after requestTimeoutMs and send it once more on a fresh request.
    function attempt(retriesLeft) {
      var controller = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (controller) controller.abort(); }, CONFIG.requestTimeoutMs);
      return fetch(CONFIG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(payload),
        cache: 'no-store',
        signal: controller ? controller.signal : undefined
      }).then(function (r) {
        clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }, function (err) {
        clearTimeout(timer);
        if (err && err.name === 'AbortError' && retriesLeft > 0) {
          console.warn('Concierge request stalled, retrying');
          return attempt(retriesLeft - 1);
        }
        throw err;
      });
    }

    attempt(1)
      .then(function (res) {
        if (res.agentSessionId) state.agentSessionId = res.agentSessionId;
        if (res.customerSessionId) state.customerSessionId = res.customerSessionId;
        if (res.capturedEmail) state.capturedEmail = res.capturedEmail;
        var now = Date.now();
        (res.cards || []).forEach(function (c) { state.items.push({ kind: 'card', card: c, ts: now }); });
        (res.replies || []).forEach(function (t) { state.items.push({ kind: 'agent', text: t, ts: now }); });
        if (!(res.replies || []).length && !(res.cards || []).length) {
          state.items.push({ kind: 'error', text: res.error ? 'Sorry, something went wrong. Please try again.' : 'Sorry, I did not catch that. Could you try again?', ts: now });
          if (res.error) console.error('Concierge error:', res.error);
        }
      })
      .catch(function (err) {
        console.error('Concierge request failed:', err);
        state.items.push({ kind: 'error', text: 'I could not reach the concierge just now. Please check your connection and try again.', ts: Date.now() });
      })
      .then(function () {
        busy = false;
        save();
        render();
      });
  }

  // ───────────── rendering ─────────────
  function render() {
    var html = '';
    if (state.started) {
      html += '<div class="acw-system">' + esc(CONFIG.agentName) + ' joined<br>' + esc(timeLabel(state.joinedAt || Date.now())) + '</div>';
    }
    var lastFlightIdx = -1;
    state.items.forEach(function (it, i) { if (it.kind === 'card' && it.card.type === 'flightOptions') lastFlightIdx = i; });
    var bookedAfter = state.items.some(function (it, i) { return i > lastFlightIdx && it.kind === 'card' && it.card.type === 'booking'; });

    state.items.forEach(function (it, i) {
      if (it.kind === 'user') {
        html += '<div class="acw-row acw-user"><div class="acw-col"><div class="acw-bubble">' + richText(it.text) + '</div>' +
          '<div class="acw-meta">Sent · ' + esc(timeLabel(it.ts)) + '</div></div></div>';
      } else if (it.kind === 'agent' || it.kind === 'error') {
        html += '<div class="acw-row acw-agent' + (it.kind === 'error' ? ' acw-error' : '') + '"><div class="acw-avatar">' + ICONS.agent + '</div>' +
          '<div class="acw-col"><div class="acw-bubble">' + richText(it.text) + '</div>' +
          '<div class="acw-meta">' + esc(CONFIG.agentName) + ' · ' + esc(timeLabel(it.ts)) + '</div></div></div>';
      } else if (it.kind === 'card') {
        var interactive = it.card.type === 'flightOptions' && i === lastFlightIdx && !bookedAfter;
        html += '<div class="acw-card-wrap">' + renderCard(it.card, interactive) + '</div>';
      }
    });
    if (busy) {
      html += '<div class="acw-row acw-agent acw-typing"><div class="acw-avatar">' + ICONS.agent + '</div>' +
        '<div class="acw-col"><div class="acw-bubble" aria-label="Agent is typing"><span></span><span></span><span></span></div></div></div>';
    }
    els.body.innerHTML = html;
    els.send.disabled = busy;
    els.body.scrollTop = els.body.scrollHeight;
  }

  function renderCard(card, interactive) {
    var d = card.data || {};
    if (card.type === 'profile') return profileCard(d);
    if (card.type === 'flightOptions') return flightCard(d, interactive);
    if (card.type === 'booking') return bookingCard(d);
    return '';
  }

  function profileCard(p) {
    var initials = String(p.fullName || '').split(' ').filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join('');
    var tier = String(p.loyaltyTier || 'Member');
    var isNew = p.isNewCustomer === true;
    var h = '<div class="acw-card"><div class="acw-card-head"><div class="acw-prof-head">' +
      '<div class="acw-prof-avatar">' + esc(initials) + '</div>' +
      '<div class="acw-prof-who"><div class="acw-prof-status">' + (isNew ? '&#9733; New customer' : '&#10003; Returning customer') + '</div>' +
      '<div class="acw-prof-name">' + esc(p.fullName) + '</div>' +
      '<span class="acw-tier acw-tier-' + esc(tier.toLowerCase()) + '">' + esc(tier) + '</span></div>' +
      '<div class="acw-prof-points"><b>' + num(p.pointsBalance) + '</b><span>points</span></div></div></div>';
    if (isNew) {
      h += '<div class="acw-welcome"><b>Welcome to Aspire</b><p>' + esc(p.summary) + '</p></div>' +
        '<div class="acw-card-foot">We will learn your preferences as you travel with us</div></div>';
      return h;
    }
    h += '<div class="acw-stats"><div class="acw-stat"><b>' + (p.totalTrips == null ? '—' : esc(p.totalTrips)) + '</b><span>Trips taken</span></div>' +
      '<div class="acw-stat"><b>' + (p.avgTripSpend == null ? '—' : money(p.avgTripSpend)) + '</b><span>Avg trip spend</span></div></div>';
    var prefs = [['Home airport', p.homeAirport], ['Airline', p.preferredAirline], ['Departs', p.preferredDeparture], ['Seat', p.seatPreference], ['Hotels', p.hotelPreference]]
      .filter(function (x) { return x[1]; });
    if (prefs.length) {
      h += '<div class="acw-label">What we know you like</div><div class="acw-chips">' +
        prefs.map(function (x) { return '<div class="acw-chip"><small>' + esc(x[0]) + '</small>' + esc(x[1]) + '</div>'; }).join('') + '</div>';
    }
    if (p.travellingParty) h += '<div class="acw-note">' + esc(p.travellingParty) + '</div>';
    if (p.favouriteDestinations) h += '<div class="acw-note"><b>Loves:</b> ' + esc(p.favouriteDestinations) + '</div>';
    h += '<div class="acw-card-foot">Personalised from ' + esc(p.dataSource) + '</div></div>';
    return h;
  }

  function flightCard(d, interactive) {
    var opts = d.options || [];
    var h = '<div class="acw-card acw-fo"><div class="acw-card-head">' +
      '<div class="acw-fo-route">' + esc(d.route) + '</div>' +
      '<div class="acw-fo-meta">' + esc(d.travelDates) + ' · ' + esc(d.passengers) + '</div>' +
      '<div class="acw-fo-sub">Ranked for you</div></div>';
    opts.forEach(function (o) {
      var stopsText = o.stops === 0 ? 'Non-stop' : o.stops + ' stop' + (o.stops > 1 ? 's' : '');
      h += '<div class="acw-opt' + (o.recommended ? ' acw-opt-best' : '') + '">' +
        (o.recommended ? '<div class="acw-ribbon">&#9733; Best match for you</div>' : '') +
        '<div class="acw-opt-top"><div class="acw-rank">' + esc(o.rank) + '</div>' +
        '<div class="acw-logo" style="background:' + (AIRLINE_COLOURS[o.airline] || '#4a4a4a') + '">' + esc(String(o.flightNumber || '').slice(0, 2)) + '</div>' +
        '<div class="acw-airline"><b>' + esc(o.airline) + '</b><span>' + esc(o.flightNumber) + ' · ' + esc(o.cabin) + '</span></div>' +
        '<div class="acw-price"><b>' + money(o.totalPrice, d.currencyCode) + '</b><span>' + money(o.pricePerAdult, d.currencyCode) + ' / adult</span></div></div>' +
        '<div class="acw-times"><div class="acw-t"><b>' + esc(o.departTime) + '</b><span>' + esc(o.origin) + '</span></div>' +
        '<div class="acw-line">' + esc(o.duration) + '<div class="acw-bar">&#9992;</div>' +
        '<div class="acw-stops' + (o.stops === 0 ? ' acw-stops-direct' : '') + '">' + esc(stopsText) + '</div></div>' +
        '<div class="acw-t acw-t-right"><b>' + esc(o.arriveTime) + '</b><span>' + esc(o.destination) + '</span></div></div>' +
        '<div class="acw-score"><div class="acw-score-row"><b>' + esc(o.matchScore) + '% match</b>' +
        (o.seatsLeft != null && o.seatsLeft <= 5 ? '<span class="acw-seats">Only ' + esc(o.seatsLeft) + ' seats left</span>' : '') + '</div>' +
        '<div class="acw-track"><div class="acw-fill" style="width:' + Math.max(0, Math.min(100, o.matchScore || 0)) + '%"></div></div>' +
        '<div class="acw-reason">' + esc(o.reason) + '</div></div>' +
        (interactive ? '<button type="button" class="acw-select" data-rank="' + esc(o.rank) + '">Select this flight</button>' : '') +
        '</div>';
    });
    h += '<div class="acw-fo-foot">' + (interactive ? 'Select a flight, or reply with 1, 2 or 3' : 'Options presented') + ' · Case ' + esc(d.travelCaseNumber) + '</div></div>';
    return h;
  }

  function bookingCard(b) {
    var parts = String(b.route || '').split('→');
    return '<div class="acw-card"><div class="acw-bk-head"><div class="acw-check">&#10003;</div><div>' +
      '<div class="acw-bk-status">Booking ' + esc(b.status) + '</div>' +
      '<div class="acw-bk-reflabel">Booking reference</div><div class="acw-bk-ref">' + esc(b.bookingReference) + '</div></div></div>' +
      '<div class="acw-pass"><div class="acw-pass-airline">' + esc(b.airline) + ' · ' + esc(b.flightNumber) + '</div>' +
      '<div class="acw-pass-route"><div class="acw-pass-end"><b>' + esc((parts[0] || '').trim()) + '</b><span>' + esc(b.departTime) + '</span></div>' +
      '<div class="acw-pass-plane">&#9992;</div>' +
      '<div class="acw-pass-end acw-pass-end-right"><b>' + esc((parts[1] || '').trim()) + '</b><span>' + esc(b.arriveTime) + '</span></div></div>' +
      '<div class="acw-grid"><div><small>Date</small><b>' + esc(b.departDate) + '</b></div><div><small>Cabin</small><b>' + esc(b.cabin) + '</b></div>' +
      '<div><small>Passengers</small><b>' + esc(b.passengers) + '</b></div><div><small>Total paid</small><b>' + money(b.totalPrice, b.currencyCode) + '</b></div></div></div>' +
      '<div class="acw-tear"></div>' +
      '<div class="acw-pts"><b>+' + num(b.pointsEarned) + '</b><div><b>' + esc(b.loyaltyTier) + ' points earned</b><span>New balance: ' + num(b.newPointsBalance) + ' points</span></div></div>' +
      '<div class="acw-next">' + esc(b.nextStep) + '</div></div>';
  }

  // ───────────── start ─────────────
  function init() {
    build();
    if (state.open) setOpen(true);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
