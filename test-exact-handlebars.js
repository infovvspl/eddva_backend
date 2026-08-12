require('dotenv').config();
const { DataSource } = require('typeorm');
const Handlebars = require('handlebars');

const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false },
});

ds.initialize().then(async () => {
  const res = await ds.query("SELECT html_content FROM school_document_templates WHERE id = '46c7230d-2872-437f-abd7-a5c32cd1d92d'");
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
    
    const result = template({ items: dataList });
    console.log('HTML Output Length:', result.length);
    console.log(result.substring(0, 500) + '...');
    
    require('fs').writeFileSync('test-output.html', result);
    console.log('Wrote output to test-output.html');
  } else {
    console.log('Template not found');
  }
  ds.destroy();
}).catch(console.error);
