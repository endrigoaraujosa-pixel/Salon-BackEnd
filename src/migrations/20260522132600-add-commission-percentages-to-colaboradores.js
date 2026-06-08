export default {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('colaboradores', 'comissao_sozinho', {
      type: Sequelize.FLOAT,
      defaultValue: 40,
      allowNull: true
    });

    await queryInterface.addColumn('colaboradores', 'comissao_ajuda', {
      type: Sequelize.FLOAT,
      defaultValue: 30,
      allowNull: true
    });

  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('colaboradores', 'comissao_sozinho');
    await queryInterface.removeColumn('colaboradores', 'comissao_ajuda');
  }
};
