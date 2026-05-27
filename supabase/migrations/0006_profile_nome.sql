-- Adiciona campo nome em profiles e ajusta trigger para capturar do raw_user_meta_data
alter table public.profiles add column if not exists nome text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nome)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nome', null)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
