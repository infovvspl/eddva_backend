const axios = require('axios');
(async () => {
  try {
    const res = await axios.get('http://localhost:3000/school/institute-admin/document/template/ADMIT_CARD');
    console.log(res.data.data.map(t => ({ id: t.id, name: t.name, type: t.type })));
  } catch(e) {
    console.error(e.response?.data || e.message);
  }
})();
