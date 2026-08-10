async function test() {
  try {
    const res = await fetch('http://localhost:8080/api/v1/school/institute-admin/document/template/ID_CARD_STUDENT');
    const text = await res.text();
    console.log(res.status);
    console.log(text);
  } catch (err) {
    console.error(err);
  }
}
test();
