const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// 1) Layani file statis dari folder "public"
app.use(express.static(path.join(__dirname, 'public')));

// 2) Parsing JSON body
app.use(express.json());

// 3) Redirect root "/" ke "/insert.html"
app.get('/', (req, res) => {
  res.redirect('/insert.html');
});

// 4) Peta nama bulan ke file DB
const monthMap = {
  January: 'JanDonation.db',
  February: 'FebDonation.db',
  March: 'MarDonation.db',
  April: 'AprDonation.db',
  May: 'MayDonation.db',
  June: 'JunDonation.db',
  July: 'JulDonation.db',
  August: 'AugDonation.db',
  September: 'SepDonation.db',
  October: 'OctDonation.db',
  November: 'NovDonation.db',
  December: 'DecDonation.db'
};

// Helper: buka DB bulanan
function openMonthlyDB(monthName, callback) {
  const dbFile = monthMap[monthName];
  if (!dbFile) {
    return callback(new Error(`Bulan tidak valid: ${monthName}`));
  }
  const db = new sqlite3.Database(dbFile, (err) => {
    if (err) return callback(err);
    db.run(`
      CREATE TABLE IF NOT EXISTS records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        priest TEXT,
        peopleCount INTEGER,
        donation INTEGER,
        date TEXT
      )
    `, (err) => {
      callback(err, db);
    });
  });
}

// Helper: buka DB tahunan (misal "2025Don.db")
function openYearlyDB(year, callback) {
  const dbFile = `${year}Don.db`;
  const db = new sqlite3.Database(dbFile, (err) => {
    if (err) return callback(err);
    db.run(`
      CREATE TABLE IF NOT EXISTS records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        priest TEXT,
        peopleCount INTEGER,
        donation INTEGER,
        date TEXT
      )
    `, (err) => {
      callback(err, dbFile, db);
    });
  });
}

// --------------------
// A) POST /records/:month -> Insert ke DB bulanan
// --------------------
app.post('/records/:month', (req, res) => {
  const { month } = req.params;
  const { priest, peopleCount, donation, date } = req.body;

  openMonthlyDB(month, (err, db) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    const sql = `INSERT INTO records (priest, peopleCount, donation, date)
                 VALUES (?, ?, ?, ?)`;
    db.run(sql, [priest, peopleCount, donation, date], function (err) {
      if (err) {
        db.close();
        return res.status(500).json({ error: err.message });
      }
      const newId = this.lastID;
      db.close();
      return res.status(201).json({
        id: newId,
        priest,
        peopleCount,
        donation,
        date,
        month
      });
    });
  });
});

// --------------------
// B) GET /records/:month -> Data bulanan + total donasi
// --------------------
app.get('/records/:month', (req, res) => {
  const { month } = req.params;
  openMonthlyDB(month, (err, db) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    const sqlAll = `SELECT * FROM records`;
    db.all(sqlAll, [], (err, rows) => {
      if (err) {
        db.close();
        return res.status(500).json({ error: err.message });
      }
      let totalDonation = 0;
      rows.forEach(r => {
        totalDonation += (r.donation || 0);
      });
      db.close();
      res.json({ data: rows, totalDonation });
    });
  });
});

// --------------------
// C) GET /records-year/:year -> Gabung data 12 bulan ke DB tahunan + total
// --------------------
app.get('/records-year/:year', (req, res) => {
  const { year } = req.params;

  function readMonthlyData(monthName) {
    return new Promise((resolve) => {
      openMonthlyDB(monthName, (err, db) => {
        if (err) {
          // DB bulan belum ada -> data kosong
          return resolve([]);
        }
        db.all(`SELECT * FROM records`, [], (err, rows) => {
          db.close();
          if (err) {
            // Error -> anggap data kosong
            return resolve([]);
          }
          resolve(rows);
        });
      });
    });
  }

  function insertIntoYearDB(db, record) {
    return new Promise((resolve, reject) => {
      const sql = `INSERT INTO records (priest, peopleCount, donation, date)
                   VALUES (?, ?, ?, ?)`;
      db.run(sql, [record.priest, record.peopleCount, record.donation, record.date], function (err) {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  const allMonths = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];

  Promise.all(allMonths.map(m => readMonthlyData(m)))
    .then(results => {
      // Gabung data dari 12 bulan
      const combinedData = [].concat(...results);

      openYearlyDB(year, async (err, dbFile, db) => {
        if (err) {
          return res.status(400).json({ error: err.message });
        }
        try {
          // (Opsional) hapus data lama di DB tahunan:
          // await new Promise((resolve, reject) => {
          //   db.run(`DELETE FROM records`, (err) => {
          //     if (err) return reject(err);
          //     resolve();
          //   });
          // });

          // Insert satu per satu (bisa double kalau dipanggil lagi)
          for (let record of combinedData) {
            await insertIntoYearDB(db, record);
          }

          // Ambil semua data di DB tahunan
          db.all(`SELECT * FROM records`, [], (err, rows) => {
            if (err) {
              db.close();
              return res.status(500).json({ error: err.message });
            }
            let totalDonation = 0;
            rows.forEach(r => {
              totalDonation += (r.donation || 0);
            });
            db.close();
            res.json({ data: rows, totalDonation });
          });
        } catch (err2) {
          db.close();
          return res.status(500).json({ error: err2.message });
        }
      });
    })
    .catch(e => {
      res.status(500).json({ error: e.message });
    });
});

// Jalankan server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
