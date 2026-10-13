var WORKOUT_VERSION = 1;
var WORKOUT_MAX_BYTES = 256 * 1024;
var WORKOUT_MAX_CHANGES = 100;
var WORKOUT_HEADERS = {
  People: ["Phone label", "Age", "Gender", "Height cm", "Preferred unit"],
  Exercises: [
    "Exercise ID",
    "Exercise index",
    "Name",
    "Muscle group",
    "Equipment",
    "Increment lb",
    "Increment kg",
  ],
  Plans: [
    "Row type",
    "Template ID",
    "Template index",
    "Title",
    "Archived",
    "Updated at",
    "Exercise index",
    "Exercise ID",
    "Sets",
    "Rep min",
    "Rep max",
    "Weekday index",
    "Weekday",
  ],
  Schedules: [
    "Row type",
    "Revision ID",
    "Revision index",
    "Effective date",
    "Anchor Monday",
    "Slot index",
    "Weekday",
    "Workout index",
    "Workout ID",
    "Template index",
    "Template ID",
    "Title",
    "Archived",
    "Updated at",
    "Exercise index",
    "Exercise ID",
    "Sets",
    "Rep min",
    "Rep max",
    "Template weekday index",
    "Template weekday",
  ],
  Workouts: [
    "Session ID",
    "Date",
    "Title",
    "Template ID",
    "Unit",
    "Status",
    "Started at",
    "Updated at",
    "Finished at",
    "Exercise count",
  ],
  Sets: [
    "Row type",
    "Session ID",
    "Exercise index",
    "Exercise ID",
    "Exercise name",
    "Muscle group",
    "Equipment",
    "Increment lb",
    "Increment kg",
    "Target exercise ID",
    "Target sets",
    "Target rep min",
    "Target rep max",
    "Suggestion reason",
    "Recorded set count",
    "Suggestion count",
    "Set index",
    "Suggested weight",
    "Suggestion present",
    "Actual present",
    "Actual weight",
    "Actual reps",
    "Set status",
  ],
};
var WORKOUT_LEDGER_HEADERS = ['Row key', 'Device ID', 'Revision', 'Deleted', 'Table'];
var WORKOUT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var WORKOUT_HEX = /^[0-9a-f]{64}$/;

function workoutJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function workoutFailure_(error, retryable) {
  return workoutJson_({ version: WORKOUT_VERSION, ok: false, error: error, retryable: retryable });
}

function workoutInvalid_() {
  throw new Error('Invalid request');
}

function workoutObject_(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) workoutInvalid_();
  if (Object.keys(value).some(function (key) { return keys.indexOf(key) < 0; })) workoutInvalid_();
}

function workoutByteLength_(value) {
  return Utilities.newBlob(value).getBytes().length;
}

function workoutValidKey_(key, table, deviceId) {
  if (typeof key !== 'string' || key.length > 4096) return false;
  var parts = key.split(':');
  if (parts.length < 3 || parts.length > 10 || parts[0] !== table || parts[1] !== encodeURIComponent(deviceId)) return false;
  try {
    return parts.slice(2).every(function (part) {
      return part.length > 0 && part.length <= 2048 && encodeURIComponent(decodeURIComponent(part)) === part;
    });
  } catch (_) {
    return false;
  }
}

function workoutValidateRequest_(request) {
  workoutObject_(request, ['version', 'action', 'deviceId', 'token', 'changes']);
  if (request.version !== WORKOUT_VERSION || ['hello', 'upload'].indexOf(request.action) < 0 ||
      typeof request.deviceId !== 'string' || !WORKOUT_UUID.test(request.deviceId) ||
      typeof request.token !== 'string' || !WORKOUT_HEX.test(request.token)) workoutInvalid_();
  if (request.action === 'hello') {
    if (request.changes !== undefined && (!Array.isArray(request.changes) || request.changes.length)) workoutInvalid_();
    return;
  }
  if (!Array.isArray(request.changes) || request.changes.length > WORKOUT_MAX_CHANGES) workoutInvalid_();
  var keys = Object.create(null);
  request.changes.forEach(function (change) {
    workoutObject_(change, ['table', 'key', 'values', 'revision', 'deleted']);
    if (!Object.prototype.hasOwnProperty.call(WORKOUT_HEADERS, change.table) ||
        !workoutValidKey_(change.key, change.table, request.deviceId) ||
        !Number.isSafeInteger(change.revision) || change.revision < 1 ||
        typeof change.deleted !== 'boolean' || keys[change.key]) workoutInvalid_();
    keys[change.key] = true;
    if (!Array.isArray(change.values) || change.values.length !== WORKOUT_HEADERS[change.table].length) workoutInvalid_();
    if (workoutByteLength_(JSON.stringify(change)) >= 16 * 1024) workoutInvalid_();
    change.values.forEach(function (value) {
      if (value === null || typeof value === 'boolean') return;
      if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) return;
      if (typeof value === 'string' && value.length <= 4096) return;
      workoutInvalid_();
    });
  });
}

