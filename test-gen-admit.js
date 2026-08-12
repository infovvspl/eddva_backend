const { DataSource } = require('typeorm');
require('dotenv').config();
const puppeteer = require('puppeteer');
const Handlebars = require('handlebars');

async function run() {
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.SCHOOL_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await ds.initialize();
  
  // Get Admit Card template
  const t = await ds.query("SELECT id, html_content FROM school_document_templates WHERE type = 'ADMIT_CARD' AND name = 'Modern Admit Card (A4)' LIMIT 1");
  const templateHtml = t[0].html_content;
  
  const template = Handlebars.compile(templateHtml);
  
  const dataList = [{
    fullName: '', // Simulate empty user name
    rollNo: 'N/A',
    className: 'Class 10',
    section: 'A',
    fatherName: 'N/A',
    center: 'Hall A',
    examName: 'Mid Term',
    schoolLogo: '',
    schoolName: 'Apexiq',
    schoolAddress: '123 St',
    profileImage: 'https://ui-avatars.com/api/?name=Student&background=f1f5f9&color=64748b&size=256',
    qrCode: 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=test',
    timetable: [] // Simulate empty timetable
  }];

  let html;
  if (templateHtml.includes('{{#each items}}') || templateHtml.includes('{{#each this.items}}')) {
    html = template({ items: dataList });
  } else if (templateHtml.includes('{{#each this}}')) {
    html = template(dataList);
  } else {
    html = template(dataList[0]);
  }

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdfBuffer = await page.pdf({
    width: '210mm',
    height: '297mm',
    printBackground: true,
  });
  
  const fs = require('fs');
  fs.writeFileSync('test-admit.pdf', pdfBuffer);
  console.log("Saved test-admit.pdf");

  await browser.close();
  await ds.destroy();
}

run().catch(console.error);
