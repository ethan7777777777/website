import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.join(process.cwd(), 'openclaw.db');

// Create DB if it doesn’t exist
if (!fs.existsSync(dbPath)) {
  const dbInit = new sqlite3.Database(dbPath);
  dbInit.run(`CREATE TABLE IF NOT EXISTS compliance_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_name TEXT NOT NULL,
    work_email TEXT NOT NULL,
    number_of_locations TEXT NOT NULL
  )`);
  dbInit.close();
}

const db = new sqlite3.Database(dbPath);

export default function handler(req, res) {
  if (req.method === 'POST') {
    const { clinic_name, work_email, number_of_locations } = req.body;
    if (!clinic_name || !work_email || !number_of_locations) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    db.run(
      `INSERT INTO compliance_requests (clinic_name, work_email, number_of_locations) VALUES (?, ?, ?)`,
      [clinic_name, work_email, number_of_locations],
      function (err) {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Failed to save data' });
        }
        res.status(200).json({ message: 'Saved successfully' });
      }
    );
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}