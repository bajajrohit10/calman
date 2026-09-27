# Support intake — the Apps Script to paste into the sheet

This script sends every new Google Form response to Calman. Paste it into the
**form-response spreadsheet**, install one trigger, and new tickets appear on
`/support` within a second or two of a student pressing Submit.

## Read this first: which spreadsheet

The workbook the team works in (`Ticket Sheet - July 2025 onwards`) does **not**
hold the form responses. Its `July 2025` tab is an `IMPORTRANGE` of a different
spreadsheet, and its `Tickets` tab mirrors that by formula. An `onFormSubmit`
trigger fires on the sheet the form actually writes to, so:

- Install this script on the **form-response spreadsheet** —
  `https://docs.google.com/spreadsheets/d/1eQOhl885pRAtNJALJ3TgnQI8KuUdAN8k3AULjFdkaqk/edit`
  (the id taken from the `IMPORTRANGE` formula in `July 2025!A1`).
- Installing it on the team's workbook will do nothing, silently. There is no
  form attached to that one, so the trigger can never fire.

Confirm before installing: open the response spreadsheet and check that a test
submission adds a row. If it does not, the form is writing somewhere else and
the id above is stale.

## Before you start

Two things must exist:

1. **`SUPPORT_INTAKE_SECRET` set in Vercel**, for every environment
   (Production, Preview, Development). Any long random string; generate one with
   `openssl rand -hex 32`. Until it is set the endpoint answers **503** and no
   ticket is created — deliberately, so a missing secret looks like a missing
   secret rather than a rejected request.
2. The same value in the script's properties (step 3 below). It is never pasted
   into the code, so the script can be shared or copied without leaking it.

## 1. Open the script editor

In the response spreadsheet: **Extensions → Apps Script**. Delete whatever is in
`Code.gs` and paste everything below.

## 2. The script

```javascript
/**
 * Calman support intake.
 *
 * Sends one form response per submission to Calman's /api/support/intake.
 * Calman is idempotent on rowRef, so a retry — or a backfill over rows that
 * already went — never creates a second ticket.
 */

var CALMAN_URL = 'https://calman.zeroinfy.in/api/support/intake';
var LOG_SHEET = 'Calman sync';

/** Header names as they appear in row 1 of the response sheet. */
var HEADERS = {
  timestamp: 'Timestamp',
  name: 'Name',
  mobile: 'Mobile No.',
  orderId: 'Order ID',
  issues: 'Issue',
  description: 'Description',
  faculty: 'Faculty/Institute Name',
  attachments: 'Attachment'
};

function getSecret_() {
  var secret = PropertiesService.getScriptProperties().getProperty('CALMAN_INTAKE_SECRET');
  if (!secret) {
    throw new Error('CALMAN_INTAKE_SECRET is not set in Script properties.');
  }
  return secret;
}

/**
 * Column index per logical field, by header text rather than position.
 *
 * Reading by header is the whole point: somebody will add a question to the
 * form one day, every column after it will shift, and a script reading
 * row[3] would start posting the description as the order id without erroring.
 */
function columnMap_(sheet) {
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var normalise = function (s) { return String(s || '').trim().toLowerCase(); };
  var map = {};
  Object.keys(HEADERS).forEach(function (key) {
    var want = normalise(HEADERS[key]);
    for (var i = 0; i < header.length; i++) {
      if (normalise(header[i]) === want) { map[key] = i; return; }
    }
    map[key] = -1;
  });
  return map;
}

function cell_(row, index) {
  if (index == null || index < 0) return '';
  var value = row[index];
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
  return String(value).trim();
}

/**
 * The row's identity, for idempotency.
 *
 * Sheet id plus row number: stable for a given row forever, and distinct across
 * sheets so a copied spreadsheet cannot collide with the original.
 */
function rowRef_(sheet, rowNumber) {
  return sheet.getParent().getId() + ':' + sheet.getName() + ':' + rowNumber;
}

function buildPayload_(sheet, map, rowNumber, row) {
  return {
    timestamp: cell_(row, map.timestamp),
    name: cell_(row, map.name),
    mobile: cell_(row, map.mobile),
    orderId: cell_(row, map.orderId),
    issues: cell_(row, map.issues),
    description: cell_(row, map.description),
    faculty: cell_(row, map.faculty),
    attachments: cell_(row, map.attachments),
    rowRef: rowRef_(sheet, rowNumber)
  };
}

/**
 * POST once, retrying twice on a non-2xx.
 *
 * Three attempts in total, backing off 2s then 6s. A 4xx other than 429 is not
 * retried: a malformed row fails identically however many times it is sent, and
 * hammering the endpoint would only delay the log entry that says so.
 */
function post_(payload) {
  var delays = [2000, 6000];
  var lastStatus = 0;
  var lastBody = '';

  for (var attempt = 0; attempt <= delays.length; attempt++) {
    var response = UrlFetchApp.fetch(CALMAN_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Intake-Secret': getSecret_() },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    lastStatus = response.getResponseCode();
    lastBody = response.getContentText();

    if (lastStatus >= 200 && lastStatus < 300) {
      return { ok: true, status: lastStatus, body: lastBody };
    }
    if (lastStatus >= 400 && lastStatus < 500 && lastStatus !== 429) {
      return { ok: false, status: lastStatus, body: lastBody };
    }
    if (attempt < delays.length) Utilities.sleep(delays[attempt]);
  }

  return { ok: false, status: lastStatus, body: lastBody };
}

/** Append one line to the "Calman sync" tab, creating it if needed. */
function log_(rowNumber, rowRef, result) {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(LOG_SHEET);
  if (!sheet) {
    sheet = book.insertSheet(LOG_SHEET);
    sheet.appendRow(['When', 'Sheet row', 'Row ref', 'Status', 'Result', 'Response']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([
    new Date(),
    rowNumber,
    rowRef,
    result.status,
    result.ok ? 'sent' : 'FAILED',
    String(result.body || '').slice(0, 500)
  ]);
}

/**
 * The trigger. Installed against the spreadsheet, not the form, so the row is
 * already written and can be read by header.
 */
function onFormSubmitToCalman(e) {
  var sheet = e && e.range ? e.range.getSheet() : SpreadsheetApp.getActiveSheet();
  var rowNumber = e && e.range ? e.range.getRow() : sheet.getLastRow();
  var map = columnMap_(sheet);
  var row = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  var payload = buildPayload_(sheet, map, rowNumber, row);

  var result;
  try {
    result = post_(payload);
  } catch (err) {
    result = { ok: false, status: 0, body: String(err) };
  }
  log_(rowNumber, payload.rowRef, result);
}

/**
 * One-off: send the last N rows.
 *
 * For rows submitted before the trigger existed. Safe to run more than once and
 * safe to overlap with the live trigger — Calman keys on rowRef and answers 200
 * with the existing ticket id for a row it has already seen, writing nothing.
 *
 * Run it from the editor: pick backfillLastRows in the function dropdown. Adjust
 * HOW_MANY first. Apps Script caps a single execution at six minutes, so keep it
 * to a few hundred rows per run and repeat if there are more.
 */
function backfillLastRows() {
  var HOW_MANY = 50;

  var sheet = SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var map = columnMap_(sheet);
  var firstRow = Math.max(2, lastRow - HOW_MANY + 1);
  var values = sheet.getRange(firstRow, 1, lastRow - firstRow + 1, sheet.getLastColumn()).getValues();

  for (var i = 0; i < values.length; i++) {
    var rowNumber = firstRow + i;
    var payload = buildPayload_(sheet, map, rowNumber, values[i]);

    // A blank row in the middle of a sheet is not a submission.
    if (!payload.mobile && !payload.orderId && !payload.name && !payload.description) continue;

    var result;
    try {
      result = post_(payload);
    } catch (err) {
      result = { ok: false, status: 0, body: String(err) };
    }
    log_(rowNumber, payload.rowRef, result);
    Utilities.sleep(250);
  }
}
```

