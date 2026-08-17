# Frota — Lubrificação & Calibragem

App simples (HTML + JS puro) para organizar o cronograma de lubrificação/engraxamento
(4 colunas = 4 sábados) e calibragem (2 colunas), com placas em formato de card que
podem ser movidas entre colunas. Multiusuário, com login e sincronização em tempo real
via Supabase.

## 1. Criar o projeto no Supabase

1. Acesse https://supabase.com → **New project**.
2. Depois de criado, vá em **SQL Editor → New query**, cole todo o conteúdo do
   arquivo `sql/schema.sql` deste projeto e clique em **Run**.
   Isso cria as tabelas, as permissões (RLS), as 6 colunas (4 + 2) e já cadastra
   a frota inteira, com uma distribuição inicial balanceada na lubrificação.
3. Vá em **Authentication → Users → Add user** e crie um usuário (e-mail/senha)
   para cada pessoa da equipe que vai usar o app. (Cadastro público fica desativado
   de propósito — só quem você criar consegue entrar.)
4. Vá em **Project Settings → API** e copie:
   - **Project URL**
   - **anon public key**

## 2. Configurar o app

Abra o arquivo `config.js` e cole os dois valores:

```js
export const SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
export const SUPABASE_ANON_KEY = "SUA-CHAVE-ANON-PUBLICA-AQUI";
```

## 3. Subir para o GitHub

```bash
cd frota-app
git init
git add .
git commit -m "App de lubrificação e calibragem"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

## 4. Publicar na Vercel

1. Acesse https://vercel.com → **Add New → Project**.
2. Selecione o repositório que você acabou de subir.
3. Framework preset: **Other** (é HTML/JS puro, sem build).
   Não precisa configurar build command nem output directory.
4. Clique em **Deploy**. Pronto — a Vercel te dá uma URL pública.

## Como usar

- Entre com o e-mail/senha criado no passo 1.3.
- Cada card é uma placa. Ele mostra a placa do truck e, quando existe, a placa
  do reboque (julieta) — a cor da borda indica **truck** (amarelo) ou
  **conjunto** (verde).
- Para mover uma placa: arraste o card para outra coluna, ou use os botões
  `‹` `›` / a lista suspensa dentro do card (funciona bem em celular também).
- O nome de cada coluna (ex. "Sábado 1") pode ser editado clicando nele —
  troque pela data real do sábado quando quiser.
- Qualquer placa cadastrada sem posição aparece na coluna tracejada
  "Não escalado", à esquerda.

## Estrutura dos arquivos

```
index.html          → tela de login
lubrificacao.html    → quadro com 4 colunas
calibragem.html       → quadro com 2 colunas
style.css             → identidade visual (compartilhada)
config.js             → suas chaves do Supabase (edite aqui)
supabaseClient.js      → conexão com o Supabase + checagem de login
board.js               → lógica do quadro (carregar, mover, tempo real)
sql/schema.sql          → script único para montar o banco no Supabase
```

## Adicionar/editar placas depois

O jeito mais simples é pelo próprio Supabase: **Table editor → caminhoes**.
Insira `placa`, `reboque` (deixe vazio se for truck simples) e `tipo`
(`truck` ou `conjunto`). A placa nova aparece automaticamente no app,
dentro de "Não escalado", pronta para ser arrastada para a coluna certa.
