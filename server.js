// backend/server.js
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db'); // se estiver usando db.js

const app = express();
app.use(cors());
app.use(express.json());

// Servir os arquivos da pasta backend (admin.html, logos do admin etc.)
app.use(express.static(__dirname));

// Servir a pasta frontend na rota /app (por exemplo)
app.use('/app', express.static(path.join(__dirname, '..', 'frontend')));

// Rota raiz -> admin
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ===== CLIENTES BÁSICO (exemplo) =====

// Listar clientes
app.get('/api/customers', (req, res) => {
  const sql = `
    SELECT c.*,
      (SELECT COUNT(*) FROM pets p WHERE p.customer_id = c.id) AS pets_count
    FROM customers c
    ORDER BY c.name
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Erro ao listar customers:', err);
      return res.status(500).json({ error: 'Erro interno ao buscar clientes.' });
    }
    res.json({ customers: rows });
  });
});

// Lookup por telefone
app.post('/api/customers/lookup', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Telefone é obrigatório.' });

  db.get('SELECT * FROM customers WHERE phone = ?', [phone], (err, row) => {
    if (err) {
      console.error('Erro em lookup customers:', err);
      return res.status(500).json({ error: 'Erro interno ao buscar cliente.' });
    }
    if (!row) return res.json({ exists: false });
    res.json({ exists: true, customer: row });
  });
});

// Criar / atualizar por telefone
app.post('/api/customers', (req, res) => {
  const { phone, name } = req.body;
  if (!phone || !name) {
    return res.status(400).json({ error: 'Telefone e nome são obrigatórios.' });
  }

  db.get('SELECT * FROM customers WHERE phone = ?', [phone], (err, row) => {
    if (err) {
      console.error('Erro em customers SELECT:', err);
      return res.status(500).json({ error: 'Erro interno ao buscar cliente.' });
    }

    if (row) {
      db.run(
        'UPDATE customers SET name = ? WHERE id = ?',
        [name, row.id],
        function (err2) {
          if (err2) {
            console.error('Erro em customers UPDATE:', err2);
            return res.status(500).json({ error: 'Erro interno ao atualizar cliente.' });
          }
          return res.json({ customer: { ...row, name }, existed: true });
        }
      );
    } else {
      db.run(
        'INSERT INTO customers (phone, name) VALUES (?, ?)',
        [phone, name],
        function (err2) {
          if (err2) {
            console.error('Erro em customers INSERT:', err2);
            return res.status(500).json({ error: 'Erro interno ao salvar cliente.' });
          }
          db.get('SELECT * FROM customers WHERE id = ?', [this.lastID], (e3, novo) => {
            if (e3) {
              console.error('Erro em customers SELECT new:', e3);
              return res.status(500).json({ error: 'Erro interno ao buscar cliente criado.' });
            }
            res.json({ customer: novo, existed: false });
          });
        }
      );
    }
  });
});

// Excluir cliente
app.delete('/api/customers/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM customers WHERE id = ?', [id], function (err) {
    if (err) {
      console.error('Erro ao deletar cliente:', err);
      return res.status(500).json({ error: 'Erro interno ao excluir cliente.' });
    }
    res.json({ deleted: this.changes > 0 });
  });
});

// ===== PETS – AQUI CORRIGE O ERRO "Erro interno ao salvar pet." =====

// Listar pets (por customer_id)
app.get('/api/pets', (req, res) => {
  const { customer_id } = req.query;
  if (!customer_id) {
    return res.json({ pets: [] });
  }
  db.all(
    'SELECT * FROM pets WHERE customer_id = ? ORDER BY name',
    [customer_id],
    (err, rows) => {
      if (err) {
        console.error('Erro ao listar pets:', err);
        return res.status(500).json({ error: 'Erro interno ao buscar pets.' });
      }
      res.json({ pets: rows });
    }
  );
});

// Criar pet
app.post('/api/pets', (req, res) => {
  const { customer_id, name, breed, info } = req.body;

  if (!customer_id || !name) {
    return res.status(400).json({ error: 'Cliente e nome do pet são obrigatórios.' });
  }

  const createdAt = new Date().toISOString();

  db.run(
    'INSERT INTO pets (customer_id, name, breed, info, created_at) VALUES (?, ?, ?, ?, ?)',
    [customer_id, name, breed || null, info || null, createdAt],
    function (err) {
      if (err) {
        console.error('Erro ao inserir pet:', err);
        return res.status(500).json({ error: 'Erro interno ao salvar pet.' });
      }

      db.get('SELECT * FROM pets WHERE id = ?', [this.lastID], (e2, pet) => {
        if (e2) {
          console.error('Erro ao buscar pet criado:', e2);
          return res.status(500).json({ error: 'Erro interno ao buscar pet criado.' });
        }
        res.json({ pet });
      });
    }
  );
});



// Atualizar pet
app.put('/api/pets/:id', (req, res) => {
  const { id } = req.params;
  const { name, breed, info } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Nome do pet é obrigatório.' });
  }

  db.run(
    'UPDATE pets SET name = ?, breed = ?, info = ? WHERE id = ?',
    [name, breed || null, info || null, id],
    function (err) {
      if (err) {
        console.error('Erro ao atualizar pet:', err);
        return res.status(500).json({ error: 'Erro interno ao atualizar pet.' });
      }
      db.get('SELECT * FROM pets WHERE id = ?', [id], (e2, pet) => {
        if (e2) {
          console.error('Erro ao buscar pet atualizado:', e2);
          return res.status(500).json({ error: 'Erro interno ao buscar pet atualizado.' });
        }
        res.json({ pet });
      });
    }
  );
});

// Deletar pet
app.delete('/api/pets/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM pets WHERE id = ?', [id], function (err) {
    if (err) {
      console.error('Erro ao deletar pet:', err);
      return res.status(500).json({ error: 'Erro interno ao excluir pet.' });
    }
    res.json({ deleted: this.changes > 0 });
  });
});

// POST /api/bookings
app.post('/api/bookings', (req, res) => {
  const {
    customer_id,
    pet_id,
    date,
    time,
    service,
    prize,
    notes,
    status
  } = req.body;

  // validação básica
  if (!customer_id || !pet_id || !date || !time || !service || !prize) {
    return res.status(400).json({
      error: 'Cliente, pet, data, horário, serviço e mimo são obrigatórios.'
    });
  }

  const createdAt = new Date().toISOString();
  const finalStatus = status || 'agendado';

  const sql = `
    INSERT INTO bookings
      (customer_id, pet_id, date, time, service, prize, notes, status, created_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(
    sql,
    [
      customer_id,
      pet_id,
      date,
      time,
      service,
      prize,
      notes || null,
      finalStatus,
      createdAt
    ],
    function (err) {
      if (err) {
        console.error('Erro ao inserir booking:', err);
        return res.status(500).json({ error: 'Erro interno ao salvar agendamento.' });
      }

      // retorna o agendamento criado (simples)
      res.json({
        id: this.lastID,
        customer_id,
        pet_id,
        date,
        time,
        service,
        prize,
        notes: notes || null,
        status: finalStatus,
        created_at: createdAt
      });
    }
  );
});


// LISTAR AGENDAMENTOS
app.get('/api/bookings', (req, res) => {
  const { date, search } = req.query;

  let sql = `
    SELECT
      b.id,
      b.customer_id,
      b.pet_id,
      b.date,
      b.time,
      b.service,
      b.prize,
      b.status,
      b.notes,
      b.last_notification_at,
      c.name AS customer_name,
      c.phone,
      p.name AS pet_name,
      p.breed AS pet_breed
    FROM bookings b
    LEFT JOIN customers c ON c.id = b.customer_id
    LEFT JOIN pets p ON p.id = b.pet_id
    WHERE 1=1
  `;

  const params = [];

  // filtro por data (opcional)
  if (date) {
    sql += ' AND b.date = ?';
    params.push(date);
  }

  // filtro de busca (nome, pet, telefone)
  if (search) {
    sql += `
      AND (
        c.name LIKE ?
        OR p.name LIKE ?
        OR REPLACE(REPLACE(REPLACE(c.phone, '(', ''), ')', ''), '-', '') LIKE ?
      )
    `;
    const like = `%${search}%`;
    const searchDigits = (search || '').replace(/\D/g, '');
    params.push(like, like, `%${searchDigits}%`);
  }

  sql += ' ORDER BY b.date ASC, b.time ASC';

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Erro ao buscar agendamentos:', err);
      return res.status(500).json({ error: 'Erro ao buscar agendamentos.' });
    }
    res.json({ bookings: rows || [] });
  });
});


