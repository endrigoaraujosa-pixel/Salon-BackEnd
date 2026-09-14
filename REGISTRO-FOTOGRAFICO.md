# Registro fotográfico dos atendimentos

A funcionalidade começa desativada. Após aplicar a migração, ativar **Permitir fotos nos atendimentos** em `/configuracoes/gerais`.

## Qualidade e armazenamento

- Entrada: JPG/JPEG, PNG e WEBP, até 10 MiB por arquivo, 16000 pixels por lado e 80 megapixels. Arquivos animados ou inválidos são rejeitados.
- Armazenamento: WEBP com qualidade 90, até 4096 pixels por lado, sem ampliar imagens pequenas. A orientação EXIF é corrigida e metadados, incluindo GPS, são removidos.
- Miniaturas de até 320 pixels são carregadas nas listas; o visualizador busca a imagem maior, com zoom de 100% a 500%, navegação e rolagem para examinar detalhes.
- Máximo de 5 fotos por agendamento; álbum paginado, sem limite total. Aumentar o zoom não cria detalhes ausentes no arquivo original.
- Binários privados armazenados no PostgreSQL, dentro do schema da empresa, em `atendimento_fotos`. Backups do banco incluem as fotos; considerar esse volume no dimensionamento do banco e dos backups.
- Sem expiração automática. Desativar oculta as fotos e bloqueia as rotas, preservando os dados. Remoção confirmada exclui a imagem e sua miniatura; os eventos de auditoria mantêm IDs, operação, usuário e data, sem copiar a imagem.

## Acesso e integridade

Leitura por usuários com `clientes.visualizar` ou `agenda.visualizar`; álbum completo exige `clientes.visualizar`. Inclusão e remoção exigem `agenda.editar`, inclusive na criação. Atendimentos concluídos mantêm a restrição `pode_alterar_concluido`. As rotas autenticadas verificam empresa, cliente, agendamento e foto; nenhuma imagem é servida por URL pública.

O envio ocorre após salvar o agendamento. O formulário mantém o ID criado e as imagens com erro para nova tentativa, usando o mesmo ID de foto para evitar duplicações. Cada inclusão trava a linha do agendamento em uma transação antes de conferir o limite. A troca do cliente é bloqueada enquanto houver fotos, mesmo com a funcionalidade desativada. Um upload repetido não restaura uma foto já removida.

Consentimento: não foi introduzido um novo fluxo de consentimento; permanece a regra operacional adotada pela empresa. A configuração não é ativada automaticamente.

## Aplicação

1. Instalar as dependências do backend (`npm ci`), incluindo Sharp, e compilar o frontend.
2. Aplicar a migração `20260914120000-create-atendimento-fotos.js` usando o fluxo de migrações por schema do projeto (`npm run migrate`, no ambiente de destino corretamente configurado).
3. Implantar backend e frontend juntos, após a migração, e ativar a opção na empresa desejada.

Se houver um proxy externo, configurar o limite de upload para pelo menos 10 MiB. O backend faz sua própria validação. O rollback da migração elimina as tabelas e as fotos; não executar rollback como forma de desativar o recurso.

## Validação

`npm run test:fotos` usa Node 24 e banco SQLite temporário em memória, sem conexão com dados reais. Cobre formatos, tamanho, dimensões, orientação, miniaturas, limite de cinco, repetição, remoção, preservação em falhas, desativação, vínculo ao cliente, permissão, restrição de concluídos e álbum com mais de 100 atendimentos.

O frontend foi compilado com Vite. Após recuperar o serviço WSL e iniciar o Docker Desktop, a migração foi aplicada nos três schemas do banco local selecionado. O teste `tests/atendimento-fotos-postgres.js`, executado em schema temporário isolado, confirmou que oito uploads simultâneos resultam em cinco inclusões e três bloqueios, e que os binários são armazenados corretamente. O schema temporário foi removido ao terminar. Frontend e API responderam HTTP 200; a tela de login foi conferida no navegador. O fluxo visual completo de fotos com usuário autenticado ainda não foi exercitado.
