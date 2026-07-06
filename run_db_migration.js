import { sequelize } from './src/config/db.js';
import addSoftDelete from './src/migrations/20260522120000-add-soft-delete-columns.js';
import addCommissions from './src/migrations/20260522132600-add-commission-percentages-to-colaboradores.js';
import createFornecedores from './src/migrations/20260525230000-create-fornecedores.js';
import addColumnsToDespesas from './src/migrations/20260525231000-add-columns-to-despesas.js';
import addColumnsToOutrasReceitas from './src/migrations/20260525232000-add-columns-to-outras-receitas.js';
import createEstoqueTables from './src/migrations/20260526110000-create-estoque-tables.js';
import addSerieAndUniquenessToEstoque from './src/migrations/20260526120500-add-serie-and-uniqueness-to-estoque.js';
import createAccessProfilesAndPermissions from './src/migrations/20260526154500-create-access-profiles-and-permissions.js';
import addRealizarPagamentoPermission from './src/migrations/20260526190000-add-realizar-pagamento-permission.js';
import addColaboradorIdToUsers from './src/migrations/20260527130000-add-colaborador-id-to-users.js';
import createEmpresa from './src/migrations/20260528120000-create-empresa.js';
import addCriadoPorToAgendamentos from './src/migrations/20260528175000-add-criado-por-to-agendamentos.js';
import createWhatsAppTables from './src/migrations/20260601000000-create-whatsapp-tables.js';
import addApiFieldsToWhatsappConfig from './src/migrations/20260601100000-add-api-fields-to-whatsapp-config.js';
import createDescontos from './src/migrations/20260603122000-create-descontos.js';
import addAuditFieldsToVendasDiretas from './src/migrations/20260603100000-add-audit-fields-to-vendas-diretas.js';
import createConfiguracaoSistema from './src/migrations/20260611100000-create-configuracao-sistema.js';
import addOcultarInsumosToProdutos from './src/migrations/20260611110000-add-ocultar-insumos-to-produtos.js';
import addAgradecimentoToWhatsappConfig from './src/migrations/20260619150000-add-agradecimento-to-whatsapp-config.js';
import addCreditoClienteFields from './src/migrations/20260621220000-add-credito-cliente-fields.js';
import controlAdquirentesETaxas from './src/migrations/20260625000000-control-adquirentes-e-taxas.js';
import createColabComissaoServico from './src/migrations/20260705204000-create-colaborador-comissao-servico.js';
import Sequelize from 'sequelize';

