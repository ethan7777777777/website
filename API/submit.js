import { createConnection } from 'sqlite3';

const db = new createConnection('openclaw.db');

export default function handler(req, res) {
    if (req.method === 'POST') {
        const { clinic_name, work_email, number_of_locations } = req.body;

        // Insert data into SQLite database
        db.run(`INSERT INTO compliance_requests (clinic_name, work_email, number_of_locations) VALUES (?, ?, ?)`, 
            [clinic_name, work_email, number_of_locations], 
            function(err) {
                if (err) {
                    res.status(500).json({ error: 'Failed to save data' });
                    return;
                }
                res.status(200).json({ message: 'Data saved successfully' });
            });
    } else {
        res.setHeader('Allow', ['POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}