// EDITAR AGENDAMENTO
app.put('/api/bookings/:id', (req, res) => {
  const { id } = req.params;
  const {
    customer_id,
    pet_id,
    date,
    time,
    service,
    prize,
    notes,
    status,
    last_notification_at
  } = req.body;

  const sql = `
    UPDATE bookings
       SET customer_id = ?,
           pet_id = ?,
           date = ?,
           time = ?,
           service = ?,
           prize = ?,
           notes = ?,
           status = ?,
           last_notification_at = ?
     WHERE id = ?
  `;

  const params = [
    customer_id || null,
    pet_id || null,
    date,
    time,
    service,
    prize,
    notes || null,
    status || 'agendado',
    last_notification_at || null,
    id
  ];

  db.run(sql, params, function (err) {
    if (err) {
      console.error('Erro ao atualizar agendamento:', err);
      return res.status(500).json({ error: 'Erro ao atualizar agendamento.' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Agendamento não encontrado.' });
    }

    // retorna o registro atualizado no mesmo formato do GET /api/bookings
    const sqlGet = `
      SELECT
        b.id,
        b.customer_id,
        b.pet_id,
        b.date,
        b.time,
        b.service,
        b.prize,
        b.status,
        b.notes,
        b.last_notification_at,
        c.name AS customer_name,
        c.phone,
        p.name AS pet_name,
        p.breed AS pet_breed
      FROM bookings b
      LEFT JOIN customers c ON c.id = b.customer_id
      LEFT JOIN pets p      ON p.id = b.pet_id
      WHERE b.id = ?
    `;

    db.get(sqlGet, [id], (err2, row) => {
      if (err2) {
        console.error('Erro ao buscar agendamento atualizado:', err2);
        return res.status(500).json({ error: 'Erro ao buscar agendamento atualizado.' });
      }
      return res.json({ booking: row });
    });
  });
});


// EXCLUIR AGENDAMENTO
app.delete('/api/bookings/:id', (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM bookings WHERE id = ?', [id], function (err) {
    if (err) {
      console.error('Erro ao excluir agendamento:', err);
      return res.status(500).json({ error: 'Erro ao excluir agendamento.' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Agendamento não encontrado.' });
    }

    return res.json({ success: true });
  });
});



// (rotas de bookings aqui embaixo…)

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "roleta.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});


// START SERVER
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log('API Pet Funny rodando na porta', PORT);
});
