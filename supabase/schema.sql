create table if not exists conversas (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  pergunta text not null,
  resposta text not null,
  onde text,
  lugares text
);
