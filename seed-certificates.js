const { DataSource } = require('typeorm');
require('dotenv').config();

const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

const TEMPLATE_TRANSFER_CERTIFICATE = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Roboto:wght@400;500&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Roboto', sans-serif; background: #fff; color: #1e293b; }

  .cert-page {
    width: 794px;
    height: 1123px; /* A4 Portrait */
    margin: 0 auto;
    page-break-after: always;
    page-break-inside: avoid;
    position: relative;
    padding: 60px;
    background: #fff;
    border: 20px solid #0f172a;
    box-shadow: 0 0 0 5px #e2e8f0 inset;
  }

  .watermark {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    opacity: 0.03;
    width: 60%;
    z-index: 0;
  }

  .header {
    text-align: center;
    position: relative;
    z-index: 1;
    margin-bottom: 50px;
  }
  .header img {
    height: 100px;
    margin-bottom: 20px;
  }
  .header h1 {
    font-family: 'Playfair Display', serif;
    font-size: 42px;
    color: #0f172a;
    text-transform: uppercase;
    letter-spacing: 2px;
  }
  .header p {
    font-size: 16px;
    color: #64748b;
    margin-top: 10px;
  }

  .title {
    text-align: center;
    margin: 40px 0;
    position: relative;
    z-index: 1;
  }
  .title h2 {
    font-family: 'Playfair Display', serif;
    font-size: 32px;
    color: #b91c1c;
    text-transform: uppercase;
    letter-spacing: 4px;
    border-bottom: 2px solid #b91c1c;
    display: inline-block;
    padding-bottom: 10px;
  }

  .content {
    font-size: 18px;
    line-height: 2.2;
    position: relative;
    z-index: 1;
    text-align: justify;
    padding: 0 30px;
  }
  .content .highlight {
    font-weight: bold;
    font-size: 20px;
    border-bottom: 1px dashed #64748b;
    padding: 0 10px;
  }

  .details {
    margin-top: 40px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px 40px;
    position: relative;
    z-index: 1;
    padding: 0 30px;
  }
  .detail-row {
    font-size: 16px;
    display: flex;
  }
  .detail-label {
    font-weight: 600;
    width: 150px;
    color: #475569;
  }
  .detail-value {
    font-weight: 500;
    flex: 1;
    border-bottom: 1px dotted #94a3b8;
  }

  .footer {
    position: absolute;
    bottom: 80px;
    left: 60px;
    right: 60px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    z-index: 1;
  }
  .signature {
    text-align: center;
  }
  .signature .line {
    width: 200px;
    height: 1px;
    background: #1e293b;
    margin-bottom: 10px;
  }
  .signature p {
    font-size: 14px;
    color: #475569;
    font-weight: 500;
    text-transform: uppercase;
  }
</style>

