export default {
  async up(queryInterface, Sequelize) {
    const schema_name = queryInterface.sequelize.options.schema;

    // 1. Adicionar em colaboradores
    const colaboradoresTable = { tableName: 'colaboradores', schema: schema_name };
    const colaboradoresTableInfo = await queryInterface.describeTable(colaboradoresTable).catch(() => null);
    if (colaboradoresTableInfo && !colaboradoresTableInfo.agendamento_online_ativo) {
      await queryInterface.addColumn(colaboradoresTable, 'agendamento_online_ativo', {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      });
    }

    // 2. Adicionar em colaborador_comissao_servico
    const colabServTable = { tableName: 'colaborador_comissao_servico', schema: schema_name };
    const colabServTableInfo = await queryInterface.describeTable(colabServTable).catch(() => null);
    if (colabServTableInfo && !colabServTableInfo.agendamento_online_ativo) {
      await queryInterface.addColumn(colabServTable, 'agendamento_online_ativo', {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      });
    }

    // 3. Criar tabela colaborador_online_disponibilidade
    await queryInterface.createTable('colaborador_online_disponibilidade', {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
      },
      colaborador_id: {
        type: Sequelize.STRING(36),
        allowNull: false
      },
      dia_semana: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      hora_inicio: {
        type: Sequelize.STRING(5),
        allowNull: false
      },
      hora_fim: {
        type: Sequelize.STRING(5),
        allowNull: false
      },
      ativo: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      criado_em: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW
      },
      atualizado_em: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW
      }
    }, { schema: schema_name });
  },

  async down(queryInterface, Sequelize) {
    const schema_name = queryInterface.sequelize.options.schema;
    await queryInterface.dropTable({ tableName: 'colaborador_online_disponibilidade', schema: schema_name }).catch(() => null);
    await queryInterface.removeColumn({ tableName: 'colaborador_comissao_servico', schema: schema_name }, 'agendamento_online_ativo').catch(() => null);
    await queryInterface.removeColumn({ tableName: 'colaboradores', schema: schema_name }, 'agendamento_online_ativo').catch(() => null);
  }
}