async function run() {
  try {
    await sequelize.authenticate();
    console.log('Database connected successfully.');

    const queryInterface = sequelize.getQueryInterface();

    console.log('Running soft delete migration (up)...');
    try {
      await addSoftDelete.up(queryInterface, Sequelize);
      console.log('Soft delete migration completed.');
    } catch (e) {
      console.log('Soft delete migration skipped or already applied:', e.message);
    }

    console.log('Running commissions migration (up)...');
    try {
      await addCommissions.up(queryInterface, Sequelize);
      console.log('Commissions migration completed.');
    } catch (e) {
      console.log('Commissions migration skipped or already applied:', e.message);
    }

    console.log('Running create fornecedores migration (up)...');
    try {
      await createFornecedores.up(queryInterface, Sequelize);
      console.log('Fornecedores migration completed.');
    } catch (e) {
      console.log('Fornecedores migration skipped or already applied:', e.message);
    }

    console.log('Running add columns to despesas migration (up)...');
    try {
      await addColumnsToDespesas.up(queryInterface, Sequelize);
      console.log('Add columns to despesas migration completed.');
    } catch (e) {
      console.log('Add columns to despesas migration skipped or already applied:', e.message);
    }

    console.log('Running add columns to outras receitas migration (up)...');
    try {
      await addColumnsToOutrasReceitas.up(queryInterface, Sequelize);
      console.log('Add columns to outras receitas migration completed.');
    } catch (e) {
      console.log('Add columns to outras receitas migration skipped or already applied:', e.message);
    }

    console.log('Running create estoque tables migration (up)...');
    try {
      await createEstoqueTables.up(queryInterface, Sequelize);
      console.log('Create estoque tables migration completed.');
    } catch (e) {
      console.log('Create estoque tables migration skipped or already applied:', e.message);
    }

    console.log('Running add serie and uniqueness to estoque migration (up)...');
    try {
      await addSerieAndUniquenessToEstoque.up(queryInterface, Sequelize);
      console.log('Add serie and uniqueness to estoque migration completed.');
    } catch (e) {
      console.log('Add serie and uniqueness to estoque migration skipped or already applied:', e.message);
    }

    console.log('Running create access profiles and permissions migration (up)...');
    try {
      await createAccessProfilesAndPermissions.up(queryInterface, Sequelize);
      console.log('Create access profiles and permissions migration completed.');
    } catch (e) {
      console.log('Create access profiles and permissions migration skipped or already applied:', e.message);
    }

    console.log('Running add realizar pagamento permission migration (up)...');
    try {
      await addRealizarPagamentoPermission.up(queryInterface, Sequelize);
      console.log('Add realizar pagamento permission migration completed.');
    } catch (e) {
      console.log('Add realizar pagamento permission migration skipped or already applied:', e.message);
    }

    console.log('Running add colaborador_id to users migration (up)...');
    try {
      await addColaboradorIdToUsers.up(queryInterface, Sequelize);
      console.log('Add colaborador_id to users migration completed.');
    } catch (e) {
      console.log('Add colaborador_id to users migration skipped or already applied:', e.message);
    }

    console.log('Running create empresa migration (up)...');
    try {
      await createEmpresa.up(queryInterface, Sequelize);
      console.log('Create empresa migration completed.');
    } catch (e) {
      console.log('Create empresa migration skipped or already applied:', e.message);
    }

    console.log('Running add criado_por to agendamentos migration (up)...');
    try {
      await addCriadoPorToAgendamentos.up(queryInterface, Sequelize);
      console.log('Add criado_por to agendamentos migration completed.');
    } catch (e) {
      console.log('Add criado_por to agendamentos migration skipped or already applied:', e.message);
    }

    console.log('Running create whatsapp tables migration (up)...');
    try {
      await createWhatsAppTables.up(queryInterface, Sequelize);
      console.log('Create whatsapp tables migration completed.');
    } catch (e) {
      console.log('Create whatsapp tables migration skipped or already applied:', e.message);
    }

    console.log('Running add API fields to whatsapp config migration (up)...');
    try {
      await addApiFieldsToWhatsappConfig.up(queryInterface, Sequelize);
      console.log('Add API fields to whatsapp config migration completed.');
    } catch (e) {
      console.log('Add API fields to whatsapp config migration skipped or already applied:', e.message);
    }

    console.log('Running create descontos table migration (up)...');
    try {
      await createDescontos.up(queryInterface, Sequelize);
      console.log('Create descontos table migration completed.');
    } catch (e) {
      console.log('Create descontos table migration skipped or already applied:', e.message);
    }

    console.log('Running add audit fields to vendas diretas migration (up)...');
    try {
      await addAuditFieldsToVendasDiretas.up(queryInterface, Sequelize);
      console.log('Add audit fields to vendas diretas migration completed.');
    } catch (e) {
      console.log('Add audit fields to vendas diretas migration skipped or already applied:', e.message);
    }

    console.log('Running create configuracao sistema migration (up)...');
    try {
      await createConfiguracaoSistema.up(queryInterface, Sequelize);
      console.log('Create configuracao sistema migration completed.');
    } catch (e) {
      console.log('Create configuracao sistema migration skipped or already applied:', e.message);
    }

    console.log('Running add ocultar_insumos to produtos migration (up)...');
    try {
      await addOcultarInsumosToProdutos.up(queryInterface, Sequelize);
      console.log('Add ocultar_insumos to produtos migration completed.');
    } catch (e) {
      console.log('Add ocultar_insumos to produtos migration skipped or already applied:', e.message);
    }

    console.log('Running add agradecimento fields to whatsapp config migration (up)...');
    try {
      await addAgradecimentoToWhatsappConfig.up(queryInterface, Sequelize);
      console.log('Add agradecimento fields to whatsapp config migration completed.');
    } catch (e) {
      console.log('Add agradecimento fields to whatsapp config migration skipped or already applied:', e.message);
    }

    console.log('Running add credito cliente fields migration (up)...');
    try {
      await addCreditoClienteFields.up(queryInterface, Sequelize);
      console.log('Credito cliente fields migration completed.');
    } catch (e) {
      console.log('Credito cliente fields migration skipped or already applied:', e.message);
    }

    console.log('Running control adquirentes e taxas migration (up)...');
    try {
      await controlAdquirentesETaxas.up(queryInterface, Sequelize);
      console.log('Control adquirentes e taxas migration completed.');
    } catch (e) {
      console.log('Control adquirentes e taxas migration skipped or already applied:', e.message);
    }

    console.log('Running create colaborador comissao servico migration (up)...');
    try {
      await createColabComissaoServico.up(queryInterface, Sequelize);
      console.log('Create colaborador comissao servico migration completed.');
    } catch (e) {
      console.log('Create colaborador comissao servico migration skipped or already applied:', e.message);
    }

    console.log('Migrations execution finished.');
    process.exit(0);
  } catch (error) {
    console.error('Migration execution failed:', error);
    process.exit(1);
  }
}

run();
