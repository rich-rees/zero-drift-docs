create table public.menu_items (id uuid primary key, name text not null, price_pence int not null);
create table public.orders (id uuid primary key, items jsonb not null, created_at timestamptz default now());
