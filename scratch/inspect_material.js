const sqlite3 = require('sqlite3').verbose();
const path = require('path');

function searchDb(dbPath) {
  console.log(`Searching database: ${dbPath}`);
  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
      console.error(`Error opening database ${dbPath}:`, err.message);
      return;
    }
  });

  db.serialize(() => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
      if (err) {
        console.error(err);
        return;
      }
      // Look for materials or resources table
      tables.forEach(table => {
        const tableName = table.name;
        db.all(`PRAGMA table_info(${tableName})`, [], (err, columns) => {
          if (err) return;
          const textCols = columns
            .filter(c => ['TEXT', 'VARCHAR'].includes(c.type.toUpperCase()) || c.name.toLowerCase().includes('desc') || c.name.toLowerCase().includes('content'))
            .map(c => c.name);
          if (textCols.length === 0) return;

          textCols.forEach(col => {
            db.all(`SELECT * FROM ${tableName} WHERE "${col}" LIKE '%quotient rule%'`, [], (err, rows) => {
              if (err) return;
              if (rows.length > 0) {
                console.log(`Found matching rows in Table [${tableName}] Col [${col}]:`);
                rows.forEach(r => {
                  console.log(JSON.stringify(r, null, 2));
                });
              }
            });
          });
        });
      });
    });
  });
}

searchDb(path.join(__dirname, '../db.sqlite'));
searchDb(path.join(__dirname, '../database.sqlite'));
searchDb(path.join(__dirname, '../../eddva_ai_service/db.sqlite3'));
