# Registro fotográfico dos atendimentos

A funcionalidade começa desativada. Após aplicar a migração, ativar **Permitir fotos nos atendimentos** em `/configuracoes/gerais`.

## Qualidade e armazenamento

- Entrada: JPG/JPEG, PNG e WEBP, até 10 MiB por arquivo, 16000 pixels por lado e 80 megapixels. Arquivos animados ou inválidos são rejeitados.
- Armazenamento: WEBP com qualidade 90, até 4096 pixels por lado, sem ampliar imagens pequenas. A orientação EXIF é corrigida e metadados, incluindo GPS, são removidos.
- Miniaturas de até 320 pixels são carregadas nas listas; o visualizador busca a imagem maior, com zoom de 100% a 500%, navegação e rolagem para examinar detalhes.
- Máximo de 5 fotos por agendamento; álbum paginado, sem limite total. Aumentar o zoom não cria detalhes ausentes no arquivo original.
- Imagem e miniatura ficam no bucket privado do Backblaze B2. A tabela `atendimento_fotos` guarda apenas chaves, versões, dimensões, tamanho e vínculos. Novos envios deixam `imagem` e `miniatura` nulos; falhas no B2 retornam erro sem fallback para o banco. Fotos antigas continuam legíveis até a migração. O backup do banco passa a conter referências; os arquivos do B2 precisam de proteção própria.
- Sem expiração automática. Desativar oculta as fotos e bloqueia as rotas, preservando os dados. Remoção confirmada exclui a imagem e sua miniatura; os eventos de auditoria mantêm IDs, operação, usuário e data, sem copiar a imagem.

## Acesso e integridade

Leitura por usuários com `clientes.visualizar` ou `agenda.visualizar`; álbum completo exige `clientes.visualizar`. Inclusão e remoção exigem `agenda.editar`, inclusive na criação. Atendimentos concluídos mantêm a restrição `pode_alterar_concluido`. As rotas autenticadas verificam empresa, cliente, agendamento e foto; o backend autoriza o acesso e gera uma URL assinada válida por 15 minutos. Quem possuir essa URL poderá acessar a imagem durante sua validade; ela não é persistida no banco.

O envio ocorre após salvar o agendamento. O formulário mantém o ID criado e as imagens com erro para nova tentativa, usando o mesmo ID de foto para evitar duplicações. Cada inclusão trava a linha do agendamento em uma transação antes de conferir o limite. A troca do cliente é bloqueada enquanto houver fotos, mesmo com a funcionalidade desativada. Um upload repetido não restaura uma foto já removida.

Consentimento: não foi introduzido um novo fluxo de consentimento; permanece a regra operacional adotada pela empresa. A configuração não é ativada automaticamente.

## Aplicação do B2

1. Configurar no backend as variáveis do arquivo `b2.env.example`. Usar uma chave nova restrita ao bucket de fotos, com leitura, escrita e exclusão; não reutilizar a chave de backup. A configuração de credenciais por empresa já existente continua suportada e tem prioridade sobre o ambiente. Nunca versionar segredos.
2. Antes de iniciar o novo backend, enviar e executar as migrations pendentes em **todos os schemas**: `20260914120000`, `20260914130000`, `20260914140000` `20260915120000` e `20260915130000`. Conferir a tabela SequelizeMeta de cada empresa. A migration 20260915120000 libera valores nulos nos binários e acrescenta IDs de versão do B2; 20260915130000 acrescenta o nome da chave. Não executar rollback depois da transferência: ele não recupera fotos no banco.
3. Implantar backend e frontend juntos. O frontend recebe a URL assinada por uma requisição autenticada e carrega a imagem diretamente do B2, sem enviar o token da aplicação ao bucket. Álbuns e listagens consultam somente metadados.
4. Para cada empresa, executar primeiro `npm run migrar-fotos-b2 -- --schema company_nome --dry-run`. Depois, `npm run migrar-fotos-b2 -- --schema company_nome` no ambiente correto. O script exige schema explícito e usa a mesma configuração do backend.
5. Conferir o resumo e o código de saída. Fotos com falha conservam seus binários; repetir o comando tenta novamente. O script também trata fotos já copiadas pelo script anterior que ainda mantinham BLOB.

A migração trabalha com uma foto por vez, compara SHA-256 do arquivo baixado com o original e só então torna ambos os binários nulos na transação. Ela bloqueia brevemente o agendamento sendo transferido; usar horário de menor movimento. Não executar a migração de dados enquanto uma versão antiga do backend ainda puder enviar fotos.

A remoção envia ao B2 o ID exato da versão, necessário para o bucket com Keep all versions. Se o B2 falhar, a referência permanece para nova tentativa de remoção. Falha parcial pode deixar uma das duas imagens indisponível até essa tentativa. Interrupção abrupta entre upload e commit pode deixar objetos sem referência; antes de qualquer limpeza no bucket, comparar as chaves com todas as empresas. Nenhum procedimento aqui altera o bucket de backups.

Remover BLOBs libera espaço reutilizável no PostgreSQL e reduz os próximos backups lógicos. O tamanho físico do banco pode não cair imediatamente. Não executar VACUUM FULL automaticamente em produção: exige planejamento por seus bloqueios.

## Validação desta alteração

- `npm run test:fotos`: 14 testes com SQLite e B2 simulado, incluindo limite, permissões, reenvio, falha parcial, ausência de BLOB em novos envios e migração verificada.
- PostgreSQL 17 local: migrations executadas em schema temporário; oito envios simultâneos produziram cinco inclusões e três bloqueios. Conferidos binários nulos. Schema temporário removido ao terminar.
- Frontend compilado com Vite.
- Não realizado upload real no B2 nem migração dos dados de clientes nesta validação. Configurar credenciais válidas e testar envio, zoom e remoção antes de publicar em produção.

## Configuração pela tela

Em Configurações → Gerais → Registro Fotográfico, informar keyName (nome de identificação), keyID e Application Key. Salvar credenciais B2. A senha não é devolvida pela API; deixar em branco mantém a senha do mesmo keyID. Trocar o ID exige a senha correspondente. O bucket padrão é salon-fotos-api, região us-east-005; B2_BUCKET_NAME, B2_ENDPOINT e B2_REGION podem sobrescrever os padrões no servidor.

A configuração é por empresa e por banco do ambiente. Funciona no Docker local e em produção; bases separadas exigem configurar a tela em cada ambiente. Não depende de arquivo do computador desktop. Em produção, aplicar todas as migrations pendentes antes de iniciar o backend, incluindo 20260915130000-add-b2-key-name.js. O indicador Configurado informa presença das credenciais, não valida a conexão com o B2.
