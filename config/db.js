// config/db.js
// MySQL connection pool for Rooted Predictions
// Uses mysql2/promise for async/await support throughout the application

'use strict';

const mysql = require('mysql2/promise');
require('dotenv').config();

// Create a connection pool — reuses connections rather than opening/closing per query
const pool = mysql.createPool({
  host:              process.env.DB_HOST     || 'localhost',
  port:              parseInt(process.env.DB_PORT) || 3306,
  database:          process.env.DB_NAME     || 'afroPredict',
  user:              process.env.DB_USER     || 'root',
  password:          process.env.DB_PASSWORD || '',
  connectionLimit:   parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
  waitForConnections: true,
  queueLimit:        0,
  // Return dates as strings to avoid timezone conversion issues
  dateStrings:       true,
  // Automatically handle reconnections
  enableKeepAlive:   true,
  keepAliveInitialDelay: 10000,
});

// Test the connection on startup
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('[DB] MySQL connection pool established successfully');
    console.log(`[DB] Connected to database: ${process.env.DB_NAME} on ${process.env.DB_HOST}`);
    connection.release();
  } catch (error) {
    console.error('[DB] Failed to connect to MySQL:', error.message);
    console.error('[DB] Check your DB_* environment variables in .env');
    process.exit(1); // Exit — app cannot run without database
  }
}

testConnection();

module.exports = pool;
