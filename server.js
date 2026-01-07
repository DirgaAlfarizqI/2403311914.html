const express = require('express');
const path = require('path');
const session = require('express-session');
const { promisePool, testConnection, initDB } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());

// Session middleware
app.use(session({
  secret: 'belajarjs-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true
  }
}));

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// Middleware untuk cek apakah user sudah login
const requireLogin = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/');
  }
  next();
};

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { username, password, fullName } = req.body || {};

  if (!username || !password) {
    return res.status(200).json({ success: false, message: 'Username dan password wajib diisi.' });
  }

  try {
    const [rows] = await promisePool.execute(
      'SELECT * FROM users WHERE username = ? AND password = ?',
      [username, password]
    );

    if (rows.length > 0) {
      const user = rows[0];
      req.session.user = {
        id: user.id,
        username: user.username,
        fullName: fullName || user.username
      };
      return res.status(200).json({
        success: true,
        message: `Login berhasil! Selamat datang, ${user.username}`,
        redirect: '/dashboard'
      });
    } else {
      return res.status(200).json({ success: false, message: 'Login gagal. Username atau password salah.' });
    }
  } catch (error) {
    console.error('Database error:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// Endpoint logout
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ success: false, message: 'Gagal logout' });
    res.json({ success: true, message: 'Logout berhasil' });
  });
});

// Endpoint cek session
app.get('/api/check-session', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

// Pages Routes (Protected)
app.get('/dashboard', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/user-management', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'user-management.html'));
});

app.get('/pengunjung', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pengunjung.html'));
});

// ===== API USERS =====
app.get('/api/users', requireLogin, async (req, res) => {
  try {
    const [rows] = await promisePool.execute('SELECT * FROM users ORDER BY id DESC');
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengambil data user' });
  }
});

// GET Single User
app.get('/api/users/:id', requireLogin, async (req, res) => {
  try {
    const [rows] = await promisePool.execute('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (rows.length > 0) {
      res.json({ success: true, data: rows[0] });
    } else {
      res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengambil data user' });
  }
});

app.post('/api/users', requireLogin, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Data tidak lengkap' });

  try {
    const [existing] = await promisePool.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) return res.status(400).json({ success: false, message: 'Username sudah ada' });

    const [result] = await promisePool.execute('INSERT INTO users (username, password) VALUES (?, ?)', [username, password]);
    res.json({ success: true, message: 'User created' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal create user' });
  }
});

// PUT - Update user
app.put('/api/users/:id', requireLogin, async (req, res) => {
  const { username, password } = req.body;
  const userId = parseInt(req.params.id);

  if (!username) {
    return res.status(400).json({ success: false, message: 'Username wajib diisi' });
  }

  try {
    // Cek apakah username sudah digunakan oleh user lain
    const [existing] = await promisePool.execute(
      'SELECT id FROM users WHERE username = ? AND id != ?',
      [username, userId]
    );

    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Username sudah digunakan oleh user lain' });
    }

    // Update dengan atau tanpa password
    let query, params;
    if (password && password.trim() !== '') {
      query = 'UPDATE users SET username = ?, password = ? WHERE id = ?';
      params = [username, password, userId];
    } else {
      query = 'UPDATE users SET username = ? WHERE id = ?';
      params = [username, userId];
    }

    const [result] = await promisePool.execute(query, params);

    if (result.affectedRows > 0) {
      res.json({ success: true, message: 'User berhasil diupdate' });
    } else {
      const [check] = await promisePool.execute('SELECT id FROM users WHERE id = ?', [userId]);
      if (check.length > 0) {
        res.json({ success: true, message: 'Data user tidak berubah (sama dengan sebelumnya)' });
      } else {
        res.status(404).json({ success: false, message: 'User tidak ditemukan' });
      }
    }
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ success: false, message: 'Gagal mengupdate user: ' + error.message });
  }
});

// DELETE - Hapus user
app.delete('/api/users/:id', requireLogin, async (req, res) => {
  const userId = req.params.id;
  const loggedInUserId = req.session.user ? req.session.user.id : null;

  console.log(`Attempting to delete user ID: ${userId} by user ID: ${loggedInUserId}`);

  // Cegah menghapus user yang sedang login
  if (loggedInUserId && loggedInUserId == userId) {
    return res.status(400).json({ success: false, message: 'Tidak dapat menghapus user yang sedang login (diri sendiri)' });
  }

  try {
    const [result] = await promisePool.execute('DELETE FROM users WHERE id = ?', [userId]);

    if (result.affectedRows > 0) {
      res.json({ success: true, message: 'User berhasil dihapus' });
    } else {
      res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    }
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ success: false, message: 'Gagal menghapus user: ' + error.message });
  }
});