## 3. Store the secret

In the script editor: **Project Settings** (the gear) → **Script properties** →
**Add script property**.

- Property: `CALMAN_INTAKE_SECRET`
- Value: the same string as `SUPPORT_INTAKE_SECRET` in Vercel

Save. The secret lives only here, never in the code.

## 4. Install the trigger

In the script editor: **Triggers** (the clock) → **Add Trigger**.

| Field | Value |
| --- | --- |
| Choose which function to run | `onFormSubmitToCalman` |
| Which runs at deployment | `Head` |
| Select event source | `From spreadsheet` |
| Select event type | `On form submit` |
| Failure notification settings | `Notify me daily` |

Save, and authorise when Google asks — the script needs permission to read the
sheet and to call an external URL. The consent screen will warn that the script
is unverified; that is expected for a script you own and paste yourself.

**Use `On form submit`, not `On change`.** `On change` fires for edits, formula
recalculations and `IMPORTRANGE` refreshes, which on this spreadsheet would post
the same rows repeatedly. They would all be deduplicated by `rowRef`, so nothing
would break — but the log would fill with noise and hide a real failure.

## 5. Check it works

1. Submit the form once with a junk order id you can recognise.
2. The response sheet gains a row; the `Calman sync` tab gains a line reading
   `201 / sent`.
3. `/support` shows the ticket at the top of **New**.

If `Calman sync` says:

| Status | Meaning | Fix |
| --- | --- | --- |
| `401` | The secret does not match | Compare the script property against the Vercel value, character for character |
| `503` | `SUPPORT_INTAKE_SECRET` is not set on the deployment | Set it in Vercel and redeploy |
| `400` | The row carried nothing usable | Look at the row; it is probably blank |
| `0` | The script threw before sending | The message is in the Response column; usually the missing script property |
| `200` with `"existing": true` | Calman already had this row | Nothing to fix — this is the idempotency working |

## What Calman does with the row

Calman normalises rather than trusting the cell, because 15 months of this feed
showed how much variety one text box collects:

- **Mobile** — the first valid 10-digit number in the cell, after dropping a
  `91`/`0` prefix. Interior spaces are fine. Unusable values are kept verbatim
  in `mobile_raw` and the ticket shows them struck through.
- **Order id** — trimmed, upper-cased, an `ORDER`/`Order Id:`/`#` label removed,
  `Z1`/`Zl` repaired to `ZI`. `BBVPL-…` and `BBP-…` pass through untouched. Two
  orders in one cell keeps the first and the whole string stays in
  `order_id_raw`. A value with no run of four digits, or containing an `@`, is
  treated as no order id at all.
- **Issue** — the five known options are recognised wherever they appear, in any
  order; everything left over becomes the "Other" text, kept whole.
- **Faculty/Institute** — matched against a seeded alias table first (the form's
  dropdown options are slash-joined faculty rosters that equal no institute's
  name), then against teacher and institute names. No match leaves it blank for
  the team.
- **Duplicates** — if the mobile and the order id both match an open ticket, the
  new row is filed as a duplicate of it and never appears in the queue on its
  own.
