create policy "Users can view own good morning sent record"
  on public.good_morning_sent
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own good morning sent record"
  on public.good_morning_sent
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own good morning sent record"
  on public.good_morning_sent
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete own good morning sent record"
  on public.good_morning_sent
  for delete
  to authenticated
  using (user_id = auth.uid());