/* ============================================================
   Naples Chess Club — RSVP backend

   This is a Google Apps Script web app. It is the entire backend:
   no server, no hosting bill, no account beyond the Google one you
   already have. RSVPs land as rows in a Google Sheet that you own.

   Setup instructions are in backend/SETUP.md.
   ============================================================ */

/* ---------- settings ---------- */

// Who gets a heads-up email when somebody RSVPs.
//
// Deliberately blank in the public repo so the address is not scraped.
// Put your real address here in the Apps Script editor, which is private.
// Leave it blank to turn notifications off entirely.
var NOTIFY_EMAIL = '';

// Email the guest a confirmation.
var SEND_CONFIRMATION = true;

// Shown in confirmation emails.
var CLUB_NAME    = 'Naples Chess Club';
var CLUB_PHONE   = '(239) 285-8258';
var CLUB_VENUE   = 'Narrative Coffee Roasters, Mercato';
var CLUB_ADDRESS = '9110 Strada Pl, Naples, FL 34108';
var CLUB_TIME    = '6:30 PM to 8:00 PM';
var SITE_URL     = 'https://napleschessclub.com/';
var INSTAGRAM    = 'https://www.instagram.com/napleschessclub/';

/* Abuse limits.

   This URL is public by necessity: the browser has to call it, so it is
   visible in the page source. The origin check below is a speed bump, not
   a wall, because the origin is sent by the client and can be forged.

   These caps are the real protection. They mean the worst case is a
   wasted afternoon for whoever tries, rather than your Gmail account
   being used as a spam relay and flagged. */
var MAX_RSVPS_PER_DAY      = 150;  // total new rows per day, everyone combined
var MAX_PER_EMAIL_PER_DAY  = 5;    // stops one address being hammered
var RESERVE_EMAIL_QUOTA    = 15;   // stop sending confirmations below this many sends left

// Speed bump only. See note above.
var ALLOWED_ORIGINS = [
  'https://napleschessclub.com',
  'https://www.napleschessclub.com',
  // Local testing. Delete these two if you would rather not allow it.
  'http://localhost:4173',
  'http://127.0.0.1:4173'
];

var SHEET_NAME = 'RSVPs';
var HEADERS = ['Submitted', 'Event date', 'Name', 'Email', 'Guests', 'Source', 'Subscribed'];


/* ---------- entry points ---------- */

function doPost(e) {
  var lock = LockService.getScriptLock();

  try {
    // Two people submitting at the same moment would otherwise both append,
    // producing a duplicate the dedupe check could not see.
    try {
      lock.waitLock(15000);
    } catch (lockErr) {
      return json({ ok: false, error: 'Busy for a moment. Please try again.' });
    }

    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: 'Empty request.' });
    }

    var data = JSON.parse(e.postData.contents);

    if (ALLOWED_ORIGINS.length && data.origin && ALLOWED_ORIGINS.indexOf(data.origin) === -1) {
      return json({ ok: false, error: 'Not allowed.' });
    }

    // Honeypot: real people leave this empty, bots fill it in.
    // Answer as though it worked so the bot has nothing to learn.
    if (String(data.website || '').trim() !== '') {
      return json({ ok: true, count: countFor(data.eventDate) });
    }

    var name      = clean(data.name, 100);
    var email     = clean(data.email, 160).toLowerCase();
    var guests    = clampInt(data.guests, 1, 20, 1);
    var eventDate = clean(data.eventDate, 20);

    if (!name)                 return json({ ok: false, error: 'Please tell us your name.' });
    if (!isEmail(email))       return json({ ok: false, error: 'That email address does not look right.' });
    if (!isIsoDate(eventDate)) return json({ ok: false, error: 'Missing or invalid event date.' });

    var sheet = getSheet();
    var stats = todayStats(sheet, email);

    if (stats.total >= MAX_RSVPS_PER_DAY) {
      return json({ ok: false, error: 'We have had a lot of sign-ups today. Please text us on ' + CLUB_PHONE + ' and we will add you.' });
    }
    if (stats.forEmail >= MAX_PER_EMAIL_PER_DAY) {
      return json({ ok: false, error: 'That email has already been used several times today.' });
    }

    var updated = upsert(sheet, eventDate, name, email, guests, clean(data.source, 40) || 'website');

    // Never fail an RSVP because an email could not be sent.
    if (SEND_CONFIRMATION && MailApp.getRemainingDailyQuota() > RESERVE_EMAIL_QUOTA) {
      try { sendConfirmation(name, email, eventDate, guests); } catch (mailErr) {}
    }
    if (NOTIFY_EMAIL && MailApp.getRemainingDailyQuota() > 0) {
      try { notifyClub(name, email, eventDate, guests, updated); } catch (mailErr) {}
    }

    return json({ ok: true, updated: updated, count: countFor(eventDate) });

  } catch (err) {
    return json({ ok: false, error: 'Something went wrong on our end.' });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function doGet(e) {
  try {
    var date = (e && e.parameter && e.parameter.date) ? clean(e.parameter.date, 20) : '';
    return json({ ok: true, count: isIsoDate(date) ? countFor(date) : 0 });
  } catch (err) {
    return json({ ok: true, count: 0 });
  }
}


/* ---------- sheet ---------- */

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/* How much has happened today, in total and for one address. */
function todayStats(sheet, email) {
  var last = sheet.getLastRow();
  var out = { total: 0, forEmail: 0 };
  if (last < 2) return out;

  var midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  var rows = sheet.getRange(2, 1, last - 1, 4).getValues(); // submitted, date, name, email
  for (var i = 0; i < rows.length; i++) {
    var when = rows[i][0];
    if (!(when instanceof Date) || when < midnight) continue;
    out.total++;
    if (String(rows[i][3]).trim().toLowerCase() === email) out.forEmail++;
  }
  return out;
}

/* One person per email per date. A second RSVP updates the first
   instead of creating a duplicate, so headcounts stay honest. */
function upsert(sheet, eventDate, name, email, guests, source) {
  var last = sheet.getLastRow();
  if (last > 1) {
    var rows = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][1]).trim() === eventDate &&
          String(rows[i][3]).trim().toLowerCase() === email) {
        var r = i + 2;
        sheet.getRange(r, 1).setValue(new Date());
        sheet.getRange(r, 3).setValue(name);
        sheet.getRange(r, 5).setValue(guests);
        return true;
      }
    }
  }
  sheet.appendRow([new Date(), eventDate, name, email, guests, source, 'yes']);
  return false;
}

