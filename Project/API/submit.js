import sqlite3 from 'sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'openclaw.db');
const db = new sqlite3.Database(dbPath);

export default function handler(req, res) {
  if (req.method === 'POST') {
    const { clinic_name, work_email, number_of_locations } = req.body;

    if (!clinic_name || !work_email || !number_of_locations) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const stmt = db.prepare(
      'INSERT INTO compliance_requests (clinic_name, work_email, number_of_locations) VALUES (?, ?, ?)'
    );
    stmt.run([clinic_name, work_email, number_of_locations], function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to save data' });
      }
      res.status(200).json({ message: 'Data saved successfully' });
    });
    stmt.finalize();
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}