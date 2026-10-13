/* Naples Chess Club — small progressive enhancements.
   Everything except the RSVP form works with JavaScript disabled. */
(function () {
  'use strict';

  /* ============================================================
     RSVP ENDPOINT

     Paste the Apps Script web app URL here after deploying it.
     Instructions: backend/SETUP.md

     While this is empty the RSVP form hides itself and the page
     falls back to "text us instead", so nothing looks broken.
     ============================================================ */
  var RSVP_ENDPOINT = 'https://script.google.com/macros/s/AKfycbw2bBN2ajDRKl4QjIcoA0lCtL_R4rUckiq23v-lm5vKbFxGoyKLXExwDCqBtfrppvEbcw/exec';


  /* ---- Footer year ---- */
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());


  /* ---- When is the next chess night? ----
     Wednesdays, 18:30 to 20:00, America/New_York. We work in Eastern
     time whatever the visitor's own timezone is, so a snowbird browsing
     from Ohio still sees the right date. */
  function nextChessNight() {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short', year: 'numeric', month: 'numeric',
      day: 'numeric', hour: 'numeric', hour12: false
    }).formatToParts(new Date()).reduce(function (acc, p) {
      acc[p.type] = p.value; return acc;
    }, {});

    var WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    var dow = WEEKDAYS[parts.weekday];
    var hour = parseInt(parts.hour, 10) % 24;

    // UTC purely for safe day arithmetic, then formatted back as UTC.
    var d = new Date(Date.UTC(
      parseInt(parts.year, 10),
      parseInt(parts.month, 10) - 1,
      parseInt(parts.day, 10)
    ));

    var ahead = (3 - dow + 7) % 7;                 // 3 = Wednesday
    var tonight = ahead === 0 && hour < 20;        // before 8pm on a Wednesday
    if (ahead === 0 && !tonight) ahead = 7;
    d.setUTCDate(d.getUTCDate() + ahead);

    var pad = function (n) { return (n < 10 ? '0' : '') + n; };

    return {
      iso: d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()),
      label: new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric'
      }).format(d),
      tonight: tonight
    };
  }

  var night = null;
  try { night = nextChessNight(); } catch (e) { /* Intl unavailable */ }


  /* ---- "Next chess night" banner ---- */
  var dateEl = document.getElementById('next-up-date');
  var wrapEl = document.getElementById('next-up');

  if (dateEl && wrapEl && night) {
    dateEl.textContent = night.tonight
      ? 'Tonight, ' + night.label + ', 6:30 PM'
      : night.label + ', 6:30 PM';
    wrapEl.hidden = false;
  }


  /* ---- RSVP ---- */
  var form = document.getElementById('rsvp-form');

  if (form) {
    var statusEl  = document.getElementById('rsvp-status');
    var countEl   = document.getElementById('rsvp-count');
    var submitBtn = document.getElementById('rsvp-submit');
    var dateInput = document.getElementById('rsvp-event-date');
    var dateText  = document.getElementById('rsvp-date-text');
    var rsvpCard  = form.closest('.rsvp-card');

    if (night) {
      dateInput.value = night.iso;
      dateText.textContent = night.tonight
        ? 'tonight, ' + night.label
        : night.label;
    }

    function say(msg, kind) {
      statusEl.textContent = msg;
      statusEl.className = 'rsvp-status is-' + kind;
      statusEl.hidden = false;
    }

    function showCount(n) {
      if (!countEl || !n || n < 2) return;
      countEl.textContent = n + ' people are coming this week.';
      countEl.hidden = false;
    }

    if (!RSVP_ENDPOINT) {
      // Not configured yet: hide the form rather than show a dead one.
      if (rsvpCard) rsvpCard.hidden = true;
    } else {
      // Current headcount, best effort. Never block the form on it.
      if (night) {
        fetch(RSVP_ENDPOINT + '?date=' + encodeURIComponent(night.iso))
          .then(function (r) { return r.json(); })
          .then(function (d) { if (d && d.ok) showCount(d.count); })
          .catch(function () {});
      }

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();

        // form.elements.* rather than form.* — `form.name` collides with
        // HTMLFormElement.name and would break if the form ever gained one.
        var fields = form.elements;
        var name  = fields.name.value.trim();
        var email = fields.email.value.trim();

        if (!name) { say('Please tell us your name.', 'error'); fields.name.focus(); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
          say('That email address does not look right.', 'error'); fields.email.focus(); return;
        }

        submitBtn.disabled = true;
        submitBtn.querySelector('span').textContent = 'Sending...';
        say('Sending your RSVP...', 'pending');

        // No Content-Type header on purpose: keeps this a "simple" request
        // so the browser skips the CORS preflight, which Apps Script cannot answer.
        fetch(RSVP_ENDPOINT, {
          method: 'POST',
          body: JSON.stringify({
            name: name,
            email: email,
            guests: fields.guests.value,
            eventDate: dateInput.value,
            website: fields.website.value,
            origin: window.location.origin,
            source: 'website'
          })
        })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d || !d.ok) {
              // Tagged so the catch below knows this message is safe to show.
              var e = new Error((d && d.error) || '');
              e.fromServer = true;
              throw e;
            }
            form.hidden = true;
            say(
              d.updated
                ? 'Updated, thanks. We have you down for ' + (night ? night.label : 'this week') + '.'
                : 'You are on the list. Check your email for confirmation, and see you Wednesday.',
              'success'
            );
            showCount(d.count);
          })
          .catch(function (err) {
            submitBtn.disabled = false;
            submitBtn.querySelector('span').textContent = 'Reserve my spot';
            // Never surface a raw JS exception to a visitor. Only our own
            // server-sent messages are shown; everything else gets the fallback.
            var safe = (err && err.fromServer && err.message) ? err.message : '';
            say(
              safe || 'We could not save that just now. Please text us on (239) 285-8258 and we will add you.',
              'error'
            );
          });
      });
    }
  }


  /* ---- Swap the map placeholder for the real embed on demand ---- */
  var mapBtn = document.getElementById('map-load');
  if (mapBtn) {
    mapBtn.addEventListener('click', function () {
      var frame = document.createElement('iframe');
      frame.src = mapBtn.getAttribute('data-map');
      frame.title = 'Map showing Narrative Coffee Roasters, Mercato, 9110 Strada Place, Naples, Florida';
      frame.width = '600';
      frame.height = '450';
      frame.loading = 'lazy';
      frame.referrerPolicy = 'no-referrer-when-downgrade';
      frame.setAttribute('allowfullscreen', '');
      mapBtn.replaceWith(frame);
    });
  }


  /* ---- Reveal the mobile dock once the hero's own buttons scroll away ---- */
  var dock = document.querySelector('.dock');
  var hero = document.querySelector('.hero');

  if (dock && hero && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      dock.classList.toggle('is-visible', !entries[0].isIntersecting);
    }, { rootMargin: '-85% 0px 0px 0px' }).observe(hero);
  } else if (dock) {
    dock.classList.add('is-visible');
  }


  /* ---- Accordion: only one FAQ open at a time ---- */
  var faqItems = document.querySelectorAll('.faq details');
  Array.prototype.forEach.call(faqItems, function (item) {
    item.addEventListener('toggle', function () {
      if (!item.open) return;
      Array.prototype.forEach.call(faqItems, function (other) {
        if (other !== item) other.open = false;
      });
    });
  });


  /* ---- Offset in-page anchors so the sticky header doesn't cover them ---- */
  var header = document.querySelector('.site-header');
  document.addEventListener('click', function (ev) {
    var link = ev.target.closest && ev.target.closest('a[href^="#"]');
    if (!link) return;

    var id = link.getAttribute('href');
    if (!id || id === '#') return;

    var target = document.querySelector(id);
    if (!target) return;

    ev.preventDefault();

    var offset = header ? header.offsetHeight + 24 : 0;
    var top = target.getBoundingClientRect().top + window.pageYOffset - offset;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    window.scrollTo({ top: top, behavior: reduce ? 'auto' : 'smooth' });
    history.replaceState(null, '', id);
  });
})();
