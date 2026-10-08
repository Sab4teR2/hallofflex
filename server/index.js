import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import rateLimit from 'express-rate-limit';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { splitAmount, cleanText, MIN_CENTS, MAX_CENTS } from './lib/split.js';

const env = process.env;
const BASE_URL = env.BASE_URL || 'http://localhost:3000';
const stripe = new Stripe(env.STRIPE_SECRET_KEY);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const app = express();
app.set('trust proxy', 1);

// ── Webhook de Stripe: DEBE ir antes de express.json() (necesita el body crudo)
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Firma inválida: ${err.message}`);
  }
  const paidEvents = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
  if (paidEvents.includes(event.type)) {
    const s = event.data.object;
    if (s.payment_status === 'paid') {
      const { charity, creator } = splitAmount(s.amount_total);
      const { error } = await db.rpc('register_payment', {
        p_session_id: s.id,
        p_nickname: s.metadata.nickname,
        p_message: s.metadata.message ?? '',
        p_amount: s.amount_total,
        p_charity: charity,
        p_creator: creator,
      });
      if (error) { console.error(error); return res.status(500).end(); }
    }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '10kb' }));
app.use(express.static(publicDir));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 60 }));

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'Error interno' }); });
const cache = (res) => res.set('Cache-Control', 'public, max-age=5');

// ── Ruta temporal para simular 1 o varios pagos aleatorios en local
app.get('/api/test-simulate-payment', wrap(async (req, res) => {
  const count = Number(req.query.count) || 1;
  const names = ['Alex', 'Lucía', 'Carlos', 'Sofía', 'Daniel', 'Elena', 'Marcos', 'Laura', 'Pablo', 'Beatriz'];
  const messages = ['¡Mucho ánimo!', '¡A tope con el proyecto!', '¡Grande!', '¡Tomad un extra!', '¡A por el top 1!', '¡Buenísima causa!'];
  
  let inserted = [];

  for (let i = 0; i < count; i++) {
    const randomName = names[Math.floor(Math.random() * names.length)] + ' ' + Math.floor(Math.random() * 100);
    const randomMsg = messages[Math.floor(Math.random() * messages.length)];
    const randomCents = Math.floor(Math.random() * 9000 + 500); // Entre 5€ y 95€
    const { charity, creator } = splitAmount(randomCents);
    const fakeSessionId = 'cs_test_' + Math.random().toString(36).substring(7);

    const { error } = await db.rpc('register_payment', {
      p_session_id: fakeSessionId,
      p_nickname: randomName,
      p_message: randomMsg,
      p_amount: randomCents,
      p_charity: charity,
      p_creator: creator,
    });

    if (!error) {
      inserted.push({ name: randomName, amount: randomCents / 100 });
    } else {
      console.error(error);
    }
  }

  res.json({ success: true, added: inserted.length, details: inserted });
}));

app.get('/api/leaderboard', wrap(async (_req, res) => {
  const { data, error } = await db.from('flexers').select('nickname,message,total_cents')
    .order('total_cents', { ascending: false }).order('updated_at', { ascending: true }).limit(100);
  if (error) throw error;
  cache(res).json(data);
}));

app.get('/api/stats', wrap(async (_req, res) => {
  const { data, error } = await db.from('stats').select('*').single();
  if (error) throw error;
  cache(res).json({ ...data, charity_name: env.CHARITY_NAME || 'la ONG' });
}));

app.get('/api/activity', wrap(async (_req, res) => {
  const { data, error } = await db.from('recent_activity').select('*');
  if (error) throw error;
  cache(res).json(data);
}));

app.post('/api/checkout', wrap(async (req, res) => {
  const nickname = cleanText(req.body.nickname, 24);
  const message = cleanText(req.body.message, 140);
  const cents = Number(req.body.amount_cents);
  if (nickname.length < 2) return res.status(400).json({ error: 'El alias necesita al menos 2 caracteres.' });
  if (!Number.isInteger(cents) || cents < MIN_CENTS || cents > MAX_CENTS)
    return res.status(400).json({ error: 'La cantidad debe estar entre 1 € y 10.000 €.' });

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: cents,
        product_data: { name: `Flex de ${nickname}`, description: 'El 50% se destina a obras benéficas.' },
      },
    }],
    metadata: { nickname, message },
    success_url: `${BASE_URL}/?flex=ok`,
    cancel_url: `${BASE_URL}/?flex=cancel`,
  });
  res.json({ url: session.url });
}));

app.listen(env.PORT || 3000, () => console.log(`HallOfFlex en ${BASE_URL}`));