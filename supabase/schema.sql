-- Ejecuta esto en Supabase > SQL Editor
create table flexers (
  id uuid primary key default gen_random_uuid(),
  nickname text not null check (char_length(nickname) between 2 and 24),
  nickname_key text generated always as (lower(nickname)) stored unique,
  message text not null default '' check (char_length(message) <= 140),
  total_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index flexers_rank_idx on flexers (total_cents desc, updated_at asc);

create table payments (
  id uuid primary key default gen_random_uuid(),
  flexer_id uuid not null references flexers(id),
  stripe_session_id text not null unique,          -- garantiza idempotencia
  amount_cents int not null check (amount_cents > 0),
  charity_cents int not null,                      -- 50% (redondeado hacia abajo)
  creator_cents int not null,                      -- el resto
  created_at timestamptz not null default now(),
  check (charity_cents + creator_cents = amount_cents)
);
create index payments_recent_idx on payments (created_at desc);

-- Registro atómico e idempotente: crea/actualiza al flexer y guarda el pago
create or replace function register_payment(
  p_session_id text, p_nickname text, p_message text,
  p_amount int, p_charity int, p_creator int
) returns void language plpgsql security definer as $$
declare v_id uuid;
begin
  if exists (select 1 from payments where stripe_session_id = p_session_id) then return; end if;
  insert into flexers (nickname, message, total_cents)
  values (p_nickname, p_message, p_amount)
  on conflict (nickname_key) do update
    set total_cents = flexers.total_cents + excluded.total_cents,
        message = excluded.message,
        updated_at = now()
  returning id into v_id;
  insert into payments (flexer_id, stripe_session_id, amount_cents, charity_cents, creator_cents)
  values (v_id, p_session_id, p_amount, p_charity, p_creator);
end $$;

create view stats as
  select coalesce(sum(charity_cents),0)::bigint as charity_cents,
         coalesce(sum(amount_cents),0)::bigint as total_cents,
         (select count(*) from flexers)::int as flexers
  from payments;

create view recent_activity as
  select f.nickname, p.amount_cents, p.created_at
  from payments p join flexers f on f.id = p.flexer_id
  order by p.created_at desc limit 15;

-- Solo el servidor (service_role) accede a los datos
alter table flexers enable row level security;
alter table payments enable row level security;
revoke all on flexers, payments, stats, recent_activity from anon, authenticated;
revoke execute on function register_payment from public, anon, authenticated;
