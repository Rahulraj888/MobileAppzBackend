import nodemailer from 'nodemailer';

export default async function sendEmail({ to, subject, html }) {
  const transporter = nodemailer.createTransport(
    {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      logger: true,
      debug: true
    },
    {
      from: `"No-Reply" <Mobile Appz>` // default sender
    }
  );

  try {
    const info = await transporter.sendMail({ to, subject, html });
    console.log('📧 Email sent:', info.messageId);
  } catch (err) {
    console.error('❌ Error sending email:', err);
    throw err;
  }
}
