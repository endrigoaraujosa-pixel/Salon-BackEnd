const migration = {
  async up(queryInterface, Sequelize) {

    await queryInterface.addColumn('agendamentos', 'criado_por_id', {
      type: Sequelize.STRING(36),
      allowNull: true,
      defaultValue: null
    });

    await queryInterface.addColumn('agendamentos', 'criado_por_nome', {
      type: Sequelize.STRING(255),
      allowNull: true,
      defaultValue: null
    });

  },

  async down(queryInterface) {
    await queryInterface.removeColumn('agendamentos', 'criado_por_nome');
    await queryInterface.removeColumn('agendamentos', 'criado_por_id');

  }
};

export default migration;
