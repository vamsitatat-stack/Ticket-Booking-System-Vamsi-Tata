const qrcode = require('qrcode');
const nodemailer = require('nodemailer');

// Configure your SMTP transporter (e.g., SendGrid, Mailgun, or free Ethereal/Gmail setup)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: process.env.SMTP_PORT || 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Generates a QR code PNG Data URL and emails a ticket to the customer.
 */
async function sendTicketEmail({ customerEmail, customerName, bookingRef, showTitle, seats, eventDate }) {
  try {
    // 1. Generate QR code payload (Base64 Data URL)
    const qrPayload = JSON.stringify({
      bookingRef,
      showTitle,
      seats,
      timestamp: new Date().toISOString(),
    });

    const qrCodeDataUrl = await qrcode.toDataURL(qrPayload);

    // Convert Data URL to a Buffer for Nodemailer inline attachment
    const base64Data = qrCodeDataUrl.replace(/^data:image\/png;base64,/, '');
    const qrBuffer = Buffer.from(base64Data, 'base64');

    // 2. Draft HTML Email with embedded QR Code (cid:qrcode)
    const mailOptions = {
      from: `"Ticket Hub" <${process.env.SMTP_FROM || 'no-reply@tickethub.com'}>`,
      to: customerEmail,
      subject: `Your Ticket Confirmation - ${bookingRef}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px;">
          <h2 style="color: #2c3e50; text-align: center;">Booking Confirmed!</h2>
          <p>Hi <strong>${customerName}</strong>,</p>
          <p>Your seats are confirmed for <strong>${showTitle}</strong>.</p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Booking Ref:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${bookingRef}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Date & Time:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${eventDate}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Seats:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${seats.join(', ')}</td></tr>
          </table>

          <div style="text-align: center; margin: 30px 0;">
            <p style="font-weight: bold; margin-bottom: 10px;">Scan at venue entry:</p>
            <img src="cid:qrcode" alt="Ticket QR Code" style="width: 200px; height: 200px;" />
          </div>
          
          <p style="font-size: 12px; color: #7f8c8d; text-align: center;">Keep this email safe. Present your QR code upon arrival.</p>
        </div>
      `,
      attachments: [
        {
          filename: 'ticket-qr.png',
          content: qrBuffer,
          cid: 'qrcode', // Matches <img src="cid:qrcode">
        },
      ],
    };

    // 3. Send email
    const info = await transporter.sendMail(mailOptions);
    console.log(`Ticket email sent to ${customerEmail}. Message ID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('Failed to send ticket email:', error);
    throw error;
  }
}

module.exports = { sendTicketEmail };
