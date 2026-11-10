-- Pillars: a special status in Fire Force, given only by Tatsuya or Minako, even after approval.
-- The origin Pillar is Passivity; the rest sit on a positive or a negative spectrum. A Pillar shows
-- as its own tab on the character's Fire Force card, with its Adolla Burst perks.
--
-- Nobody reads the table directly: character_pillar() hands it out to whoever can see that
-- character's sheet (so encrypted and sealed characters keep it hidden), and set_pillar() writes it.

create table if not exists public.pillars (
	character_id uuid primary key references public.characters (id) on delete cascade,
	spectrum text not null check (spectrum in ('origin', 'positive', 'negative')),
	emotion text not null check (length(btrim(emotion)) between 1 and 60),
	set_by uuid references public.profiles (id) on delete set null,
	set_at timestamptz not null default now()
);
alter table public.pillars enable row level security;
revoke all on public.pillars from anon, authenticated;

-- True for the two admins who give Pillar status: Tatsuya and Minako.
create or replace function public.can_set_pillars()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from auth.identities i
		where i.user_id = auth.uid()
			and i.provider = 'discord'
			and i.provider_id in ('530159153482694666', '438334230653829120')
	);
$$;

-- The character's Pillar, for anyone who can see its sheet; null otherwise.
create or replace function public.character_pillar(p_character uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	page jsonb := public.character_page(p_character);
	p public.pillars;
begin
	if page is null or coalesce((page ->> 'allowed')::boolean, false) is not true then
		return null;
	end if;
	select * into p from public.pillars where character_id = p_character;
	if p.character_id is null then
		return null;
	end if;
	return jsonb_build_object('spectrum', p.spectrum, 'emotion', p.emotion, 'set_at', p.set_at);
end;
$$;

-- Makes a character a Pillar, changes which one, or (p_spectrum null) takes it away.
create or replace function public.set_pillar(p_character uuid, p_spectrum text, p_emotion text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	emotion text := btrim(coalesce(p_emotion, ''));
	me uuid;
begin
	if not public.can_set_pillars() then
		raise exception 'Only Tatsuya or Minako can give Pillar status.' using errcode = '42501';
	end if;
	if not exists (select 1 from public.characters where id = p_character) then
		raise exception 'That character doesn''t exist.' using errcode = 'P0002';
	end if;
	if p_spectrum is null then
		delete from public.pillars where character_id = p_character;
		return null;
	end if;
	if p_spectrum = 'origin' then
		emotion := 'Passivity';
	elsif p_spectrum = 'positive' then
		if emotion not in ('Love', 'Pride', 'Curiosity', 'Hope', 'Serenity', 'Excitement', 'Happiness') then
			raise exception 'Positive Pillars are Love, Pride, Curiosity, Hope, Serenity, Excitement or Happiness.' using errcode = '22023';
		end if;
	elsif p_spectrum = 'negative' then
		if emotion = '' or length(emotion) > 60 then
			raise exception 'Name the negative Pillar''s emotion.' using errcode = '22023';
		end if;
	else
		raise exception 'A Pillar is origin, positive or negative.' using errcode = '22023';
	end if;
	select id into me from public.profiles where id = auth.uid();
	insert into public.pillars (character_id, spectrum, emotion, set_by, set_at)
	values (p_character, p_spectrum, emotion, me, now())
	on conflict (character_id) do update
		set spectrum = excluded.spectrum, emotion = excluded.emotion, set_by = excluded.set_by, set_at = excluded.set_at;
	return jsonb_build_object('spectrum', p_spectrum, 'emotion', emotion, 'set_at', now());
end;
$$;

revoke execute on function public.can_set_pillars() from public;
revoke execute on function public.character_pillar(uuid) from public;
revoke execute on function public.set_pillar(uuid, text, text) from public, anon;
grant execute on function public.can_set_pillars() to anon, authenticated;
grant execute on function public.character_pillar(uuid) to anon, authenticated;
grant execute on function public.set_pillar(uuid, text, text) to authenticated;
