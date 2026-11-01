// Seeds an admin, sample tours/organizations/vehicles and (outside production) a demo driver.
const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('./index');

(async () => {
  const e = process.env;
  const email = e.ADMIN_EMAIL || 'admin@pwaniride.test';
  const pass = e.ADMIN_PASSWORD || 'ChangeMe123!';
  if (config.prod && pass === 'ChangeMe123!') throw new Error('Set ADMIN_PASSWORD before seeding production');

  await db.query(
    `INSERT INTO users(phone,name,email,password_hash,role) VALUES($1,'Admin',$2,$3,'ADMIN')
     ON CONFLICT (phone) DO NOTHING`,
    [e.ADMIN_PHONE || '254700000000', email, await bcrypt.hash(pass, 10)]
  );

  const tours = [
    ['Kilifi Creek and Gede Ruins', 'Creek photo stop, snake park, then the Gede ruins.',
      [{ name: 'Kilifi Creek', minutes: 30 }, { name: 'Snake Park', minutes: 45 }, { name: 'Gede Ruins', minutes: 60 }], 4, 3500],
    ['Watamu Beach Hop', 'Beach and marine park viewpoint.', [{ name: 'Watamu Beach', minutes: 60 }, { name: 'Mida Creek', minutes: 45 }], 3, 3000],
  ];
  for (const t of tours) {
    await db.query(
      `INSERT INTO tours(name,description,stops,duration_hours,price)
       SELECT $1,$2,$3::jsonb,$4,$5 WHERE NOT EXISTS (SELECT 1 FROM tours WHERE name=$1)`,
      [t[0], t[1], JSON.stringify(t[2]), t[3], t[4]]
    );
  }
  const orgs = [['DEMO-CO', 'Demo Company Ltd', 'COMPANY'], ['DEMO-SCH', 'Demo Academy', 'SCHOOL'], ['DEMO-HTL', 'Demo Beach Resort', 'HOTEL']];
  for (const o of orgs) await db.query('INSERT INTO organizations(code,name,type) VALUES($1,$2,$3) ON CONFLICT (code) DO NOTHING', o);
  for (let i = 1; i <= 5; i++) {
    await db.query(
      `INSERT INTO vehicles(plate_number,model,year,qr_code) VALUES($1,'Bajaj RE',2024,$2) ON CONFLICT (plate_number) DO NOTHING`,
      [`KDF 10${i}A`, `PR-VEH-00${i}`]
    );
  }
  if (!config.prod) {
    const u = await db.query(
      `INSERT INTO users(phone,name,pin_hash,role) VALUES('254700000001','Demo Driver',$1,'DRIVER')
       ON CONFLICT (phone) DO UPDATE SET name=users.name RETURNING id`,
      [await bcrypt.hash('1234', 10)]
    );
    await db.query(
      `INSERT INTO drivers(user_id,license_number,badge_number,status,tour_certified) VALUES($1,'DL-0001','PSV-0001','ACTIVE',true)
       ON CONFLICT (user_id) DO NOTHING`,
      [u.rows[0].id]
    );
    console.log('Demo driver: phone 254700000001, PIN 1234. Demo vehicle QR codes: PR-VEH-001 ... PR-VEH-005');
  }
  console.log(`Seed complete. Admin login: ${email}`);
  await db.pool.end();
})().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