{{#each this}}
<div class="cert-page">
  {{#if schoolLogo}}<img src="{{schoolLogo}}" class="watermark" alt="Watermark" />{{/if}}
  
  <div class="header">
    {{#if schoolLogo}}<img src="{{schoolLogo}}" alt="School Logo" />{{/if}}
    <h1>{{schoolName}}</h1>
    <p>{{schoolAddress}}</p>
  </div>

  <div class="title">
    <h2>Transfer Certificate</h2>
  </div>

  <div class="content">
    This is to certify that <span class="highlight">{{fullName}}</span>, 
    son/daughter of <span class="highlight">{{parentName}}</span>, 
    has been a bona fide student of this institution. They have successfully completed 
    their studies in class <span class="highlight">{{className}} - {{section}}</span>.
    Their conduct during the period of study has been generally satisfactory.
  </div>

  <div class="details">
    <div class="detail-row">
      <div class="detail-label">Admission No:</div>
      <div class="detail-value">{{rollNo}}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Date of Birth:</div>
      <div class="detail-value">{{dob}}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Date of Issue:</div>
      <div class="detail-value">{{issueDate}}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Reason for leaving:</div>
      <div class="detail-value">{{reasonForTransfer}}</div>
    </div>
  </div>

  <div class="footer">
    <div class="signature">
      <div class="line"></div>
      <p>Class Teacher</p>
    </div>
    <div class="signature" style="text-align: center;">
      {{#if qrCode}}<img src="{{qrCode}}" alt="Verify QR" style="width: 80px; height: 80px; margin-bottom:10px;" />{{/if}}
      <p style="font-size: 10px;">Scan to Verify</p>
    </div>
    <div class="signature">
      <div class="line"></div>
      <p>Principal</p>
    </div>
  </div>
</div>
{{/each}}
`;

const TEMPLATE_BONAFIDE = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', sans-serif; background: #fff; color: #1e293b; }

  .cert-page {
    width: 794px;
    height: 1123px; /* A4 Portrait */
    margin: 0 auto;
    page-break-after: always;
    page-break-inside: avoid;
    position: relative;
    padding: 80px;
    background: #fff;
    border: 5px solid #2563eb;
    outline: 2px solid #2563eb;
    outline-offset: -15px;
  }

  .header {
    display: flex;
    align-items: center;
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 30px;
    margin-bottom: 50px;
  }
  .header img {
    height: 90px;
    margin-right: 30px;
  }
  .header-text {
    flex: 1;
  }
  .header-text h1 {
    font-family: 'Merriweather', serif;
    font-size: 34px;
    color: #1e3a8a;
    font-weight: 700;
  }
  .header-text p {
    font-size: 14px;
    color: #64748b;
    margin-top: 5px;
  }

  .title {
    text-align: center;
    margin-bottom: 60px;
  }
  .title h2 {
    font-size: 28px;
    color: #0f172a;
    text-transform: uppercase;
    letter-spacing: 2px;
    text-decoration: underline;
    text-underline-offset: 8px;
  }

  .content {
    font-family: 'Merriweather', serif;
    font-size: 20px;
    line-height: 2.4;
    text-align: justify;
  }
  .highlight {
    font-family: 'Inter', sans-serif;
    font-weight: 700;
    font-size: 22px;
    color: #1e3a8a;
    border-bottom: 2px solid #cbd5e1;
    padding: 0 10px;
  }

  .footer {
    position: absolute;
    bottom: 100px;
    left: 80px;
    right: 80px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .date-box {
    font-size: 16px;
    font-weight: 500;
  }
  .signature {
    text-align: center;
  }
  .signature .line {
    width: 250px;
    height: 2px;
    background: #1e293b;
    margin-bottom: 10px;
  }
  .signature p {
    font-size: 16px;
    font-weight: 600;
  }
</style>

{{#each this}}
<div class="cert-page">
  <div class="header">
    {{#if schoolLogo}}<img src="{{schoolLogo}}" alt="Logo" />{{/if}}
    <div class="header-text">
      <h1>{{schoolName}}</h1>
      <p>{{schoolAddress}}</p>
    </div>
    {{#if qrCode}}<img src="{{qrCode}}" alt="QR" style="height: 70px; margin-right: 0;" />{{/if}}
  </div>

  <div class="title">
    <h2>Bonafide Certificate</h2>
  </div>

  <div class="content">
    This is to certify that 
    <span class="highlight">{{fullName}}</span> 
    (Admission No: <span class="highlight">{{rollNo}}</span>), 
    son/daughter of <span class="highlight">{{parentName}}</span>, 
    whose date of birth is <span class="highlight">{{dob}}</span>, 
    is a bonafide student of this institution. 
    They are currently studying in Class <span class="highlight">{{className}} - {{section}}</span> 
    during the academic year 2026-2027.
    <br/><br/>
    To the best of our knowledge and belief, they bear a good moral character.
  </div>

  <div class="footer">
    <div class="date-box">
      Date: {{issueDate}}
    </div>
    <div class="signature">
      <div class="line"></div>
      <p>Authorized Signatory</p>
    </div>
  </div>
</div>
{{/each}}
`;

const TEMPLATE_LEAVING_CERTIFICATE = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Montserrat:wght@400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Montserrat', sans-serif; background: #fff; color: #333; }

  .cert-page {
    width: 794px;
    height: 1123px;
    margin: 0 auto;
    page-break-after: always;
    position: relative;
    padding: 70px;
    background: #fdfbf7;
    border: 15px solid #2d3748;
    box-shadow: 0 0 0 4px #e2e8f0 inset;
  }

  .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #718096; padding-bottom: 20px; }
  .header h1 { font-family: 'Cinzel', serif; font-size: 38px; color: #1a202c; font-weight: 700; letter-spacing: 2px; }
  .header p { font-size: 15px; color: #4a5568; margin-top: 8px; }
  
  .title { text-align: center; margin: 50px 0; }
  .title h2 { font-family: 'Cinzel', serif; font-size: 30px; color: #2b6cb0; text-transform: uppercase; letter-spacing: 5px; }

  .content { font-size: 18px; line-height: 2.2; text-align: justify; padding: 0 20px; }
  .highlight { font-weight: 600; font-size: 20px; color: #2d3748; padding: 0 5px; border-bottom: 1px dotted #718096; }

  .details { margin-top: 50px; padding: 0 20px; }
  .row { display: flex; margin-bottom: 15px; font-size: 16px; }
  .label { font-weight: 600; width: 220px; color: #4a5568; }
  .value { flex: 1; border-bottom: 1px solid #cbd5e0; font-weight: 500; }

  .footer { position: absolute; bottom: 80px; left: 70px; right: 70px; display: flex; justify-content: space-between; align-items: flex-end; }
  .signature { text-align: center; }
  .line { width: 220px; height: 1px; background: #2d3748; margin-bottom: 8px; }
</style>
{{#each this}}
<div class="cert-page">
  <div class="header">
    <h1>{{schoolName}}</h1>
    <p>{{schoolAddress}}</p>
  </div>
  <div class="title">
    <h2>College Leaving Certificate</h2>
  </div>
  <div class="content">
    This is to certify that <span class="highlight">{{fullName}}</span> 
    has been a student of this College from <span class="highlight">2024</span> 
    to <span class="highlight">2026</span>. They have successfully passed the 
    examination for the class of <span class="highlight">{{className}}</span>. 
    Their character and conduct have been good throughout their stay.
  </div>
  <div class="details">
    <div class="row"><div class="label">Enrollment No.</div><div class="value">{{rollNo}}</div></div>
    <div class="row"><div class="label">Date of Birth</div><div class="value">{{dob}}</div></div>
    <div class="row"><div class="label">Parent's Name</div><div class="value">{{parentName}}</div></div>
    <div class="row"><div class="label">Date of Issue</div><div class="value">{{issueDate}}</div></div>
  </div>
  <div class="footer">
    <div class="signature"><div class="line"></div><p>Registrar</p></div>
    {{#if qrCode}}<img src="{{qrCode}}" style="height:80px;" />{{/if}}
    <div class="signature"><div class="line"></div><p>Principal</p></div>
  </div>
</div>
{{/each}}
`;

const TEMPLATE_SPORTS_CERTIFICATE = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Lato:ital,wght@0,400;0,700;1,400&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Lato', sans-serif; background: #fff; color: #1f2937; }

  .cert-page {
    width: 1123px; /* A4 Landscape */
    height: 794px;
    margin: 0 auto;
    page-break-after: always;
    position: relative;
    padding: 50px;
    background: #fff;
    border: 8px solid #f59e0b;
    outline: 20px solid #1e3a8a;
    outline-offset: -20px;
  }

  .header { text-align: center; margin-bottom: 20px; }
  .header h1 { font-family: 'Oswald', sans-serif; font-size: 40px; color: #1e3a8a; text-transform: uppercase; letter-spacing: 2px; }
  .header p { font-size: 16px; color: #6b7280; font-style: italic; }

  .title { text-align: center; margin: 40px 0; }
  .title h2 { font-family: 'Oswald', sans-serif; font-size: 48px; color: #f59e0b; text-transform: uppercase; letter-spacing: 4px; }
  .title h3 { font-family: 'Lato', sans-serif; font-size: 24px; color: #4b5563; font-weight: 400; margin-top: 10px; }

  .content { text-align: center; font-size: 22px; line-height: 2; padding: 0 60px; margin-top: 40px; }
  .highlight { font-family: 'Oswald', sans-serif; font-size: 32px; color: #1e3a8a; border-bottom: 2px solid #f59e0b; padding: 0 15px; margin: 0 10px; font-weight: 500; }
  .event-name { font-size: 24px; font-weight: bold; color: #b91c1c; border-bottom: 2px dashed #b91c1c; }

  .footer { position: absolute; bottom: 60px; left: 80px; right: 80px; display: flex; justify-content: space-between; align-items: flex-end; }
  .signature { text-align: center; }
  .line { width: 250px; height: 2px; background: #374151; margin-bottom: 10px; }
  .signature p { font-weight: bold; font-size: 18px; text-transform: uppercase; color: #4b5563; }
</style>
{{#each this}}
<div class="cert-page">
  <div class="header">
    <h1>{{schoolName}}</h1>
    <p>{{schoolAddress}}</p>
  </div>
  <div class="title">
    <h2>Certificate of Achievement</h2>
    <h3>Sports & Athletics Department</h3>
  </div>
  <div class="content">
    This certificate is proudly awarded to <br/>
    <span class="highlight">{{fullName}}</span> <br/>
    of Class <span style="font-weight:bold;">{{className}} - {{section}}</span> for outstanding performance and securing 
    <strong>First Place</strong> in <span class="event-name">100m Sprint</span> 
    held on {{issueDate}}.
  </div>
  <div class="footer">
    <div class="signature"><div class="line"></div><p>Sports Coach</p></div>
    {{#if qrCode}}<img src="{{qrCode}}" style="height:90px;" />{{/if}}
    <div class="signature"><div class="line"></div><p>Principal</p></div>
  </div>
</div>
{{/each}}
`;

async function run() {
  await ds.initialize();
  console.log('Connected to DB');
  
  await ds.query(`
    INSERT INTO school_document_templates (name, type, html_content, dimensions, is_active)
    VALUES ($1, $2, $3, $4, $5)
  `, [
    'Standard Transfer Certificate',
    'CERTIFICATE',
    TEMPLATE_TRANSFER_CERTIFICATE,
    JSON.stringify({ width: 794, height: 1123, orientation: 'portrait', margin: 0 }),
    true
  ]);

  await ds.query(`
    INSERT INTO school_document_templates (name, type, html_content, dimensions, is_active)
    VALUES ($1, $2, $3, $4, $5)
  `, [
    'Official Bonafide Certificate',
    'CERTIFICATE',
    TEMPLATE_BONAFIDE,
    JSON.stringify({ width: 794, height: 1123, orientation: 'portrait', margin: 0 }),
    true
  ]);

  await ds.query(`
    INSERT INTO school_document_templates (name, type, html_content, dimensions, is_active)
    VALUES ($1, $2, $3, $4, $5)
  `, [
    'College Leaving Certificate',
    'CERTIFICATE',
    TEMPLATE_LEAVING_CERTIFICATE,
    JSON.stringify({ width: 794, height: 1123, orientation: 'portrait', margin: 0 }),
    true
  ]);

  await ds.query(`
    INSERT INTO school_document_templates (name, type, html_content, dimensions, is_active)
    VALUES ($1, $2, $3, $4, $5)
  `, [
    'Sports Achievement Certificate',
    'CERTIFICATE',
    TEMPLATE_SPORTS_CERTIFICATE,
    JSON.stringify({ width: 1123, height: 794, orientation: 'landscape', margin: 0 }),
    true
  ]);
  
  console.log('Successfully seeded Certificates!');
  await ds.destroy();
}

run().catch(console.error);
