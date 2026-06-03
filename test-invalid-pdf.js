const fs = require('fs');

setTimeout(async () => {
    try {
        const formData = new FormData();
        const fileBlob = new Blob([Buffer.from("not a pdf")], { type: 'application/pdf' });
        formData.append('pdf', fileBlob, 'empty.pdf');

        console.log('Sending invalid PDF to http://localhost:3000/api/v1/school/creator-studio/ppt/generate-from-pdf ...');
        const response = await fetch('http://localhost:3000/api/v1/school/creator-studio/ppt/generate-from-pdf', {
            method: 'POST',
            body: formData,
        });

        console.log(`Response status: ${response.status}`);
        const text = await response.text();
        console.log(`Response body: ${text}`);

    } catch (err) {
        console.error('Test failed:', err);
    }
}, 500);
