export function buildOtpEmailHtml(otp: string, name = "there"): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your EDDVA Verification Code</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0"
          style="background:#ffffff;border-radius:20px;overflow:hidden;
                 box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header gradient -->
          <tr>
            <td style="background:linear-gradient(135deg,#3B82F6,#A855F7);
                       padding:36px 40px 32px;text-align:center;">
              <!-- Logo wordmark -->
              <div style="display:inline-flex;align-items:center;gap:10px;">
                <div style="width:40px;height:40px;background:rgba(255,255,255,0.2);
                            border-radius:10px;display:flex;align-items:center;
                            justify-content:center;font-size:22px;">🎓</div>
                <span style="font-size:26px;font-weight:900;color:#fff;
                             letter-spacing:-0.5px;">EDDVA</span>
              </div>
              <p style="margin:12px 0 0;color:rgba(255,255,255,0.85);
                        font-size:14px;font-weight:500;">
                Aero Learning Platform
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 48px 32px;">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;
                         color:#0f172a;letter-spacing:-0.3px;">
                Verify your email address
              </h1>
              <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6;">
                Hi <strong style="color:#334155;">${name}</strong>, use the code below to
                complete your EDDVA account verification.
              </p>

              <!-- OTP Box -->
              <div style="background:linear-gradient(135deg,#eff6ff,#f5f3ff);
                          border:2px solid #e0e7ff;border-radius:16px;
                          padding:32px 24px;text-align:center;margin-bottom:28px;">
                <p style="margin:0 0 8px;font-size:12px;font-weight:700;
                          color:#6366f1;text-transform:uppercase;letter-spacing:0.15em;">
                  Your verification code
                </p>
                <div style="font-size:48px;font-weight:900;letter-spacing:12px;
                            color:#1e293b;line-height:1.1;font-family:monospace;">
                  ${otp}
                </div>
                <p style="margin:12px 0 0;font-size:13px;color:#94a3b8;font-weight:500;">
                  ⏰ Expires in <strong style="color:#ef4444;">5 minutes</strong>
                </p>
              </div>

              <!-- Info bullets -->
              <div style="background:#f8fafc;border-radius:12px;padding:20px 24px;margin-bottom:28px;">
                <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#475569;">
                  Keep your account safe:
                </p>
                <ul style="margin:0;padding-left:18px;color:#64748b;font-size:13px;line-height:1.8;">
                  <li>Never share this code with anyone, including EDDVA staff.</li>
                  <li>This code can only be used once.</li>
                  <li>If you didn't request this, please ignore this email.</li>
                </ul>
              </div>

              <p style="margin:0;font-size:14px;color:#94a3b8;line-height:1.6;">
                Having trouble? Contact us at
                <a href="mailto:support@eddva.in"
                   style="color:#3B82F6;font-weight:600;text-decoration:none;">
                  support@eddva.in
                </a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:24px 48px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">
                © ${new Date().getFullYear()} EDDVA · Aero Learning Platform ·
                <a href="https://eddva.in/privacy-policy"
                   style="color:#94a3b8;text-decoration:underline;">Privacy Policy</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
