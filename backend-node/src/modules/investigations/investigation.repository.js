const { query } = require('../../database/pool');

async function findAll({ status = null, limit = 50, offset = 0 } = {}) {
  let sql = 'SELECT * FROM investigations';
  const params = [];
  if (status) {
    params.push(status);
    sql += ' WHERE status = $1';
  }
  sql += ' ORDER BY updated_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
  params.push(limit, offset);
  const result = await query(sql, params);
  return result.rows;
}

async function findById(id) {
  const result = await query('SELECT * FROM investigations WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function create(data) {
  const sql = 'INSERT INTO investigations (id, title, description, status, priority, assigned_to, linked_plate, notes, ' +
    'search_center_lat, search_center_lon, search_radius_km, search_start_at, search_end_at) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *';
  const params = [
    data.id, data.title, data.description || '', data.status || 'OPEN',
    data.priority || 'MEDIUM', data.assignedTo || 'Lead Investigator',
    data.linkedPlate || null, JSON.stringify(data.notes || []),
    data.searchCenterLat ?? null, data.searchCenterLon ?? null, data.searchRadiusKm ?? null,
    data.searchStartAt || null, data.searchEndAt || null,
  ];
  const result = await query(sql, params);
  return result.rows[0];
}

async function update(id, updates) {
  const fields = [];
  const params = [id];
  const fieldsMap = [
    ['status', 'status'], ['priority', 'priority'], ['description', 'description'],
    ['linkedPlate', 'linked_plate'], ['notes', 'notes'],
    ['searchCenterLat', 'search_center_lat'], ['searchCenterLon', 'search_center_lon'],
    ['searchRadiusKm', 'search_radius_km'], ['searchStartAt', 'search_start_at'],
    ['searchEndAt', 'search_end_at'],
  ];
  for (const [inputKey, column] of fieldsMap) {
    if (!Object.prototype.hasOwnProperty.call(updates, inputKey)) continue;
    const value = inputKey === 'notes' ? JSON.stringify(updates[inputKey]) : updates[inputKey];
    params.push(value);
    fields.push(column + ' = $' + params.length);
  }
  fields.push('updated_at = NOW()');
  const result = await query(
    'UPDATE investigations SET ' + fields.join(', ') + ' WHERE id = $1 RETURNING *',
    params
  );
  return result.rows[0] || null;
}

module.exports = { findAll, findById, create, update };
