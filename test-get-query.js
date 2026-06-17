const { DataSource } = require('typeorm');

async function testApiOutput() {
  const ds = new DataSource({
    type: 'postgres',
    url: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  
  await ds.initialize();
  
  const id = 'a89219b6-7a09-469b-bc4a-507b690689fa'; // material_id
  const userId = '3d0eabde-0695-4935-9dd9-da21ae1dced8'; // created_by
  
  const rows = await ds.query(
    `SELECT id, material_id AS "materialId", topic_id AS "topicId", created_by AS "createdBy", 
            page_number AS "pageNumber", selected_text AS "selectedText", rects, color, category, note,
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM school_material_highlights
     WHERE material_id = $1 AND created_by = $2
     ORDER BY page_number ASC, created_at ASC`,
    [id, userId]
  );
  
  console.log('GET API Output:', JSON.stringify(rows[0], null, 2));
  
  await ds.destroy();
}

testApiOutput().catch(console.error);