function workoutEqual_(left, right) {
  if (left.length !== right.length) return false;
  var difference = 0;
  for (var i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

function workoutAuthenticate_(request) {
  var properties = PropertiesService.getScriptProperties();
  var devices;
  try { devices = JSON.parse(properties.getProperty('WORKOUT_DEVICES') || 'null'); } catch (_) { return false; }
  if (!Array.isArray(devices) || devices.length < 1 || devices.length > 2) return false;
  var configuredIds = Object.create(null);
  var configured = devices.every(function (device) {
    if (!device || typeof device !== 'object' || Array.isArray(device) ||
        Object.keys(device).length !== 2 || typeof device.deviceId !== 'string' ||
        !WORKOUT_UUID.test(device.deviceId) || typeof device.tokenHash !== 'string' ||
        !WORKOUT_HEX.test(device.tokenHash) || configuredIds[device.deviceId]) return false;
    configuredIds[device.deviceId] = true;
    return true;
  });
  if (!configured) return false;
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, request.token, Utilities.Charset.UTF_8);
  var tokenHash = digest.map(function (value) { return ('0' + ((value + 256) % 256).toString(16)).slice(-2); }).join('');
  return devices.some(function (device) {
    return workoutEqual_(device.tokenHash, tokenHash) && device.deviceId === request.deviceId;
  });
}

function workoutReadTable_(workbook, name, headers) {
  var sheet = workbook.getSheetByName(name);
  if (!sheet || sheet.getMaxColumns() < headers.length) throw new Error('Workbook unavailable');
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) throw new Error('Workbook unavailable');
  var rows = sheet.getRange(1, 1, lastRow, headers.length).getValues();
  if (headers.some(function (header, index) { return rows[0][index] !== header; })) throw new Error('Workbook unavailable');
  var indexed = Object.create(null);
  var empty = [];
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (row.every(function (value) { return value === '' || value === null; })) { empty.push(i); continue; }
    if (typeof row[0] !== 'string' || !row[0] || indexed[row[0]] !== undefined) throw new Error('Workbook unavailable');
    indexed[row[0]] = i;
  }
  return { sheet: sheet, rows: rows, indexed: indexed, empty: empty, next: lastRow, required: lastRow };
}

function workoutAllocate_(table) {
  var index = table.empty.length ? table.empty.shift() : table.next++;
  table.required = Math.max(table.required, index + 1);
  return index;
}

function workoutCells_(values) {
  return values.map(function (value) {
    if (value === null || value === undefined) return {};
    if (typeof value === 'string') return { userEnteredValue: { stringValue: value } };
    if (typeof value === 'number') return { userEnteredValue: { numberValue: value } };
    if (typeof value === 'boolean') return { userEnteredValue: { boolValue: value } };
    throw new Error('Workbook unavailable');
  });
}

function workoutRowWrite_(table, index, values) {
  return { updateCells: {
    start: { sheetId: table.sheet.getSheetId(), rowIndex: index, columnIndex: 0 },
    rows: [{ values: workoutCells_(values) }], fields: 'userEnteredValue'
  } };
}

