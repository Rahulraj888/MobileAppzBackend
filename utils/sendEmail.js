const nodemailer = require('nodemailer');

async function sendEmail({ to, subject, html }) {
  console.log('Attempting to connect to SMTP server...');
  const transporter = nodemailer.createTransport(
    {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10),
      secure: process.env.SMTP_PORT === '465', // true if port 465, false for 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      logger: true,
      debug: true
      // tls: {
      //   rejectUnauthorized: false   // (uncomment only if you suspect a TLS certificate issue)
      // }
    },
    {
      // defaults for messages
      from: `"No-Reply" <Mobile Appz>`
    }
  );

  try {
    const info = await transporter.sendMail({
      to,
      subject,
      html
    });
    console.log('📧 Email sent: %s', info.messageId);
  } catch (err) {
    console.error('Error sending email:', err);
    throw err; // rethrow so your route knows it failed
  }
}

module.exports = sendEmail;
