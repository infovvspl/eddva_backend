require('dotenv').config();
const { DataSource } = require('typeorm');
const Handlebars = require('handlebars');
const puppeteer = require('puppeteer');

const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false },
});

ds.initialize().then(async () => {
  const res = await ds.query("SELECT html_content, dimensions FROM school_document_templates WHERE id = '46c7230d-2872-437f-abd7-a5c32cd1d92d'");
  if (res.length > 0) {
    const templateHtml = res[0].html_content;
    const template = Handlebars.compile(templateHtml);
    
    // Simulate data from service
    const dataList = [{
      firstName: 'John',
      lastName: 'Doe',
      fullName: 'John Doe',
      rollNo: 'N/A',
      section: 'A',
      className: 'Class 1',
      dob: 'N/A',
      bloodGroup: 'O+',
      fatherName: 'N/A',
      motherName: 'N/A',
      parentName: 'N/A',
      parentPhone: 'N/A',
      phone: 'N/A',
      address: '123 Main St',
      profileImage: '',
      schoolLogo: '',
      schoolName: 'Mock School',
      schoolAddress: '123 Main St',
      qrCode: '',
    }];
    
    const html = template({ items: dataList });
    
    const dimensions = res[0].dimensions;
    const pdfOptions = { printBackground: true };
    if (dimensions && dimensions.width && dimensions.height) {
        pdfOptions.width = `${dimensions.width}mm`;
        pdfOptions.height = `${dimensions.height}mm`;
    } else {
        pdfOptions.format = 'A4';
    }

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const pdfBuffer = await page.pdf(pdfOptions);
    await browser.close();

    require('fs').writeFileSync('test.pdf', pdfBuffer);
    console.log('Generated test.pdf (' + pdfBuffer.length + ' bytes)');
    console.log('Options:', pdfOptions);
  } else {
    console.log('Template not found');
  }
  ds.destroy();
}).catch(console.error);
