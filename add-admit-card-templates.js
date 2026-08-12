const { DataSource } = require('typeorm');
const dotenv = require('dotenv');

dotenv.config();

const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

const admitCardTemplate1 = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
  
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; background: #f1f5f9; display: flex; flex-direction: column; align-items: center; gap: 20px; font-family: 'Inter', sans-serif; }
  
  .admit-card {
    width: 210mm;
    background: #ffffff;
    box-shadow: 0 10px 25px rgba(0,0,0,0.05);
    border-radius: 12px;
    padding: 30px;
    position: relative;
    overflow: hidden;
    color: #1e293b;
    page-break-after: always;
  }
  
  .admit-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; height: 12px;
    background: linear-gradient(90deg, #3b82f6, #8b5cf6);
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 20px;
    margin-bottom: 25px;
  }

  .school-info {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .school-info img {
    height: 70px;
    width: 70px;
    object-fit: contain;
    border-radius: 8px;
  }
  .school-details h1 {
    margin: 0 0 5px 0;
    font-size: 24px;
    color: #0f172a;
  }
  .school-details p {
    margin: 0;
    color: #64748b;
    font-size: 13px;
  }
  
  .exam-title-box {
    text-align: right;
  }
  .exam-title-box h2 {
    margin: 0;
    font-size: 20px;
    color: #3b82f6;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .exam-title-box p {
    margin: 5px 0 0 0;
    font-size: 14px;
    font-weight: 600;
    color: #475569;
  }

  .student-section {
    display: flex;
    gap: 30px;
    margin-bottom: 30px;
  }
  
  .student-photo {
    width: 120px;
    height: 140px;
    border: 2px solid #e2e8f0;
    border-radius: 8px;
    padding: 4px;
  }
  .student-photo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 4px;
  }

  .student-details {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px;
  }
  .detail-group {
    background: #f8fafc;
    padding: 12px 15px;
    border-radius: 8px;
    border: 1px solid #f1f5f9;
  }
  .detail-group label {
    display: block;
    font-size: 11px;
    color: #64748b;
    text-transform: uppercase;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .detail-group span {
    display: block;
    font-size: 15px;
    font-weight: 700;
    color: #1e293b;
  }
  .detail-group.full-width {
    grid-column: span 2;
  }

  .timetable-section h3 {
    margin: 0 0 15px 0;
    font-size: 18px;
    color: #0f172a;
  }
  
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 30px;
  }
  th, td {
    padding: 12px 15px;
    text-align: left;
    border-bottom: 1px solid #e2e8f0;
  }
  th {
    background: #f8fafc;
    font-size: 13px;
    color: #475569;
    font-weight: 600;
    text-transform: uppercase;
  }
  td {
    font-size: 14px;
    font-weight: 500;
  }

  .footer {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-top: 40px;
  }
  .signature-box {
    text-align: center;
  }
  .signature-line {
    width: 180px;
    height: 1px;
    background: #94a3b8;
    margin-bottom: 8px;
  }
  .signature-box p {
    margin: 0;
    font-size: 12px;
    color: #64748b;
  }
  .qr-code {
    width: 80px;
    height: 80px;
  }

  .instructions {
    margin-top: 30px;
    padding-top: 20px;
    border-top: 1px dashed #cbd5e1;
    font-size: 11px;
    color: #64748b;
  }
  .instructions h4 { margin: 0 0 10px 0; color: #475569; font-size: 12px; }
  .instructions ul { margin: 0; padding-left: 20px; }
  .instructions li { margin-bottom: 5px; }
</style>

{{#each this}}
<div class="admit-card">
  <div class="header">
    <div class="school-info">
      {{#if schoolLogo}}
        <img src="{{schoolLogo}}" alt="Logo" />
      {{/if}}
      <div class="school-details">
        <h1>{{schoolName}}</h1>
        <p>{{schoolAddress}}</p>
      </div>
    </div>
    <div class="exam-title-box">
      <h2>ADMIT CARD</h2>
      <p>{{examName}}</p>
    </div>
  </div>

  <div class="student-section">
    <div class="student-photo">
      <img src="{{profileImage}}" alt="Student" />
    </div>
    <div class="student-details">
      <div class="detail-group">
        <label>Student Name</label>
        <span>{{fullName}}</span>
      </div>
      <div class="detail-group">
        <label>Roll Number / ID</label>
        <span>{{rollNo}}</span>
      </div>
      <div class="detail-group">
        <label>Class & Section</label>
        <span>{{className}} - {{section}}</span>
      </div>
      <div class="detail-group">
        <label>Father's Name</label>
        <span>{{fatherName}}</span>
      </div>
      <div class="detail-group full-width">
        <label>Examination Center</label>
        <span>{{center}}</span>
      </div>
    </div>
  </div>

  <div class="timetable-section">
    <h3>Examination Timetable</h3>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Subject</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        {{#each timetable}}
        <tr>
          <td>{{this.date}}</td>
          <td><strong>{{this.subject}}</strong></td>
          <td>{{this.time}}</td>
        </tr>
        {{/each}}
      </tbody>
    </table>
  </div>

  <div class="footer">
    <img src="{{qrCode}}" class="qr-code" alt="QR" />
    <div class="signature-box">
      <div class="signature-line"></div>
      <p>Controller of Examinations</p>
    </div>
    <div class="signature-box">
      <div class="signature-line"></div>
      <p>Principal's Signature</p>
    </div>
  </div>

  <div class="instructions">
    <h4>Important Instructions to Candidates</h4>
    <ul>
      <li>Candidates must bring this Admit Card to the examination hall. Entry without Admit Card is strictly prohibited.</li>
      <li>Please report to the examination center at least 30 minutes before the scheduled time.</li>
      <li>Electronic devices, including mobile phones and smartwatches, are not allowed inside the hall.</li>
      <li>Carry your own stationery. Borrowing items inside the examination hall is not permitted.</li>
    </ul>
  </div>
</div>
{{/each}}
`;

const admitCardTemplate2 = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;700&display=swap');
  
  * { box-sizing: border-box; font-family: 'Outfit', sans-serif; }
  body { margin: 0; background: #e2e8f0; display: flex; flex-direction: column; align-items: center; gap: 20px; }
  
  .ac-wrapper {
    width: 210mm;
    background: #fff;
    border: 1px solid #cbd5e1;
    padding: 40px;
    color: #1e293b;
    position: relative;
    page-break-after: always;
  }
  
  .ac-watermark {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%) rotate(-30deg);
    font-size: 120px;
    font-weight: 900;
    color: rgba(148, 163, 184, 0.08);
    pointer-events: none;
    z-index: 0;
    white-space: nowrap;
  }

  .ac-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: relative;
    z-index: 1;
    border-bottom: 3px solid #1e293b;
    padding-bottom: 20px;
    margin-bottom: 30px;
  }
  .ac-logo { height: 80px; width: 80px; object-fit: contain; }
  
  .ac-school { text-align: center; flex: 1; padding: 0 20px; }
  .ac-school h1 { margin: 0 0 5px 0; font-size: 28px; font-weight: 700; color: #0f172a; text-transform: uppercase; }
  .ac-school p { margin: 0; font-size: 14px; color: #475569; }
  
  .ac-type { width: 80px; text-align: right; font-weight: 700; color: #ef4444; font-size: 18px; text-transform: uppercase; }

  .ac-exam-title {
    text-align: center;
    margin-bottom: 30px;
    position: relative;
    z-index: 1;
  }
  .ac-exam-title h2 { margin: 0; font-size: 22px; color: #1e293b; background: #f1f5f9; display: inline-block; padding: 8px 30px; border-radius: 4px; border: 1px solid #cbd5e1; }

  .ac-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 30px;
    margin-bottom: 40px;
    position: relative;
    z-index: 1;
  }
  
  .ac-pic {
    width: 130px; height: 160px;
    border: 3px solid #1e293b;
    padding: 2px;
  }
  .ac-pic img { width: 100%; height: 100%; object-fit: cover; }
  
  .ac-info-table {
    width: 100%;
    border-collapse: collapse;
  }
  .ac-info-table td {
    padding: 10px;
    border: 1px solid #e2e8f0;
    font-size: 15px;
  }
  .ac-info-table .lbl {
    font-weight: 600;
    color: #475569;
    width: 35%;
    background: #f8fafc;
  }
  .ac-info-table .val {
    font-weight: 700;
    color: #0f172a;
  }

  .ac-schedule {
    position: relative;
    z-index: 1;
  }
  .ac-schedule h3 {
    margin: 0 0 15px 0;
    font-size: 18px;
    color: #1e293b;
    border-left: 4px solid #1e293b;
    padding-left: 10px;
  }
  .ac-table {
    width: 100%;
    border-collapse: collapse;
  }
  .ac-table th, .ac-table td {
    border: 1px solid #cbd5e1;
    padding: 12px;
    text-align: left;
  }
  .ac-table th { background: #1e293b; color: #fff; font-weight: 500; font-size: 14px; text-transform: uppercase; }
  .ac-table td { font-size: 15px; color: #0f172a; font-weight: 500; }

  .ac-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 50px;
    position: relative;
    z-index: 1;
  }
  .ac-sign { text-align: center; }
  .ac-sign div { width: 200px; border-bottom: 2px solid #1e293b; height: 40px; margin-bottom: 10px; }
  .ac-sign p { margin: 0; font-size: 13px; font-weight: 600; text-transform: uppercase; color: #475569; }
</style>

{{#each this}}
<div class="ac-wrapper">
  <div class="ac-watermark">{{schoolName}}</div>
  
  <div class="ac-header">
    {{#if schoolLogo}}
      <img src="{{schoolLogo}}" class="ac-logo" />
    {{else}}
      <div style="width:80px"></div>
    {{/if}}
    
    <div class="ac-school">
      <h1>{{schoolName}}</h1>
      <p>{{schoolAddress}}</p>
    </div>
    
    <div class="ac-type">
      ADMIT CARD
    </div>
  </div>
  
  <div class="ac-exam-title">
    <h2>{{examName}}</h2>
  </div>

  <div class="ac-grid">
    <div class="ac-pic">
      <img src="{{profileImage}}" />
    </div>
    <table class="ac-info-table">
      <tr>
        <td class="lbl">Candidate Name</td>
        <td class="val">{{fullName}}</td>
      </tr>
      <tr>
        <td class="lbl">Roll Number</td>
        <td class="val">{{rollNo}}</td>
      </tr>
      <tr>
        <td class="lbl">Class & Section</td>
        <td class="val">{{className}} - {{section}}</td>
      </tr>
      <tr>
        <td class="lbl">Date of Birth</td>
        <td class="val">{{dob}}</td>
      </tr>
      <tr>
        <td class="lbl">Exam Center</td>
        <td class="val">{{center}}</td>
      </tr>
    </table>
  </div>

  <div class="ac-schedule">
    <h3>Exam Timetable</h3>
    <table class="ac-table">
      <thead>
        <tr>
          <th>Subject</th>
          <th>Date</th>
          <th>Timing</th>
        </tr>
      </thead>
      <tbody>
        {{#each timetable}}
        <tr>
          <td>{{this.subject}}</td>
          <td>{{this.date}}</td>
          <td>{{this.time}}</td>
        </tr>
        {{/each}}
      </tbody>
    </table>
  </div>

  <div class="ac-footer">
    <div class="ac-sign">
      <div></div>
      <p>Student Signature</p>
    </div>
    <img src="{{qrCode}}" style="width: 80px; height: 80px;" />
    <div class="ac-sign">
      <div></div>
      <p>Principal Signature</p>
    </div>
  </div>
</div>
{{/each}}
`;

async function run() {
  await ds.initialize();
  
  await ds.query(`
    INSERT INTO school_document_templates (id, name, type, html_content, dimensions, is_active, created_at, updated_at) 
    VALUES 
    (gen_random_uuid(), 'Modern Admit Card (A4)', 'ADMIT_CARD', $1, '{"width":210, "height":297}', true, NOW(), NOW()),
    (gen_random_uuid(), 'Standard Admit Card (A4)', 'ADMIT_CARD', $2, '{"width":210, "height":297}', true, NOW(), NOW())
  `, [admitCardTemplate1, admitCardTemplate2]);

  console.log('Admit Card Templates added!');
  await ds.destroy();
}

run().catch(console.error);
