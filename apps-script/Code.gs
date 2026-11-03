/**
 * Ca Nào Z? - private Google Sheets search endpoint.
 * Bound to your Google Form response spreadsheet.
 * The browser NEVER calls this script directly: Vercel /api/search makes POST requests.
 * Required Script Property: API_TOKEN (same value as Vercel SHEETS_API_TOKEN).
 */

// IMPORTANT: change this to the actual response tab name in your Google Sheet.
var SHEET_NAME = 'Form Responses 1';
var MAX_RESULTS = 40;
var MSSV_RE = /^[A-Z]{2}[0-9]{6}$/;

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function norm_(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function column_(headers, names) {
  var normalized = headers.map(norm_);
  for (var i = 0; i < names.length; i++) {
    var ix = normalized.indexOf(norm_(names[i]));
    if (ix >= 0) return ix;
  }
  throw new Error('Missing column: ' + names[0]);
}

function isApproved_(value) {
  return ['true', 'yes', '1', 'ok', 'x', 'da duyet'].indexOf(norm_(value)) >= 0;
}

function hasConsent_(value) {
  // One checkbox option in the Form: "Tôi đồng ý".
  return ['toi dong y', 'dong y'].indexOf(norm_(value)) >= 0;
}

function parseShift_(value) {
  var match = String(value || '').match(/\b([123])\b/);
  return match ? Number(match[1]) : null;
}

function doPost(e) {
  try {
    var body = JSON.parse(e && e.postData && e.postData.contents || '{}');
    var expectedToken = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (!expectedToken || !body || body.token !== expectedToken) {
      return json_({ ok: false, error: 'unauthorized' });
    }

    var q = String(body.q || '').trim().slice(0, 100);
    var shift = String(body.shift || '');
    if (shift && !/^[123]$/.test(shift)) return json_({ ok: false, error: 'invalid_shift' });
    if (q && /^[A-Za-z]+\d/.test(q) && !MSSV_RE.test(q.toUpperCase())) {
      return json_({ ok: false, error: 'invalid_id' });
    }
    if (!q && !shift) return json_({ ok: true, results: [] });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('Wrong SHEET_NAME');
    var rows = sheet.getDataRange().getDisplayValues();
    if (rows.length < 2) return json_({ ok: true, results: [] });

    var h = rows[0];
    var ixName = column_(h, ['Họ và tên']);
    var ixId = column_(h, ['MSSV']);
    var ixShift = column_(h, ['Ca tốt nghiệp']);
    var ixGroup = column_(h, ['Lớp / nhóm', 'Lớp/nhóm']);
    var ixConsent = column_(h, ['Đồng ý công khai']);
    var ixApproved = column_(h, ['Duyệt']);

    // Only manually approved, consenting rows. Latest approved row wins for duplicate IDs.
    var approved = {};
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var id = String(r[ixId] || '').trim().toUpperCase();
      var name = String(r[ixName] || '').trim();
      var gradShift = parseShift_(r[ixShift]);
      if (!MSSV_RE.test(id) || !name || !gradShift || !isApproved_(r[ixApproved]) || !hasConsent_(r[ixConsent])) continue;
      approved[id] = { id: id, name: name, shift: gradShift, group: String(r[ixGroup] || '').trim() };
    }

    var idQuery = MSSV_RE.test(q.toUpperCase());
    var wantedName = norm_(q);
    var result = [];
    var ids = Object.keys(approved);
    for (var j = 0; j < ids.length; j++) {
      var person = approved[ids[j]];
      if (shift && person.shift !== Number(shift)) continue;
      if (q && !(idQuery ? person.id === q.toUpperCase() : norm_(person.name).indexOf(wantedName) >= 0)) continue;
      result.push({
        name: person.name,
        studentIdMasked: person.id.slice(0, 2) + '****' + person.id.slice(-2),
        shift: person.shift,
        group: person.group,
      });
      if (result.length >= MAX_RESULTS) break;
    }
    return json_({ ok: true, results: result });
  } catch (error) {
    console.error('Ca Nao Z API error', error);
    return json_({ ok: false, error: 'server_error' });
  }
}

function doGet() {
  return json_({ ok: false, error: 'Use the website search endpoint.' });
}