function countFor(eventDate) {
  if (!isIsoDate(eventDate)) return 0;
  var sheet = getSheet();
  var last = sheet.getLastRow();
  if (last < 2) return 0;

  var rows = sheet.getRange(2, 2, last - 1, 4).getValues(); // date, name, email, guests
  var total = 0;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === eventDate) total += clampInt(rows[i][3], 1, 20, 1);
  }
  return total;
}


/* ---------- email ---------- */

function sendConfirmation(name, email, eventDate, guests) {
  var pretty = prettyDate(eventDate);
  var who = guests > 1 ? (guests + ' of you') : 'you';

  var body =
    'Hi ' + name + ',\n\n' +
    'You are down for chess night on ' + pretty + '. We have ' + who + ' on the list.\n\n' +
    'WHEN   ' + pretty + ', ' + CLUB_TIME + '\n' +
    'WHERE  ' + CLUB_VENUE + '\n' +
    '       ' + CLUB_ADDRESS + '\n\n' +
    'You do not need to bring anything. We have boards and sets, and it is free.\n\n' +
    'One thing worth knowing: some weeks we play somewhere else in Naples. We always\n' +
    'post the location on Instagram first, so it is worth a quick look before you set off:\n' +
    INSTAGRAM + '\n\n' +
    'If anything changes or you have a question, just reply to this email or text ' + CLUB_PHONE + '.\n\n' +
    'See you Wednesday,\n' +
    CLUB_NAME + '\n' +
    SITE_URL + '\n\n' +
    '---\n' +
    'You are getting this because you RSVP\'d on our website. We send occasional club\n' +
    'updates. Reply with "unsubscribe" any time and we will take you off the list.';

  MailApp.sendEmail({
    to: email,
    subject: 'You are on the list for chess night, ' + pretty,
    body: body,
    name: CLUB_NAME
  });
}

function notifyClub(name, email, eventDate, guests, wasUpdate) {
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: (wasUpdate ? 'Updated RSVP' : 'New RSVP') + ': ' + name + ' for ' + prettyDate(eventDate),
    body:
      name + ' (' + email + ') is coming on ' + prettyDate(eventDate) + '.\n' +
      'Party size: ' + guests + '\n\n' +
      'Running total for that date: ' + countFor(eventDate) + '\n\n' +
      'Full list: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl(),
    name: CLUB_NAME
  });
}


/* ---------- helpers ---------- */

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

function clampInt(v, min, max, fallback) {
  var n = parseInt(v, 10);
  if (isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

function isIsoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s || '');
}

/* '2026-10-14' -> 'Wednesday, October 14' */
function prettyDate(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || 'the next chess night';
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate();
}


/* ---------- run this once from the editor to check everything works ---------- */

function testSetup() {
  var sheet = getSheet();
  Logger.log('Sheet ready: ' + sheet.getName());
  Logger.log('Headers: ' + sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0].join(' | '));
  Logger.log('Count for 2026-10-14: ' + countFor('2026-10-14'));
  Logger.log('Pretty date: ' + prettyDate('2026-10-14'));
  Logger.log('Notifications: ' + (NOTIFY_EMAIL ? 'to ' + NOTIFY_EMAIL : 'OFF (NOTIFY_EMAIL is blank)'));
  Logger.log('Remaining email quota today: ' + MailApp.getRemainingDailyQuota());
}
