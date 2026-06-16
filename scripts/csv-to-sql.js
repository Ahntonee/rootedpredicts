'use strict';
const fs = require('fs');
const path = require('path');

function escapeSQL(val) {
  if (val === null || val === undefined || val === '') return 'NULL';
  const str = String(val);
  return "'" + str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\0/g, '\\0') + "'";
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(content) {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length >= headers.length) {
      const row = {};
      headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
      rows.push(row);
    }
  }
  return { headers, rows };
}

const downloadsPath = path.join('C:\\Users\\DELL\\Downloads');

const files = [
  { table: 'predictions',            file: 'results-2026-06-16-223004.csv' },
  { table: 'prediction_accuracy_log', file: 'results-2026-06-16-223031.csv' },
  { table: 'accuracy_stats',         file: 'results-2026-06-16-223052.csv' },
  { table: 'blog_posts',             file: 'results-2026-06-16-223119.csv' },
];

let sql = '-- TiDB -> MySQL migration\n-- Generated: ' + new Date().toISOString() + '\n\n';
sql += 'SET FOREIGN_KEY_CHECKS=0;\n\n';

for (const { table, file } of files) {
  const filepath = path.join(downloadsPath, file);
  if (!fs.existsSync(filepath)) {
    console.log(`SKIP: ${table} — file not found: ${filepath}`);
    continue;
  }

  const content = fs.readFileSync(filepath, 'utf8');
  const { headers, rows } = parseCSV(content);
  console.log(`${table}: ${rows.length} rows`);

  if (!rows.length) continue;

  sql += `-- --------------------------------------------------------\n-- ${table} (${rows.length} rows)\n-- --------------------------------------------------------\n`;

  for (const row of rows) {
    const cols = headers.map(h => `\`${h}\``).join(', ');
    const vals = headers.map(h => escapeSQL(row[h])).join(', ');
    sql += `INSERT IGNORE INTO \`${table}\` (${cols}) VALUES (${vals});\n`;
  }
  sql += '\n';
}

sql += 'SET FOREIGN_KEY_CHECKS=1;\n';

const outPath = path.join('C:\\Users\\DELL\\Desktop\\Rootedpredicts', 'tidb_import.sql');
fs.writeFileSync(outPath, sql, 'utf8');
const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`\nDone! SQL file: ${outPath} (${sizeKB} KB)`);
