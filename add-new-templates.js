const { DataSource } = require('typeorm');
require('dotenv').config();

const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

const TEMPLATE_CORPORATE_RED = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Montserrat', sans-serif; background: #fff; }

  .card-page {
    width: 340px;
    min-height: 520px;
    margin: 20px auto;
    page-break-after: always;
    page-break-inside: avoid;
    border-radius: 16px;
    background: #fff;
    overflow: hidden;
    position: relative;
    box-shadow: 0 10px 25px rgba(0,0,0,0.1);
    border: 1px solid #f1f5f9;
  }

  /* ═══════════ FRONT CARD ═══════════ */
  .front-bg {
    position: absolute;
    top: 0; left: 0; right: 0; height: 160px;
    background: linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%);
    border-bottom-left-radius: 50%;
    border-bottom-right-radius: 50%;
    z-index: 0;
  }

  .front-content {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 25px;
  }

  .school-header {
    text-align: center;
    color: white;
    margin-bottom: 25px;
  }
  .school-header img {
    height: 45px;
    background: white;
    padding: 5px;
    border-radius: 10px;
    margin-bottom: 10px;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  }
  .school-header h1 {
    font-size: 16px;
    font-weight: 800;
    letter-spacing: 0.5px;
  }

  .photo-container {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    background: white;
    padding: 4px;
    box-shadow: 0 8px 15px rgba(185, 28, 28, 0.2);
    margin-bottom: 15px;
    position: relative;
  }
  .photo-container img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }
  .id-badge {
    position: absolute;
    bottom: -10px;
    left: 50%;
    transform: translateX(-50%);
    background: #b91c1c;
    color: white;
    font-size: 10px;
    font-weight: 700;
    padding: 4px 12px;
    border-radius: 12px;
    border: 2px solid white;
    white-space: nowrap;
  }

  .student-name {
    text-align: center;
    margin-top: 10px;
  }
  .student-name h2 {
    font-size: 22px;
    font-weight: 800;
    color: #1e293b;
    text-transform: uppercase;
  }
  .student-name p {
    font-size: 12px;
    font-weight: 600;
    color: #b91c1c;
    margin-top: 2px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .details-grid {
    margin-top: 25px;
    width: 85%;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px 10px;
  }
  .detail-item {
    display: flex;
    flex-direction: column;
  }
  .detail-label {
    font-size: 9px;
    color: #64748b;
    text-transform: uppercase;
    font-weight: 700;
    margin-bottom: 2px;
  }
  .detail-value {
    font-size: 12px;
    color: #0f172a;
    font-weight: 600;
  }

  .footer-bar {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 35px;
    background: #1e293b;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  /* ═══════════ BACK CARD ═══════════ */
  .back-bg {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: #fafaf9;
    z-index: 0;
  }
  .back-bg::after {
    content: '';
    position: absolute;
    top: -50px; right: -50px;
    width: 150px; height: 150px;
    border-radius: 50%;
    background: rgba(185, 28, 28, 0.05);
    z-index: 0;
  }

  .back-content {
    position: relative;
    z-index: 1;
    padding: 30px 25px;
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
  }
  .qr-box {
    background: white;
    padding: 10px;
    border-radius: 12px;
    box-shadow: 0 4px 10px rgba(0,0,0,0.05);
    margin-bottom: 25px;
  }
  .qr-box img {
    width: 100px;
    height: 100px;
  }

  .terms {
    width: 100%;
    margin-bottom: 25px;
  }
  .terms h3 {
    font-size: 11px;
    color: #b91c1c;
    margin-bottom: 10px;
    text-transform: uppercase;
    font-weight: 800;
    text-align: center;
  }
  .terms ul {
    list-style: none;
    font-size: 10px;
    color: #475569;
    line-height: 1.6;
  }
  .terms li {
    margin-bottom: 6px;
    padding-left: 12px;
    position: relative;
  }
  .terms li::before {
    content: "•";
    color: #b91c1c;
    position: absolute;
    left: 0;
    font-weight: bold;
  }
  .back-footer {
    margin-top: auto;
    text-align: center;
    width: 100%;
    padding-top: 15px;
    border-top: 1px dashed #cbd5e1;
  }
  .back-footer p {
    font-size: 10px;
    color: #64748b;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .back-footer strong {
    color: #1e293b;
    font-size: 11px;
  }
</style>

{{#each this}}
<!-- FRONT -->
<div class="card-page">
  <div class="front-bg"></div>
  <div class="front-content">
    <div class="school-header">
      {{#if schoolLogo}}<img src="{{schoolLogo}}" alt="Logo" />{{/if}}
      <h1>{{schoolName}}</h1>
    </div>
    <div class="photo-container">
      <img src="{{profileImage}}" alt="Photo" />
      <div class="id-badge">ID: {{#if rollNo}}{{rollNo}}{{else}}{{employeeId}}{{/if}}</div>
    </div>
    <div class="student-name">
      <h2>{{firstName}} {{lastName}}</h2>
      <p>{{#if className}}STUDENT{{else}}STAFF MEMBER{{/if}}</p>
    </div>
    <div class="details-grid">
      {{#if className}}
      <div class="detail-item">
        <span class="detail-label">Class</span>
        <span class="detail-value">{{className}} - {{section}}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">DOB</span>
        <span class="detail-value">{{dob}}</span>
      </div>
      {{/if}}
      <div class="detail-item">
        <span class="detail-label">Blood Group</span>
        <span class="detail-value">{{bloodGroup}}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Emergency Phone</span>
        <span class="detail-value">{{phone}}</span>
      </div>
    </div>
  </div>
  <div class="footer-bar">
    Valid for Academic Year 2026-27
  </div>
</div>

<!-- BACK -->
<div class="card-page">
  <div class="back-bg"></div>
  <div class="back-content">
    <div class="qr-box">
      {{#if qrCode}}<img src="{{qrCode}}" alt="QR" />{{/if}}
    </div>
    <div class="terms">
      <h3>Terms & Conditions</h3>
      <ul>
        <li>This card is property of {{schoolName}}.</li>
        <li>Must be worn at all times while on campus.</li>
        <li>Transfer or misuse is strictly prohibited.</li>
        <li>If found, please return to the school office.</li>
      </ul>
    </div>
    <div class="back-footer">
      <p>School Address</p>
      <strong>{{schoolAddress}}</strong>
    </div>
  </div>
</div>
{{/each}}
`;

const TEMPLATE_ELITE_DARK = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;700;800&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Outfit', sans-serif; background: #fff; }

  .card-page {
    width: 340px;
    min-height: 520px;
    margin: 20px auto;
    page-break-after: always;
    page-break-inside: avoid;
    border-radius: 20px;
    background: #0f172a;
    color: white;
    overflow: hidden;
    position: relative;
    box-shadow: 0 15px 35px rgba(0,0,0,0.3);
  }

  /* ═══════════ FRONT CARD ═══════════ */
  .glow-circle-1 {
    position: absolute;
    top: -50px; right: -50px;
    width: 200px; height: 200px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(139,92,246,0.4) 0%, rgba(0,0,0,0) 70%);
    z-index: 0;
  }
  .glow-circle-2 {
    position: absolute;
    bottom: -80px; left: -80px;
    width: 250px; height: 250px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(56,189,248,0.3) 0%, rgba(0,0,0,0) 70%);
    z-index: 0;
  }

  .front-content {
    position: relative;
    z-index: 1;
    padding: 25px;
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .header-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 30px;
    background: rgba(255,255,255,0.05);
    padding: 10px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.1);
    backdrop-filter: blur(10px);
  }
  .header-row img {
    height: 35px;
    border-radius: 8px;
  }
  .header-row h1 {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.5px;
    line-height: 1.2;
    background: linear-gradient(to right, #fff, #94a3b8);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .profile-section {
    display: flex;
    gap: 20px;
    align-items: center;
    margin-bottom: 25px;
  }
  .photo-wrapper {
    width: 90px;
    height: 90px;
    border-radius: 18px;
    padding: 3px;
    background: linear-gradient(135deg, #38bdf8, #8b5cf6);
    flex-shrink: 0;
  }
  .photo-wrapper img {
    width: 100%;
    height: 100%;
    border-radius: 15px;
    object-fit: cover;
    background: #1e293b;
  }
  .name-block {
    flex-grow: 1;
  }
  .name-block h2 {
    font-size: 22px;
    font-weight: 800;
    line-height: 1.1;
    margin-bottom: 6px;
  }
  .name-block .role {
    font-size: 11px;
    color: #38bdf8;
    text-transform: uppercase;
    font-weight: 700;
    letter-spacing: 1px;
  }

  .glass-panel {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    padding: 15px;
    backdrop-filter: blur(10px);
  }
  .details-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px;
  }
  .detail-box {
    display: flex;
    flex-direction: column;
  }
  .d-label {
    font-size: 9px;
    color: #64748b;
    text-transform: uppercase;
    font-weight: 700;
    letter-spacing: 0.5px;
    margin-bottom: 3px;
  }
  .d-value {
    font-size: 13px;
    font-weight: 600;
    color: #f8fafc;
  }

  .bottom-row {
    margin-top: auto;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .id-box {
    background: rgba(139,92,246,0.2);
    border: 1px solid rgba(139,92,246,0.5);
    padding: 8px 15px;
    border-radius: 10px;
  }
  .id-box span {
    display: block;
    font-size: 8px;
    color: #c4b5fd;
    text-transform: uppercase;
    margin-bottom: 2px;
  }
  .id-box strong {
    font-size: 14px;
    color: white;
    font-weight: 700;
    letter-spacing: 1px;
  }

  /* ═══════════ BACK CARD ═══════════ */
  .back-content {
    position: relative;
    z-index: 1;
    padding: 30px;
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
  }

  .qr-wrapper {
    background: white;
    padding: 8px;
    border-radius: 16px;
    margin-bottom: 30px;
    border: 3px solid rgba(56,189,248,0.5);
  }
  .qr-wrapper img {
    width: 120px;
    height: 120px;
    display: block;
  }

  .rules {
    width: 100%;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    padding: 20px;
  }
  .rules h3 {
    font-size: 12px;
    color: #38bdf8;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 12px;
    text-align: center;
  }
  .rules p {
    font-size: 10px;
    color: #94a3b8;
    line-height: 1.7;
    text-align: center;
  }
  .rules p.highlight {
    color: #e2e8f0;
    font-weight: 500;
    margin-top: 10px;
  }

  .back-footer {
    margin-top: auto;
    text-align: center;
  }
  .back-footer p {
    font-size: 9px;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 4px;
  }
  .back-footer strong {
    font-size: 11px;
    color: #cbd5e1;
  }
</style>

{{#each this}}
<!-- FRONT -->
<div class="card-page">
  <div class="glow-circle-1"></div>
  <div class="glow-circle-2"></div>
  <div class="front-content">
    <div class="header-row">
      {{#if schoolLogo}}<img src="{{schoolLogo}}" alt="Logo" />{{/if}}
      <h1>{{schoolName}}</h1>
    </div>
    
    <div class="profile-section">
      <div class="photo-wrapper">
        <img src="{{profileImage}}" alt="Photo" />
      </div>
      <div class="name-block">
        <h2>{{firstName}}<br/>{{lastName}}</h2>
        <div class="role">{{#if className}}STUDENT{{else}}STAFF{{/if}}</div>
      </div>
    </div>

    <div class="glass-panel">
      <div class="details-grid">
        {{#if className}}
        <div class="detail-box">
          <span class="d-label">Class & Sec</span>
          <span class="d-value">{{className}} - {{section}}</span>
        </div>
        <div class="detail-box">
          <span class="d-label">Date of Birth</span>
          <span class="d-value">{{dob}}</span>
        </div>
        {{else}}
        <div class="detail-box">
          <span class="d-label">Department</span>
          <span class="d-value">{{department}}</span>
        </div>
        {{/if}}
        <div class="detail-box">
          <span class="d-label">Blood Group</span>
          <span class="d-value">{{bloodGroup}}</span>
        </div>
        <div class="detail-box">
          <span class="d-label">Contact</span>
          <span class="d-value">{{phone}}</span>
        </div>
      </div>
    </div>

    <div class="bottom-row">
      <div class="id-box">
        <span>Identification No.</span>
        <strong>{{#if rollNo}}{{rollNo}}{{else}}{{employeeId}}{{/if}}</strong>
      </div>
    </div>
  </div>
</div>

<!-- BACK -->
<div class="card-page">
  <div class="glow-circle-1" style="left: -50px; right: auto;"></div>
  <div class="back-content">
    <div class="qr-wrapper">
      {{#if qrCode}}<img src="{{qrCode}}" alt="QR" />{{/if}}
    </div>
    
    <div class="rules">
      <h3>Authorization</h3>
      <p>This identification card is officially issued by {{schoolName}}.</p>
      <p>It remains the property of the issuing institution and must be surrendered upon request or termination of association.</p>
      <p class="highlight">If found, please return to the school administration office immediately.</p>
    </div>

    <div class="back-footer">
      <p>Registered Address</p>
      <strong>{{schoolAddress}}</strong>
    </div>
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
    'Corporate Red Badge',
    'ID_CARD_STUDENT',
    TEMPLATE_CORPORATE_RED,
    { width: 340, height: 520, orientation: 'portrait', margin: 0 },
    true
  ]);

  await ds.query(`
    INSERT INTO school_document_templates (name, type, html_content, dimensions, is_active)
    VALUES ($1, $2, $3, $4, $5)
  `, [
    'Elite Dark Mode',
    'ID_CARD_STUDENT',
    TEMPLATE_ELITE_DARK,
    { width: 340, height: 520, orientation: 'portrait', margin: 0 },
    true
  ]);
  
  console.log('Successfully added Corporate Red and Elite Dark templates!');
  await ds.destroy();
}

run().catch(console.error);
