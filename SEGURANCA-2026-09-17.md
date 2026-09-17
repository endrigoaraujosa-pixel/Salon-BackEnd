# Atualização de segurança — 17/09/2026

As alterações preservam telas e etapas normais de trabalho. O backend agora exige autorização efetiva para operações sensíveis. Não é uma certificação de ausência de vulnerabilidades nem uma garantia sobre infraestrutura de produção não acessada.

## Alterações

- Usuários inativos/excluídos deixam de acessar a API; perfis inativos/excluídos não concedem permissões.
- Funcionários com gestão de usuários/perfis continuam administrando acessos iguais ou inferiores aos próprios. Só administradores concedem acesso administrativo; edição, redefinição de senha e exclusão de usuários superiores são bloqueadas.
- Sessões persistidas por empresa; logout e troca de senha invalidam acesso; refresh é rotacionado, com tolerância de 10 segundos para requisições simultâneas. Sessões vencidas são removidas nos próximos logins. Tokens da versão anterior exigem novo login uma vez.
- Agendamento público transporta provas assinadas de telefone e reserva, sem acrescentar telas. Provas são específicas por empresa e finalidade. Reserva consumida não pode ser sobrescrita. A loja sem WhatsApp continua recebendo solicitações; esse fluxo não pode sobrescrever dados cadastrais nem consultar dados privados usando apenas um telefone.
- OTP aleatório criptográfico, HMAC no banco, validade de 10 minutos, até cinco tentativas com bloqueio transacional e consumo único. OTPs antigos devem ser solicitados novamente após a atualização. Códigos e conteúdo de mensagens deixam de ser registrados no log do provedor.
- Limites de tentativas nas rotas de login, OTP, reserva e solicitação. São limites por processo; múltiplas réplicas precisam também de controle compartilhado/no proxy. Configure TRUST_PROXY apenas com endereços de proxies controlados para identificar corretamente os IPs.
- Evolution: a chave global só pode ser usada no destino definido pelo servidor e na instância correspondente à empresa. URLs adicionais exigem EVOLUTION_ALLOWED_URLS no servidor e credencial própria. Redirecionamentos são bloqueados; respostas de configuração não expõem token. Usuários autorizados apenas a campanhas alteram apenas seus intervalos.
- B2: novas credenciais são cifradas com AES-256-GCM, vinculadas à empresa, usando uma chave externa ao banco. As fotos continuam no B2; o banco mantém referências. A migration é aditiva e não cifra credenciais enquanto uma versão antiga ainda estiver atendendo.
- Dependências atualizadas; SQLite é ferramenta de teste e sai da imagem de produção. Build do backend usa npm ci. O workflow da página pública deixa de publicar imagem em pull requests.

## Implantação manual em produção — ordem necessária

1. Preserve backup do banco, versões/imagens atuais e variáveis do servidor. **Não publique apenas o backend:** esta entrega também altera `salon-frontend-client`.
2. Gere uma chave aleatória de 32 bytes e configure `B2_CREDENTIAL_ENCRYPTION_KEY` com os 64 caracteres hexadecimais em todas as instâncias do backend. Exemplo de geração no terminal privado do servidor: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Não envie o valor ao GitHub. Guarde uma cópia em cofre/backup separado do banco; perder ou trocar a chave sem recifrar impede ler as credenciais B2 cifradas.
3. Verifique a integração WhatsApp de cada empresa: usando a chave global, o nome da instância precisa corresponder ao schema sem `company_`. Configurações legadas diferentes e URLs personalizadas precisam ser ajustadas/mapeadas pela infraestrutura antes da troca de versão. Não libere qualquer host apenas para contornar a validação.
4. Publique primeiro a página pública atualizada (`frontend-client`). Ela também funciona com o backend antigo; passa a enviar as provas quando o backend novo as fornece. Evite alternar réplicas antigas e novas durante agendamentos em andamento. Clientes com a página antiga aberta precisam recarregá-la para receber a proteção.
5. Execute manualmente as migrations pendentes usando o procedimento já adotado. A nova migration é `20260917120000-security-sessions-and-b2-encryption.js`, em **todos os schemas company_**. Ela cria `auth_sessions` e amplia `b2_application_key` para TEXT. Confirme sucesso antes de iniciar a nova API. Não regenere nem omita o arquivo.
6. Atualize o backend e o painel administrativo. Será necessário fazer login novamente uma vez. Confira agenda, cadastros, permissões, relatórios e um agendamento público na empresa de homologação antes de liberar a versão para todos os clientes.
7. Depois que nenhuma réplica antiga estiver atendendo, execute `npm run security:encrypt-b2 -- --all` dentro do backend, com a chave de criptografia configurada. O comando é idempotente, verifica a decifragem e não imprime credenciais. Também aceita um schema explícito no lugar de `--all`.
8. Confira a leitura de uma foto e o envio/remoção de uma foto de teste autorizada; confirme a integração de WhatsApp com um destinatário de teste autorizado. Esses serviços externos não foram exercitados com mensagens reais nesta validação.