function workoutApply_(request) {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty('WORKOUT_SPREADSHEET_ID');
  if (!spreadsheetId || !/^[A-Za-z0-9_-]+$/.test(spreadsheetId)) throw new Error('Workbook unavailable');
  var workbook = SpreadsheetApp.openById(spreadsheetId);
  var ledger = workoutReadTable_(workbook, '_Sync', WORKOUT_LEDGER_HEADERS);
  var maximum = 0;
  ledger.rows.slice(1).forEach(function (row) {
    if (!row[0]) return;
    if (!WORKOUT_UUID.test(row[1]) || !Object.prototype.hasOwnProperty.call(WORKOUT_HEADERS, row[4]) ||
        !workoutValidKey_(row[0], row[4], row[1]) || !Number.isSafeInteger(row[2]) || row[2] < 1 || typeof row[3] !== 'boolean') throw new Error('Workbook unavailable');
    if (row[1] === request.deviceId) maximum = Math.max(maximum, row[2]);
  });
  if (request.action === 'hello') return { version: WORKOUT_VERSION, ok: true, deviceId: request.deviceId, maxRevision: maximum, acknowledged: [] };
  var tables = Object.create(null);
  var writes = [];
  var acknowledged = [];
  request.changes.forEach(function (change) {
    var previousIndex = ledger.indexed[change.key];
    var previous = previousIndex === undefined ? null : ledger.rows[previousIndex];
    acknowledged.push({ key: change.key, revision: change.revision });
    if (previous && previous[2] >= change.revision) return;
    if (!tables[change.table]) tables[change.table] = workoutReadTable_(workbook, change.table, ['Row key', 'Device ID'].concat(WORKOUT_HEADERS[change.table]));
    var table = tables[change.table];
    var rowIndex = table.indexed[change.key];
    if (rowIndex !== undefined && table.rows[rowIndex][1] !== request.deviceId) throw new Error('Workbook unavailable');
    if (change.deleted) {
      if (rowIndex !== undefined) {
        writes.push(workoutRowWrite_(table, rowIndex, new Array(WORKOUT_HEADERS[change.table].length + 2).fill(null)));
        delete table.indexed[change.key];
        table.empty.push(rowIndex);
      }
    } else {
      if (rowIndex === undefined) rowIndex = workoutAllocate_(table);
      table.indexed[change.key] = rowIndex;
      table.rows[rowIndex] = [change.key, request.deviceId].concat(change.values);
      writes.push(workoutRowWrite_(table, rowIndex, table.rows[rowIndex]));
    }
    var ledgerIndex = previousIndex === undefined ? workoutAllocate_(ledger) : previousIndex;
    var ledgerRow = [change.key, request.deviceId, change.revision, change.deleted, change.table];
    ledger.indexed[change.key] = ledgerIndex;
    ledger.rows[ledgerIndex] = ledgerRow;
    writes.push(workoutRowWrite_(ledger, ledgerIndex, ledgerRow));
    maximum = Math.max(maximum, change.revision);
  });
  if (writes.length) {
    var growth = [];
    Object.keys(tables).map(function (key) { return tables[key]; }).concat([ledger]).forEach(function (table) {
      var extra = table.required - table.sheet.getMaxRows();
      if (extra > 0) growth.push({ appendDimension: { sheetId: table.sheet.getSheetId(), dimension: 'ROWS', length: extra } });
    });
    // Persist rows and revision markers in the same atomic request
    Sheets.Spreadsheets.batchUpdate({ requests: growth.concat(writes) }, spreadsheetId);
  }
  return { version: WORKOUT_VERSION, ok: true, deviceId: request.deviceId, maxRevision: maximum, acknowledged: acknowledged };
}

function doPost(event) {
  var request;
  try {
    if (!event || !event.postData || typeof event.postData.contents !== 'string' ||
        event.postData.contents.length > WORKOUT_MAX_BYTES || workoutByteLength_(event.postData.contents) > WORKOUT_MAX_BYTES) workoutInvalid_();
    request = JSON.parse(event.postData.contents);
    workoutValidateRequest_(request);
  } catch (_) { return workoutFailure_('Invalid request', false); }
  var lock;
  var acquired = false;
  try {
    if (!workoutAuthenticate_(request)) return workoutFailure_('Unauthorized', false);
    lock = LockService.getScriptLock();
    acquired = lock.tryLock(10000);
    if (!acquired) return workoutFailure_('Sync busy', true);
    if (!workoutAuthenticate_(request)) return workoutFailure_('Unauthorized', false);
    return workoutJson_(workoutApply_(request));
  } catch (_) { return workoutFailure_('Sync unavailable', true); }
  finally { if (acquired) lock.releaseLock(); }
}

function doGet() {
  return workoutJson_({ version: WORKOUT_VERSION, service: 'Workout sync' });
}

function initializeWorkbook() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var properties = PropertiesService.getScriptProperties();
    var id = properties.getProperty('WORKOUT_SPREADSHEET_ID');
    var workbook = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('Workout');
    if (!id) properties.setProperty('WORKOUT_SPREADSHEET_ID', workbook.getId());
    var tables = Object.keys(WORKOUT_HEADERS).map(function (name) {
      return { name: name, headers: ['Row key', 'Device ID'].concat(WORKOUT_HEADERS[name]) };
    }).concat([{ name: '_Sync', headers: WORKOUT_LEDGER_HEADERS }]);
    var filterRequests = [];
    tables.forEach(function (table) {
      var sheet = workbook.getSheetByName(table.name) || workbook.insertSheet(table.name);
      if (sheet.getMaxColumns() < table.headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), table.headers.length - sheet.getMaxColumns());
      if (!sheet.getLastRow()) sheet.getRange(1, 1, 1, table.headers.length).setValues([table.headers]).setFontWeight('bold');
      else workoutReadTable_(workbook, table.name, table.headers);
      sheet.setFrozenRows(1);
      if (!sheet.getFilter()) filterRequests.push({ setBasicFilter: { filter: { range: {
        sheetId: sheet.getSheetId(), startRowIndex: 0, startColumnIndex: 0, endColumnIndex: table.headers.length
      } } } });
      var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
      var protection = protections.length ? protections[0] : sheet.protect();
      protection.setDescription('Workout managed data');
      protection.setWarningOnly(false);
      protection.removeEditors(protection.getEditors());
      if (protection.canDomainEdit()) protection.setDomainEdit(false);
      if (table.name === '_Sync') sheet.hideSheet();
    });
    SpreadsheetApp.flush();
    if (filterRequests.length) Sheets.Spreadsheets.batchUpdate({ requests: filterRequests }, workbook.getId());
    return workbook.getUrl();
  } finally { lock.releaseLock(); }
}