// ===== API PENGUNJUNG (VISITORS) =====
// GET All Pengunjung
app.get('/api/pengunjung', requireLogin, async (req, res) => {
  try {
    // Join dengan tabel users untuk mengambil nama petugas yang menginput
    const query = `
      SELECT p.*, u.username as petugas 
      FROM pengunjung p 
      LEFT JOIN users u ON p.user_id = u.id 
      ORDER BY p.id DESC
    `;
    const [rows] = await promisePool.execute(query);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Gagal load pengunjung' });
  }
});

// POST New Pengunjung
app.post('/api/pengunjung', requireLogin, async (req, res) => {
  const { nama, alamat, no_hp } = req.body;
  const userId = req.session.user.id; // Ambil ID user dari session

  if (!nama) {
    return res.status(400).json({ success: false, message: 'Nama wajib diisi' });
  }

  try {
    const [result] = await promisePool.execute(
      'INSERT INTO pengunjung (nama, alamat, no_hp, user_id) VALUES (?, ?, ?, ?)',
      [nama, alamat || '', no_hp || '', userId]
    );
    res.json({ success: true, message: 'Pengunjung berhasil ditambahkan', data: { id: result.insertId } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Gagal menambah pengunjung' });
  }
});

// ===== API KUNJUNGAN (VISITS) =====
// GET All Kunjungan
app.get('/api/kunjungan', requireLogin, async (req, res) => {
  try {
    const query = `
      SELECT k.*, p.nama as nama_pengunjung, u.username as nama_petugas 
      FROM kunjungan k 
      JOIN pengunjung p ON k.pengunjung_id = p.id 
      JOIN users u ON k.user_id = u.id 
      ORDER BY k.waktu_datang DESC
    `;
    const [rows] = await promisePool.execute(query);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Gagal load data kunjungan' });
  }
});

// POST New Kunjungan
app.post('/api/kunjungan', requireLogin, async (req, res) => {
  const { pengunjung_id, keperluan } = req.body;
  const userId = req.session.user.id;

  if (!pengunjung_id || !keperluan) {
    return res.status(400).json({ success: false, message: 'Pengunjung dan Keperluan wajib diisi' });
  }

  try {
    const [result] = await promisePool.execute(
      'INSERT INTO kunjungan (pengunjung_id, user_id, keperluan) VALUES (?, ?, ?)',
      [pengunjung_id, userId, keperluan]
    );
    res.json({ success: true, message: 'Data kunjungan berhasil dicatat' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Gagal mencatat kunjungan' });
  }
});

// DELETE Kunjungan & Pengunjung Terkait
app.delete('/api/kunjungan/:id', requireLogin, async (req, res) => {
  try {
    // 1. Cari dulu pengunjung_id dari data kunjungan ini
    const [rows] = await promisePool.execute('SELECT pengunjung_id FROM kunjungan WHERE id = ?', [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Data kunjungan tidak ditemukan' });
    }

    const pengunjungId = rows[0].pengunjung_id;

    // 2. Hapus Data Pengunjung (Otomatis menghapus data kunjungan ini + kunjungan lain milik dia karena CASCADE)
    const [result] = await promisePool.execute('DELETE FROM pengunjung WHERE id = ?', [pengunjungId]);

    if (result.affectedRows > 0) {
      res.json({ success: true, message: 'Data Pengunjung beserta Kunjungannya berhasil dihapus' });
    } else {
      res.status(404).json({ success: false, message: 'Gagal menghapus data pengunjung' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Gagal menghapus data: ' + error.message });
  }
});

// DELETE Pengunjung
app.delete('/api/pengunjung/:id', requireLogin, async (req, res) => {
  try {
    const [result] = await promisePool.execute('DELETE FROM pengunjung WHERE id = ?', [req.params.id]);
    if (result.affectedRows > 0) {
      res.json({ success: true, message: 'Data pengunjung berhasil dihapus' });
    } else {
      res.status(404).json({ success: false, message: 'Data pengunjung tidak ditemukan' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Gagal menghapus data pengunjung (mungkin masih ada data kunjungan terkait)' });
  }
});

// Fallback route
app.get('/kunjungan', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'kunjungan.html'));
});

// Fallback to index.html for root
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
  await testConnection();
  await initDB(); // Init database tables
});
