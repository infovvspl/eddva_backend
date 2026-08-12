const Handlebars = require('handlebars');
const templateHtml = `
<style>
  .card-page { width: 100px; height: 100px; background: red; }
</style>
{{#each items}}
<div class="card-page">
  <div>{{fullName}}</div>
</div>
{{/each}}
`;

const dataList = [
  { fullName: 'Test 1' },
  { fullName: 'Test 2' },
];

const template = Handlebars.compile(templateHtml);
const result = template({ items: dataList });
console.log('--- HANDLEBARS OUTPUT ---');
console.log(result);
console.log('-------------------------');
