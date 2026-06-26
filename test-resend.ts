import { Resend } from 'resend';
import * as dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.RESEND_FROM_EMAIL || 'EDDVA <noreply@eddva.in>';

console.log('Using RESEND_API_KEY:', apiKey ? 'FOUND (starts with ' + apiKey.slice(0, 5) + ')' : 'MISSING');
console.log('Using RESEND_FROM_EMAIL:', fromEmail);

if (!apiKey) {
  console.error('Error: RESEND_API_KEY is not defined in environment.');
  process.exit(1);
}

const resend = new Resend(apiKey);

async function test() {
  try {
    const data = await resend.emails.send({
      from: fromEmail,
      to: ['pratapkumar.das@pratap.website'], // Send to the verified domain owner
      subject: 'Test Verification Code from EDDVA Coaching',
      html: '<p>Your test OTP is <strong>999999</strong>.</p>',
    });
    console.log('Email sent successfully!', data);
  } catch (error) {
    console.error('Failed to send email:', error);
  }
}

test();
