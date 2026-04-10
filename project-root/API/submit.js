// Backend handler for form submissions
// This can be used with Express, serverless functions, or other Node.js frameworks

const handleFormSubmission = async (req, res) => {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { clinicName, email, locations } = req.body;

    // Validate required fields
    if (!clinicName || !email || !locations) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email address' });
    }

    // TODO: Add your email service integration here (SendGrid, AWS SES, etc.)
    // Example:
    // await sendEmail({
    //   to: 'hello@compliancecurrent.com',
    //   from: 'noreply@compliancecurrent.com',
    //   subject: 'New Free Scan Request',
    //   html: `
    //     <h2>New Booking Request</h2>
    //     <p><strong>Clinic Name:</strong> ${clinicName}</p>
    //     <p><strong>Email:</strong> ${email}</p>
    //     <p><strong>Locations:</strong> ${locations}</p>
    //   `
    // });

    // TODO: Store submission in database
    // Example:
    // await db.submissions.create({
    //   clinicName,
    //   email,
    //   locations,
    //   submittedAt: new Date()
    // });

    // Send confirmation response
    return res.status(200).json({
      message: 'Submission received. We will contact you within one business hour.',
      submissionId: `SUB-${Date.now()}`
    });
  } catch (error) {
    console.error('Form submission error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Export for different frameworks
module.exports = handleFormSubmission;

// For Express.js usage:
// app.post('/api/submit', handleFormSubmission);

// For AWS Lambda:
// exports.handler = async (event) => {
//   const req = { method: event.httpMethod, body: JSON.parse(event.body) };
//   const res = {
//     status: (code) => ({ json: (data) => ({ statusCode: code, body: JSON.stringify(data) }) })
//   };
//   return await handleFormSubmission(req, res);
// };
