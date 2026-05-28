const migration = {
  async up(queryInterface, Sequelize) {
    const tableDescription = await queryInterface.describeTable('agendamentos');

    if (!tableDescription.criado_por_id) {
      await queryInterface.addColumn('agendamentos', 'criado_por_id', {
        type: Sequelize.STRING(36),
        allowNull: true,
        defaultValue: null
      });
    }

    if (!tableDescription.criado_por_nome) {
      await queryInterface.addColumn('agendamentos', 'criado_por_nome', {
        type: Sequelize.STRING(255),
        allowNull: true,
        defaultValue: null
      });
    }
  },

  async down(queryInterface) {
    const tableDescription = await queryInterface.describeTable('agendamentos');

    if (tableDescription.criado_por_nome) {
      await queryInterface.removeColumn('agendamentos', 'criado_por_nome');
    }
    if (tableDescription.criado_por_id) {
      await queryInterface.removeColumn('agendamentos', 'criado_por_id');
    }
  }
};

export default migration;
