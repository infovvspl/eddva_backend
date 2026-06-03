const fs = require('fs');
const PDFDocument = require('pdfkit');

// Generate test PDF
const doc = new PDFDocument();
doc.pipe(fs.createWriteStream('test_input.pdf'));
doc.fontSize(24).text('Chapter 1: The Solar System');
doc.fontSize(14).text('\n1. Introduction');
doc.fontSize(12).text('\nThe Solar System consists of the Sun and the objects that orbit it, including eight major planets, dwarf planets, moons, asteroids, and comets. It formed around 4.6 billion years ago from the gravitational collapse of a giant interstellar molecular cloud.');
doc.fontSize(14).text('\n2. The Sun');
doc.fontSize(12).text('\nThe Sun is a G-type main-sequence star that comprises 99.86% of the mass of the Solar System. It generates energy through nuclear fusion of hydrogen into helium in its core.');
doc.end();

console.log('PDF generated: test_input.pdf');

setTimeout(async () => {
    try {
        const formData = new FormData();
        const fileBlob = new Blob([fs.readFileSync('test_input.pdf')], { type: 'application/pdf' });
        formData.append('pdf', fileBlob, 'test_input.pdf');
        formData.append('classLevel', '6');
        formData.append('subject', 'Science');
        formData.append('board', 'CBSE');

        console.log('Sending request to http://localhost:3000/api/v1/school/creator-studio/ppt/generate-from-pdf ...');
        const response = await fetch('http://localhost:3000/api/v1/school/creator-studio/ppt/generate-from-pdf', {
            method: 'POST',
            body: formData,
        });

        console.log(`Response status: ${response.status}`);
        
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errText}`);
        }

        const buffer = await response.arrayBuffer();
        fs.writeFileSync('test_output.pptx', Buffer.from(buffer));
        console.log('Success! Saved to test_output.pptx');
    } catch (err) {
        console.error('Test failed:', err);
    }
}, 1000);
