const migration = {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    const tableSpec = { schema: currentSchema, tableName: 'agendamentos' };

    // Obter descrição da tabela no schema atual para verificar existência de colunas
    const describeTable = await queryInterface.describeTable(tableSpec);

    if (!describeTable.cancelado_motivo) {
      await queryInterface.addColumn(tableSpec, 'cancelado_motivo', {
        type: Sequelize.STRING(100),
        allowNull: true,
        defaultValue: null
      });
    }

    if (!describeTable.cancelado_por_id) {
      await queryInterface.addColumn(tableSpec, 'cancelado_por_id', {
        type: Sequelize.STRING(36),
        allowNull: true,
        defaultValue: null
      });
    }

    if (!describeTable.cancelado_por_nome) {
      await queryInterface.addColumn(tableSpec, 'cancelado_por_nome', {
        type: Sequelize.STRING(255),
        allowNull: true,
        defaultValue: null
      });
    }

    if (!describeTable.cancelado_em) {
      await queryInterface.addColumn(tableSpec, 'cancelado_em', {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null
      });
    }

    // Adiciona o índice na coluna cancelado_em se não existir
    try {
      await queryInterface.addIndex(tableSpec, ['cancelado_em'], {
        name: 'idx_agendamentos_cancelado_em'
      });
    } catch (e) {
      if (!e.message.includes('already exists') && !e.message.includes('j existe')) {
        throw e;
      }
    }
  },

  async down(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    const tableSpec = { schema: currentSchema, tableName: 'agendamentos' };

    try {
      await queryInterface.removeIndex(tableSpec, 'idx_agendamentos_cancelado_em');
    } catch (e) {}

    const describeTable = await queryInterface.describeTable(tableSpec);

    if (describeTable.cancelado_em) {
      await queryInterface.removeColumn(tableSpec, 'cancelado_em');
    }
    if (describeTable.cancelado_por_nome) {
      await queryInterface.removeColumn(tableSpec, 'cancelado_por_nome');
    }
    if (describeTable.cancelado_por_id) {
      await queryInterface.removeColumn(tableSpec, 'cancelado_por_id');
    }
    if (describeTable.cancelado_motivo) {
      await queryInterface.removeColumn(tableSpec, 'cancelado_motivo');
    }
  }
};

export default migration;