Não remova `auth_sessions` em um rollback. Antes de voltar a um backend que não entende credenciais cifradas, restaure a configuração de credenciais a partir do backup seguro correspondente; não reverta simplesmente a imagem depois de cifrar. Fotos/objetos B2 não são removidos por esta atualização.

## Validação realizada

- `npm run test:security`: 11 testes de autenticação, revogação, permissões, cadastro público, OTP, reservas, B2, WhatsApp e limites.
- `npm run test:fotos`: 15 testes de imagem, limite de cinco fotos, isolamento, falhas, BLOB legado e credenciais cifradas.
- `npm run test:b2`: 2 testes de destinos e separação de credenciais por empresa.
- `node --test --test-isolation=none tests/api-security.test.mjs` na página pública: 2 testes de transporte das provas, isolamento e respostas de reservas fora de ordem.
- PostgreSQL em schema temporário: migration aditiva, criptografia idempotente, cinco refreshes simultâneos, uma única validação bem-sucedida entre oito tentativas com o mesmo OTP.
- PostgreSQL/fotos na imagem nova: oito envios simultâneos resultam em cinco fotos e três bloqueios; somente referências no banco.
- Builds dos dois frontends e imagens Docker locais de backend/painel.
- Navegador local: login real com preenchimento já existente, dashboard, agenda e abertura do Novo Agendamento sem salvar.
- 36 consultas autenticadas locais: agenda, clientes, colaboradores, serviços, produtos, usuários, vendas, despesas, receitas, comissões, cadastros, estoque, dashboard, caixa, DRE, cartões, resultado operacional, configurações e consultas públicas. Os relatórios foram consultados com filtros de período válidos. Isso verifica leitura, não todas as combinações de lançamentos financeiros.
- Nenhuma publicação no GitHub/produção, mensagem WhatsApp ou alteração de dados de produção foi executada.

## Limites e alertas remanescentes

`npm audit` ficou sem alertas nos dois frontends. O backend passou de 22 alertas de produção (incluindo um crítico) para 7 (5 altos e 2 moderados), sem crítico. Restam cadeias de `extract-zip/Puppeteer/whatsapp-web.js` e `uuid` transitivo do Sequelize. Não foi aplicada a sugestão de downgrade forçado do WhatsApp. Substituir essas integrações exige validação específica antes de produção; não foram declaradas seguras apenas por serem transitivas.

Referências: [aviso do extract-zip](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) e [aviso do esbuild corrigido no painel](https://github.com/advisories/GHSA-67mh-4wv8-2f99).

As chaves de Backblaze anteriormente compartilhadas em conversa devem ser substituídas no provedor e atualizadas no sistema. Cifrar o banco não revoga credenciais que já foram expostas. Essa troca não foi executada automaticamente.
