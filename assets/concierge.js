// Aspire Concierge chat widget.
// A custom front end, styled like the Salesforce Enhanced Chat window, that talks to the
// Aspire Travel Concierge Agentforce agent through a public Apex REST endpoint and renders
// the rich cards (profile, flight options, booking) produced by the agent's actions.
(function () {
  'use strict';

  var CONFIG = {
    // The same endpoint on two Salesforce addresses (different certificates, so separate browser
    // connections). Normally only the first is used.
    endpoints: [
      'https://orgfarm-e88355df2d-dev-ed.develop.my.salesforce-sites.com/aspireconcierge/services/apexrest/aspireConcierge/assist',
      'https://orgfarm-e88355df2d-dev-ed.develop.my.site.com/ESWAspireConciergeChat1791041414849vforc/services/apexrest/aspireConcierge/assist'
    ],
    // If no reply arrives, send a copy on a fresh connection at these delays. Nothing is cancelled.
    backupDelaysMs: [6000, 15000, 30000],
    // While the chat is open, touch both connections regularly so an idle one is never silently dropped.
    heartbeatMs: 20000,
    historyTurns: 12,
    agentName: 'Aspire Travel Concierge',
    launcherText: 'Ask Me Anything',
    welcome: 'Welcome to Aspire Concierge. I can plan and book trips tailored to you. To get started, what is your email address?',
    slowNoticeMs: 8000,
    verySlowNoticeMs: 30000,
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

  // Card types the widget shows; others (such as the customer profile) are used by the agent only.
  var SHOWN_CARDS = ['flightOptions', 'booking', 'hotelOptions', 'hotelBooking', 'extras', 'tripSummary'];

  var AIRLINE_COLOURS = {
    'Emirates': '#c8102e', 'British Airways': '#075aaa', 'Virgin Atlantic': '#8f0d3c',
    'Qatar Airways': '#5c0632', 'Lufthansa': '#05164d', 'Singapore Airlines': '#f5a623'
  };

  // ───────────── state ─────────────
  // The conversation lives only in this page: every reload starts closed with a fresh chat.
  var state = freshState();
  var busy = false;
  var slow = 0;
  var slowTimer = null, verySlowTimer = null;
  var els = {};

  function freshState() {
    return { open: false, started: false, items: [], trip: {} };
  }
  function save() { /* intentionally not persisted */ }

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
      if (busy) return;
      var btn = e.target.closest('.acw-select');
      if (btn) { send('Option ' + btn.getAttribute('data-rank')); return; }
      var pick = e.target.closest('.acw-ex-pick');
      if (pick) {
        pick.classList.toggle('on');
        pick.textContent = pick.classList.contains('on') ? '\u2713 Added' : 'Add';
        var card = pick.closest('.acw-ex');
        var n = card.querySelectorAll('.acw-ex-pick.on').length;
        card.querySelectorAll('.acw-ex-book').forEach(function (b) { b.disabled = n === 0; });
        return;
      }
      var book = e.target.closest('.acw-ex-book');
      if (book) {
        var ranks = [].map.call(book.closest('.acw-ex').querySelectorAll('.acw-ex-pick.on'), function (b) { return b.getAttribute('data-rank'); });
        if (!ranks.length) return;
        var list = ranks.length === 1 ? 'option ' + ranks[0] : 'options ' + ranks.slice(0, -1).join(', ') + ' and ' + ranks[ranks.length - 1];
        send('I would like ' + list + (book.getAttribute('data-points') === '1' ? ', using my points' : ', paying by card'));
        return;
      }
      if (e.target.closest('.acw-ex-skip')) send('No thanks');
    });
  }

  var heartbeat = null;
  function beat() {
    CONFIG.endpoints.forEach(function (url) {
      fetch(url, { method: 'GET', cache: 'no-store' }).catch(function () { /* ignore */ });
    });
  }
  function setHeartbeat(on) {
    clearInterval(heartbeat);
    heartbeat = null;
    if (on) {
      beat();
      heartbeat = setInterval(function () { if (!document.hidden) beat(); }, CONFIG.heartbeatMs);
    }
  }

  function setOpen(open) {
    state.open = open;
    els.root.classList.toggle('acw-open', open);
    if (open && !state.started) {
      state.started = true;
      state.joinedAt = Date.now();
      push({ kind: 'agent', texts: [CONFIG.welcome], cards: [], ts: Date.now() });
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
    slow = 0;
    clearTimeout(slowTimer);
    clearTimeout(verySlowTimer);
    slowTimer = setTimeout(function () { if (busy) { slow = 1; render(); } }, CONFIG.slowNoticeMs);
    verySlowTimer = setTimeout(function () { if (busy) { slow = 2; render(); } }, CONFIG.verySlowNoticeMs);
    render();

    // The backend is stateless: send the recent conversation and the trip state with each message.
    var history = [];
    state.items.forEach(function (it) {
      if (it.kind === 'user') history.push({ role: 'customer', text: it.text });
      else if (it.kind === 'agent') (it.texts || []).forEach(function (t) { history.push({ role: 'agent', text: t }); });
    });
    history.pop(); // the message being sent goes separately
    var payload = {
      message: text,
      history: history.slice(-CONFIG.historyTurns),
      state: state.trip || {}
    };

    // A pooled browser connection to Salesforce can go silently dead while the page is idle; a
    // message sent on it waits minutes for TCP to give up. So if no reply arrives quickly, send a
    // copy to the second address, which always uses a fresh connection. Requests are never
    // cancelled (the Salesforce edge can throttle clients that cancel); the first reply wins and
    // late duplicates are ignored. Duplicates are harmless on the server (booking is idempotent).
    new Promise(function (resolve, reject) {
      var done = false, failed = 0, sent = 0, timers = [];
      var total = CONFIG.backupDelaysMs.length + 1;
      function send(url) {
        sent++;
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then(function (json) {
            if (done) return;
            done = true;
            timers.forEach(clearTimeout);
            resolve(json);
          })
          .catch(function (err) {
            if (done) return;
            failed++;
            console.warn('Concierge request failed (' + (err && (err.name + ': ' + err.message)) + ')');
            if (failed >= total) { done = true; timers.forEach(clearTimeout); reject(err); }
            else if (failed >= sent) send(CONFIG.endpoints[sent % CONFIG.endpoints.length]);
          });
      }
      send(CONFIG.endpoints[0]);
      CONFIG.backupDelaysMs.forEach(function (ms, i) {
        timers.push(setTimeout(function () {
          if (!done && sent < total) send(CONFIG.endpoints[(i + 1) % CONFIG.endpoints.length]);
        }, ms));
      });
    })
      .then(function (res) {
        if (res.state) state.trip = res.state;
        var now = Date.now();
        var cards = (res.cards || []).filter(function (c) { return SHOWN_CARDS.indexOf(c.type) !== -1; });
        var texts = (res.replies || []).filter(function (t) { return t && String(t).trim(); });
        if (texts.length || cards.length) {
          state.items.push({ kind: 'agent', texts: texts, cards: cards, ts: now });
        } else {
          state.items.push({ kind: 'error', texts: [res.error ? 'Sorry, something went wrong. Please try again.' : 'Sorry, I did not catch that. Could you try again?'], ts: now });
          if (res.error) console.error('Concierge error:', res.error);
        }
      })
      .catch(function (err) {
        console.error('Concierge request failed:', err);
        state.items.push({ kind: 'error', texts: ['I could not reach the concierge just now. Please check your connection and try again.'], ts: Date.now() });
      })
      .then(function () {
        clearTimeout(slowTimer);
        clearTimeout(verySlowTimer);
        slow = 0;
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
    // Only the newest list of each kind is clickable, and only until the customer has moved past it.
    var lastFlightIdx = -1, bookedAfter = false, lastHotelIdx = -1, lastExtrasIdx = -1;
    state.items.forEach(function (it, i) {
      (it.cards || []).forEach(function (c) {
        if (c.type === 'flightOptions') { lastFlightIdx = i; bookedAfter = false; lastHotelIdx = -1; lastExtrasIdx = -1; }
        if (c.type === 'booking' && lastFlightIdx !== -1) bookedAfter = true;
        if (c.type === 'hotelOptions') lastHotelIdx = i;
        if (c.type === 'hotelBooking') lastHotelIdx = -1;
        if (c.type === 'extras') { lastHotelIdx = -1; lastExtrasIdx = i; }
        if (c.type === 'tripSummary') { lastHotelIdx = -1; lastExtrasIdx = -1; }
      });
    });
    var stage = (state.trip && state.trip.stage) || '';
    if (stage !== 'HOTELS') lastHotelIdx = -1;
    if (stage !== 'EXTRAS') lastExtrasIdx = -1;

    state.items.forEach(function (it, i) {
      if (it.kind === 'user') {
        html += '<div class="acw-row acw-user"><div class="acw-col"><div class="acw-bubble">' + richText(it.text) + '</div>' +
          '<div class="acw-meta">Sent · ' + esc(timeLabel(it.ts)) + '</div></div></div>';
        return;
      }
      var cards = it.cards || [];
      html += '<div class="acw-row acw-agent' + (it.kind === 'error' ? ' acw-error' : '') + (cards.length ? ' acw-has-card' : '') + '">' +
        '<div class="acw-avatar">' + ICONS.agent + '</div><div class="acw-col">';
      (it.texts || []).forEach(function (t) { html += '<div class="acw-bubble">' + richText(t) + '</div>'; });
      cards.forEach(function (c) {
        var interactive = (c.type === 'flightOptions' && i === lastFlightIdx && !bookedAfter) ||
          (c.type === 'hotelOptions' && i === lastHotelIdx) || (c.type === 'extras' && i === lastExtrasIdx);
        html += '<div class="acw-card-inline">' + renderCard(c, interactive) + '</div>';
      });
      html += '<div class="acw-meta">' + esc(CONFIG.agentName) + ' · ' + esc(timeLabel(it.ts)) + '</div></div></div>';
    });
    if (busy) {
      html += '<div class="acw-row acw-agent acw-typing"><div class="acw-avatar">' + ICONS.agent + '</div>' +
        '<div class="acw-col"><div class="acw-bubble" aria-label="Agent is typing"><span></span><span></span><span></span></div>' +
        (slow === 1 ? '<div class="acw-meta">Still working on it…</div>' : '') +
        (slow === 2 ? '<div class="acw-meta">Taking longer than usual. Please stay with me…</div>' : '') + '</div></div>';
    }
    els.body.innerHTML = html;
    els.send.disabled = busy;
    // Show a new agent reply from its first line, so a tall card never hides the message above it.
    var rows = els.body.querySelectorAll('.acw-row');
    var last = rows[rows.length - 1];
    if (!busy && last && last.classList.contains('acw-has-card')) {
      els.body.scrollTop = Math.max(0, last.offsetTop - 12);
    } else {
      els.body.scrollTop = els.body.scrollHeight;
    }
  }

  function renderCard(card, interactive) {
    var d = card.data || {};
    if (card.type === 'profile') return profileCard(d);
    if (card.type === 'flightOptions') return flightCard(d, interactive);
    if (card.type === 'booking') return bookingCard(d);
    if (card.type === 'hotelOptions') return hotelCard(d, interactive);
    if (card.type === 'hotelBooking') return hotelBookingCard(d);
    if (card.type === 'extras') return extrasCard(d, interactive);
    if (card.type === 'tripSummary') return summaryCard(d);
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
    // New customers have no history, so there is nothing to "match"; show plain facts instead.
    var personal = d.personalised !== false;
    var h = '<div class="acw-card acw-fo"><div class="acw-card-head">' +
      '<div class="acw-fo-route">' + esc(d.route) + '</div>' +
      '<div class="acw-fo-meta">' + esc(d.travelDates) + ' · ' + esc(d.passengers) + '</div>' +
      '<div class="acw-fo-sub">' + (personal ? 'Ranked for you' : 'Sorted by stops and fare') + '</div></div>';
    opts.forEach(function (o) {
      var stopsText = o.stops === 0 ? 'Non-stop' : o.stops + ' stop' + (o.stops > 1 ? 's' : '');
      h += '<div class="acw-opt' + (o.recommended ? ' acw-opt-best' : '') + '">' +
        (o.recommended ? '<div class="acw-ribbon">&#9733; ' + (personal ? 'Best match for you' : 'Top pick') + '</div>' : '') +
        '<div class="acw-opt-top"><div class="acw-rank">' + esc(o.rank) + '</div>' +
        '<div class="acw-logo" style="background:' + (AIRLINE_COLOURS[o.airline] || '#4a4a4a') + '">' + esc(String(o.flightNumber || '').slice(0, 2)) + '</div>' +
        '<div class="acw-airline"><b>' + esc(o.airline) + '</b><span>' + esc(o.flightNumber) + ' · ' + esc(o.cabin) + '</span></div>' +
        '<div class="acw-price"><b>' + money(o.totalPrice, d.currencyCode) + '</b><span>' + money(o.pricePerAdult, d.currencyCode) + ' / adult</span></div></div>' +
        '<div class="acw-times"><div class="acw-t"><b>' + esc(o.departTime) + '</b><span>' + esc(o.origin) + '</span></div>' +
        '<div class="acw-line">' + esc(o.duration) + '<div class="acw-bar">&#9992;</div>' +
        '<div class="acw-stops' + (o.stops === 0 ? ' acw-stops-direct' : '') + '">' + esc(stopsText) + '</div></div>' +
        '<div class="acw-t acw-t-right"><b>' + esc(o.arriveTime) + '</b><span>' + esc(o.destination) + '</span></div></div>' +
        '<div class="acw-score"><div class="acw-score-row">' + (personal ? '<b>' + esc(o.matchScore) + '% match</b>' : '<span></span>') +
        (o.seatsLeft != null && o.seatsLeft <= 5 ? '<span class="acw-seats">Only ' + esc(o.seatsLeft) + ' seats left</span>' : '') + '</div>' +
        (personal ? '<div class="acw-track"><div class="acw-fill" style="width:' + Math.max(0, Math.min(100, o.matchScore || 0)) + '%"></div></div>' : '') +
        '<div class="acw-reason">' + esc(o.reason) + '</div></div>' +
        (interactive ? '<button type="button" class="acw-select" data-rank="' + esc(o.rank) + '">Select this flight</button>' : '') +
        '</div>';
    });
    h += '<div class="acw-fo-foot">' + (interactive ? 'Select a flight, or reply with 1, 2 or 3' : 'Options presented') + '</div></div>';
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

  function stars(n) { n = Math.max(0, Math.min(5, n || 0)); return n ? '<span class="acw-stars">' + new Array(n + 1).join('&#9733;') + '</span>' : ''; }

  function hotelCard(d, interactive) {
    var opts = d.options || [];
    var personal = d.personalised !== false;
    var h = '<div class="acw-card acw-fo"><div class="acw-card-head acw-ht-head">' +
      '<div class="acw-fo-route">' + esc(d.city) + ' stays</div>' +
      '<div class="acw-fo-meta">' + esc(d.stayDates) + ' · ' + esc(d.guests) + '</div>' +
      '<div class="acw-fo-sub">' + (personal ? 'Picked for you' : 'Sorted by rating and location') + '</div></div>';
    opts.forEach(function (o) {
      h += '<div class="acw-opt' + (o.recommended ? ' acw-opt-best' : '') + '">' +
        (o.recommended ? '<div class="acw-ribbon">&#9733; ' + (personal ? 'Best match for you' : 'Top pick') + '</div>' : '') +
        '<div class="acw-opt-top"><div class="acw-rank">' + esc(o.rank) + '</div>' +
        '<div class="acw-airline"><b>' + esc(o.name) + '</b><span>' + stars(o.stars) + ' · ' + esc(o.area) +
        (o.distanceKm != null ? ' · ' + esc(o.distanceKm) + ' km from centre' : '') + '</span></div>' +
        '<div class="acw-price"><b>' + money(o.totalPrice) + '</b><span>' + money(o.pricePerNight) + ' / night</span></div></div>' +
        '<div class="acw-ht-facts">' + esc(o.nights) + ' nights · ' + esc(o.rooms) + ' × ' + esc(o.roomType) +
        (o.guestRating != null ? ' · <b>' + esc(o.guestRating) + '</b>/10 guests' : '') + '</div>' +
        ((o.amenities || []).length ? '<div class="acw-ht-amen">' + o.amenities.slice(0, 4).map(function (a) { return '<span>' + esc(a) + '</span>'; }).join('') + '</div>' : '') +
        (o.perk ? '<div class="acw-ht-perk">&#127873; ' + esc(o.perk) + '</div>' : '') +
        '<div class="acw-score">' + (personal ? '<div class="acw-score-row"><b>' + esc(o.matchScore) + '% match</b></div>' +
          '<div class="acw-track"><div class="acw-fill" style="width:' + Math.max(0, Math.min(100, o.matchScore || 0)) + '%"></div></div>' : '') +
        '<div class="acw-reason">' + esc(o.reason) + '</div></div>' +
        (interactive ? '<button type="button" class="acw-select" data-rank="' + esc(o.rank) + '">Select this hotel</button>' : '') +
        '</div>';
    });
    h += '<div class="acw-fo-foot">' + (interactive ? 'Select a hotel, or tell me if you would rather skip it' : 'Hotels presented') + '</div></div>';
    return h;
  }

  function hotelBookingCard(b) {
    return '<div class="acw-card"><div class="acw-bk-head"><div class="acw-check">&#10003;</div><div>' +
      '<div class="acw-bk-status">Hotel confirmed</div>' +
      '<div class="acw-bk-reflabel">Booking reference</div><div class="acw-bk-ref">' + esc(b.bookingReference) + '</div></div></div>' +
      '<div class="acw-pass"><div class="acw-pass-airline">' + esc(b.hotelName) + ' ' + stars(b.stars) + '</div>' +
      '<div class="acw-ht-area">' + esc(b.area) + '</div>' +
      '<div class="acw-grid"><div><small>Check-in</small><b>' + esc(b.checkIn) + '</b></div><div><small>Check-out</small><b>' + esc(b.checkOut) + '</b></div>' +
      '<div><small>Room</small><b>' + esc(b.rooms) + ' × ' + esc(b.roomType) + '</b></div><div><small>Total paid</small><b>' + money(b.totalPrice) + '</b></div></div>' +
      (b.perk ? '<div class="acw-ht-perk">&#127873; ' + esc(b.perk) + '</div>' : '') + '</div>' +
      '<div class="acw-tear"></div>' +
      '<div class="acw-pts"><b>+' + num(b.pointsEarned) + '</b><div><b>' + esc(b.loyaltyTier) + ' points earned</b><span>New balance: ' + num(b.newPointsBalance) + ' points</span></div></div></div>';
  }

  function extrasCard(d, interactive) {
    var opts = d.options || [];
    var h = '<div class="acw-card acw-fo acw-ex"><div class="acw-card-head acw-ex-head">' +
      '<div class="acw-fo-route">Make the most of ' + esc(d.city) + '</div>' +
      '<div class="acw-fo-meta">Aspire Lifestyles services for your stay at ' + esc(d.hotelName) + '</div>' +
      '<div class="acw-fo-sub">Your balance: ' + num(d.pointsBalance) + ' points</div></div>';
    opts.forEach(function (o) {
      h += '<div class="acw-opt acw-ex-opt"><div class="acw-opt-top"><div class="acw-rank">' + esc(o.rank) + '</div>' +
        '<div class="acw-airline"><b>' + esc(o.name) + '</b><span>' + esc(o.category) + (o.serviceDate ? ' · ' + esc(o.serviceDate) : '') +
        (o.familyFriendly ? ' · Family friendly' : '') + '</span></div>' +
        '<div class="acw-price"><b>' + money(o.price) + '</b><span>or ' + num(o.pointsPrice) + ' pts</span></div></div>' +
        '<div class="acw-reason">' + esc(o.description) + '</div>' +
        (interactive ? '<button type="button" class="acw-ex-pick" data-rank="' + esc(o.rank) + '">Add</button>' : '') + '</div>';
    });
    if (interactive) {
      h += '<div class="acw-ex-actions"><button type="button" class="acw-ex-book" disabled>Book selected</button>' +
        '<button type="button" class="acw-ex-book acw-ex-alt" data-points="1" disabled>Use my points</button>' +
        '<button type="button" class="acw-ex-skip">No thanks</button></div>';
    }
    h += '<div class="acw-fo-foot">' + (interactive ? 'Add what you like, or just tell me' : 'Services presented') + '</div></div>';
    return h;
  }

  function summaryCard(t) {
    function list(label, items) {
      return (items || []).length ? '<div class="acw-sum-sec"><small>' + label + '</small>' + items.map(function (x) { return '<div>' + esc(x) + '</div>'; }).join('') + '</div>' : '';
    }
    return '<div class="acw-card"><div class="acw-bk-head acw-sum-head"><div class="acw-check">&#9992;</div><div>' +
      '<div class="acw-bk-status">Your ' + esc(t.destination) + ' trip is set</div>' +
      '<div class="acw-fo-meta">' + esc(t.travelDates) + '</div></div></div>' +
      '<div class="acw-pass">' + list('Flights', t.flights) + list('Stay', t.hotels) + list('Experiences', t.extras) +
      '<div class="acw-grid"><div><small>Points earned</small><b>+' + num(t.pointsEarnedThisTrip) + '</b></div>' +
      '<div><small>Points used</small><b>' + num(t.pointsRedeemedThisTrip) + '</b></div></div></div>' +
      '<div class="acw-tear"></div>' +
      '<div class="acw-pts"><b>' + num(t.pointsBalance) + '</b><div><b>' + esc(t.loyaltyTier) + ' balance</b><span>' + esc(t.nextReward) + '</span></div></div></div>';
  }

  // ───────────── start ─────────────
  function init() {
    build();
    // Open both connections as soon as the page has loaded and keep them warm, so the first
    // message never waits on a slow new connection to Salesforce.
    if (document.readyState === 'complete') setHeartbeat(true);
    else window.addEventListener('load', function () { setHeartbeat(true); });
    try { sessionStorage.removeItem('aspireConciergeChat.v1'); sessionStorage.removeItem('aspireConciergeChat.v2'); } catch (e) { /* ignore */ }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
