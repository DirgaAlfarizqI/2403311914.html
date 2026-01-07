const mysql = require('mysql2');

// Konfigurasi database
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'belajardirga',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Buat connection pool
const pool = mysql.createPool(dbConfig);

// Promisify pool untuk async/await
const promisePool = pool.promise();

// Fungsi inisialisasi tabel
const initDB = async () => {
  try {
    const connection = await promisePool.getConnection();

    // 1. Pastikan tabel users ada dulu (karena pengunjung butuh foreign key ke sini)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Tabel Pengunjung (Master Data Tamu)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS pengunjung (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nama VARCHAR(100) NOT NULL,
        alamat TEXT,
        no_hp VARCHAR(20),
        user_id INT, 
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Cek apakah kolom user_id sudah ada (untuk migrasi)
    const [columns] = await connection.query("SHOW COLUMNS FROM pengunjung LIKE 'user_id'");
    if (columns.length === 0) {
      console.log('Adding user_id column to pengunjung table...');
      await connection.query(`
        ALTER TABLE pengunjung 
        ADD COLUMN user_id INT,
        ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      `);
    } else {
      // UPDATE CONSTRAINT: Jika tabel sudah ada, kita perlu pastikan constraint-nya CASCADE
      // Cari nama foreign key yang ada
      const [fks] = await connection.query(`
        SELECT CONSTRAINT_NAME 
        FROM information_schema.KEY_COLUMN_USAGE 
        WHERE TABLE_NAME = 'pengunjung' 
        AND COLUMN_NAME = 'user_id' 
        AND REFERENCED_TABLE_NAME = 'users'
        AND TABLE_SCHEMA = '${dbConfig.database}'
      `);

      if (fks.length > 0) {
        const fkName = fks[0].CONSTRAINT_NAME;
        // Kita tidak bisa dengan mudah cek apakah itu SET NULL atau CASCADE via query simple di semua versi MySql
        // Jadi kita drop dan recreate saja untuk memastikan
        console.log(`Updating Foreign Key ${fkName} to CASCADE...`);
        try {
          await connection.query(`ALTER TABLE pengunjung DROP FOREIGN KEY ${fkName}`);
          await connection.query(`
            ALTER TABLE pengunjung 
            ADD CONSTRAINT fk_pengunjung_users 
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          `);
        } catch (err) {
          console.log('Foreign key update skipped or failed (might already be correct):', err.message);
        }
      }
    }

    // 3. Tabel Kunjungan (Transaksi Kunjungan)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS kunjungan (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pengunjung_id INT NOT NULL,
        user_id INT NOT NULL,
        keperluan TEXT,
        waktu_datang TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (pengunjung_id) REFERENCES pengunjung(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    console.log('Database initialized: Tables verified/updated.');

    connection.release();
  } catch (error) {
    console.error('Database initialization failed:', error);
  }
};

// Test koneksi database
const testConnection = async () => {
  try {
    const connection = await promisePool.getConnection();
    console.log('Koneksi database berhasil!');
    connection.release();
    return true;
  } catch (error) {
    console.error('Koneksi database gagal:', error.message);
    console.error('Pastikan database "belajardirga" sudah dibuat di phpMyAdmin.');
    return false;
  }
};

module.exports = {
  pool,
  promisePool,
  testConnection,
  initDB
};