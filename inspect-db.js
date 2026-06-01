const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { getDataSourceToken } = require('@nestjs/typeorm');

async function inspectDb() {
  try {
    const app = await NestFactory.createApplicationContext(AppModule);
    const ds = app.get(getDataSourceToken('school'));
    const assignmentsRows = await ds.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'assignments'");
    const classesRows = await ds.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'classes'");
    console.log('ASSIGNMENTS_COLUMNS');
    console.log(JSON.stringify(assignmentsRows));
    console.log('CLASSES_COLUMNS');
    console.log(JSON.stringify(classesRows));
    await app.close();
  } catch (err) {
    console.error('Error during DB inspection:', err);
  }
}

inspectDb();
